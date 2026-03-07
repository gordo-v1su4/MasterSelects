"""
Qwen3-VL Video Description Server
Uses Ollama with multi-frame batching for temporal video understanding.
Extracts frames with PyAV, sends all at once to Qwen3-VL for scene-by-scene analysis.
Runs on http://localhost:5555
"""

import sys
import os
import json
import time
import re
import math
import logging
import base64
import io
import urllib.request
import av
from PIL import Image
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('qwen3vl')

app = Flask(__name__)

OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
MODEL = os.environ.get('MODEL', 'qwen3-vl:8b')


def check_ollama() -> dict:
    """Check if Ollama is running and model is available."""
    try:
        req = urllib.request.Request(f'{OLLAMA_URL}/api/tags', method='GET')
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read())
        models = [m['name'] for m in data.get('models', [])]
        has_model = any(MODEL.split(':')[0] in m for m in models)
        return {"available": True, "model_loaded": has_model, "models": models}
    except Exception as e:
        return {"available": False, "model_loaded": False, "error": str(e)}


def extract_frames(video_path: str, num_frames: int = 12, max_size: int = 320) -> tuple[list[str], float, float]:
    """Extract evenly-spaced frames as small JPEG base64 strings.

    Returns: (list of base64 strings, video_fps, duration_seconds)
    """
    container = av.open(video_path)
    stream = container.streams.video[0]

    video_fps = float(stream.average_rate or stream.rate or 25)
    total_frames = stream.frames or 0
    duration = float(stream.duration * stream.time_base) if stream.duration else 0

    if total_frames == 0 and duration > 0:
        total_frames = int(duration * video_fps)
    elif duration == 0 and total_frames > 0:
        duration = total_frames / video_fps

    # Calculate target size maintaining aspect ratio
    w, h = stream.width, stream.height
    if max(w, h) > max_size:
        scale = max_size / max(w, h)
        w = int(w * scale) & ~1
        h = int(h * scale) & ~1

    interval = max(1, total_frames // num_frames)
    frames_b64 = []
    frame_times = []
    idx = 0

    for frame in container.decode(stream):
        if idx % interval == 0 and len(frames_b64) < num_frames:
            img = frame.to_image()
            if img.size != (w, h):
                img = img.resize((w, h), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=60)
            frames_b64.append(base64.b64encode(buf.getvalue()).decode())
            frame_times.append(idx / video_fps)
        idx += 1

    container.close()
    actual_duration = idx / video_fps if idx > 0 else duration

    log.info(f"Extracted {len(frames_b64)} frames from {video_path} "
             f"({actual_duration:.1f}s, {sum(len(f) for f in frames_b64)/1024:.0f}KB base64)")

    return frames_b64, video_fps, actual_duration


def describe_with_ollama(frames_b64: list[str], duration: float, custom_prompt: str = None) -> dict:
    """Send all frames to Ollama in one request for temporal understanding."""
    if custom_prompt:
        prompt = f"/no_think\n{custom_prompt}"
    else:
        prompt = (
            f"/no_think\n"
            f"These are {len(frames_b64)} frames evenly sampled from a {duration:.0f} second video. "
            f"Analyze the complete sequence and describe what happens scene by scene.\n\n"
            f"Output ONLY lines in this exact format:\n"
            f"[MM:SS-MM:SS] Description of what happens\n\n"
            f"Be specific about subjects, actions, camera movements, and visual details. "
            f"Cover the entire video from start to end. Keep each description to 1-2 sentences. "
            f"Do not add any introduction or conclusion."
        )

    payload = {
        'model': MODEL,
        'messages': [{
            'role': 'user',
            'content': prompt,
            'images': frames_b64,
        }],
        'stream': False,
        'options': {
            'num_predict': 4096,
            'temperature': 0.3,
        },
    }

    log.info(f"Sending {len(frames_b64)} frames to Ollama ({MODEL})...")
    start = time.time()

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/chat',
        data=data,
        headers={'Content-Type': 'application/json'},
    )
    resp = urllib.request.urlopen(req, timeout=300)
    result = json.loads(resp.read())

    content = result.get('message', {}).get('content', '')
    thinking = result.get('message', {}).get('thinking', '')

    elapsed = time.time() - start
    log.info(f"Ollama responded in {elapsed:.1f}s")

    # Use content if available, otherwise extract from thinking
    raw_text = content.strip()
    if not raw_text and thinking:
        raw_text = thinking.strip()
        log.info("Content empty, using thinking field")

    return {"raw_text": raw_text, "elapsed": elapsed}


def parse_segments(raw_text: str, video_duration: float) -> list[dict]:
    """Parse model output into timestamped segments."""
    segments = []

    # Pattern 1: [00:00-00:05] Description
    pattern_range = re.compile(
        r'\[?\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*\]?\s*[:\-–]?\s*(.+?)(?=\n\[?\s*\d{1,2}:\d{2}|\Z)',
        re.DOTALL
    )
    matches = pattern_range.findall(raw_text)
    if matches:
        for m in matches:
            start = int(m[0]) * 60 + int(m[1])
            end = int(m[2]) * 60 + int(m[3])
            text = m[4].strip().rstrip('.')
            # Clean markdown formatting
            text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                segments.append({"start": start, "end": end, "text": text})
        if segments:
            return segments

    # Pattern 2: single timestamp per line
    pattern_single = re.compile(r'[\[*]*(\d{1,2}):(\d{2})[\]*]*\s*[:\-–]?\s*(.+)')
    timestamps = []
    for line in raw_text.strip().split('\n'):
        line = re.sub(r'^\d+[.)]\s*', '', line.strip())
        if not line:
            continue
        m = pattern_single.match(line)
        if m:
            t = int(m.group(1)) * 60 + int(m.group(2))
            text = m.group(3).strip().rstrip('.')
            text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                timestamps.append({"time": t, "text": text})

    if timestamps:
        for i, ts in enumerate(timestamps):
            end = timestamps[i + 1]["time"] if i + 1 < len(timestamps) else video_duration
            segments.append({"start": ts["time"], "end": end, "text": ts["text"]})
        return segments

    # Fallback: entire text as one segment
    text = raw_text.strip()
    if text:
        segments.append({"start": 0, "end": video_duration, "text": text})
    return segments


@app.route('/api/status', methods=['GET'])
def status():
    """Check server and Ollama status."""
    ollama = check_ollama()
    return jsonify({
        "available": ollama["available"],
        "model_loaded": ollama["model_loaded"],
        "model_name": MODEL,
        "backend": "ollama",
    })


@app.route('/api/describe', methods=['POST'])
def describe():
    """Describe a video file with timestamped scene descriptions.

    JSON body:
    {
        "video_path": "C:/path/to/video.mp4",
        "duration": 30.0,
        "num_frames": 12,
        "prompt": "optional custom prompt"
    }
    """
    data = request.get_json()
    if not data or 'video_path' not in data:
        return jsonify({"error": "video_path required"}), 400

    video_path = data['video_path']
    if not os.path.isfile(video_path):
        return jsonify({"error": f"File not found: {video_path}"}), 404

    num_frames = data.get('num_frames', 12)
    custom_prompt = data.get('prompt')

    try:
        start_time = time.time()

        # Check Ollama
        ollama_status = check_ollama()
        if not ollama_status["available"]:
            return jsonify({"error": "Ollama not running. Install from ollama.com"}), 503
        if not ollama_status["model_loaded"]:
            return jsonify({"error": f"Model {MODEL} not found. Run: ollama pull {MODEL}"}), 503

        # Extract frames
        frames_b64, video_fps, duration = extract_frames(video_path, num_frames=num_frames)
        duration = data.get('duration', duration)

        if not frames_b64:
            return jsonify({"error": "No frames could be extracted"}), 400

        # Send to Ollama with all frames
        result = describe_with_ollama(frames_b64, duration, custom_prompt)
        raw_text = result["raw_text"]

        # Parse into segments
        segments = parse_segments(raw_text, duration)
        for i, seg in enumerate(segments):
            seg["id"] = f"scene-{i}"

        elapsed = time.time() - start_time
        log.info(f"Complete: {len(segments)} segments in {elapsed:.1f}s")

        return jsonify({
            "segments": segments,
            "raw_text": raw_text,
            "elapsed_seconds": round(elapsed, 1),
            "frames_sampled": len(frames_b64),
        })

    except Exception as e:
        log.error(f"Describe failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/unload', methods=['POST'])
def unload():
    """Not needed for Ollama backend, but kept for API compatibility."""
    return jsonify({"status": "ollama_managed"})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5555))
    log.info(f"Starting Qwen3-VL server on http://localhost:{port} (Ollama backend)")
    app.run(host='0.0.0.0', port=port, threaded=True)
