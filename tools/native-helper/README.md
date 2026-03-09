# MasterSelects Native Helper

Cross-platform local runtime companion for MasterSelects. It provides Firefox project storage, external AI control, and yt-dlp-powered downloads.

## Features

- **External AI Control**: Local HTTP bridge for Claude Code, curl, and other agents
- **Firefox Project Storage**: Native file system backend for project save/load when FSA is unavailable
- **Video Downloads**: yt-dlp integration for YouTube, TikTok, Instagram, Twitter, etc.
- **WebSocket Protocol**: Local command channel between the browser app and helper
- **HTTP Server**: File serving plus AI tool bridge on port `port + 1`

## Prerequisites

### All Platforms
- [Rust](https://rustup.rs/) (stable)
- [LLVM/Clang](https://releases.llvm.org/) (for bindgen during compilation)

### Windows

1. **FFmpeg 7.1 shared libraries** (required for compilation and runtime):
   - Download from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases)
   - Look for: `ffmpeg-n7.1*-win64-gpl-shared-7.1.zip`
   - Extract to: `tools/native-helper/ffmpeg/win64/`
   - Expected structure: `ffmpeg/win64/{bin,include,lib}/`

2. **LLVM/Clang**: `winget install LLVM.LLVM`

### Linux
```bash
sudo apt install libavcodec-dev libavformat-dev libswscale-dev libavutil-dev clang pkg-config
```

### macOS
```bash
brew install ffmpeg llvm pkg-config
```

## Building

### Windows
```bash
set FFMPEG_DIR=path\to\tools\native-helper\ffmpeg\win64
set LIBCLANG_PATH=C:\Program Files\LLVM\lib
cargo build --release

# Copy DLLs next to binary for runtime
copy ffmpeg\win64\bin\*.dll target\release\
copy ffmpeg\win64\bin\ffmpeg.exe target\release\
```

### Linux / macOS
```bash
cargo build --release
```

## Running

```bash
./target/release/masterselects-helper          # Default: WS on :9876, HTTP on :9877
./target/release/masterselects-helper --background
```

## Protocol

WebSocket (JSON commands) on port 9876, HTTP server on port 9877.

| Command | Description |
|---------|-------------|
| `ping` | Connection keepalive |
| `info` | System info (helper features, yt-dlp status, project root, AI bridge status) |
| `register_client` | Register the running MasterSelects editor session with the helper |
| `ai_tool_result` | Return the result of a forwarded AI tool request |
| `list_formats` | List available download formats for a URL |
| `download` | Download a video with progress streaming |
| `get_file` | Get a file as base64 |
| `write_file` / `create_dir` / `list_dir` / `delete` / `exists` / `rename` / `pick_folder` | File-system operations used by the Firefox backend |

HTTP endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /file?path=...` | Serve a local file |
| `POST /upload?path=...` | Upload/write a local file |
| `GET /project-root` | Return default project root |
| `GET /api/ai-tools` | AI bridge status |
| `POST /api/ai-tools` | Forward an AI tool call to the connected editor session |

Example:

```bash
curl -X POST http://127.0.0.1:9877/api/ai-tools \
  -H "Content-Type: application/json" \
  -d '{"tool":"_status","args":{}}'
```
