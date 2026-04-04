import { useState, useCallback, useMemo } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectNodeById } from '../../../stores/flashboardStore/selectors';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry } from '../../../services/flashboard/types';

export function FlashBoardComposer() {
  const composerState = useFlashBoardStore((s) => s.composer);
  const closeComposer = useFlashBoardStore((s) => s.closeComposer);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const node = useFlashBoardStore((s) =>
    composerState.draftNodeId ? selectNodeById(s, composerState.draftNodeId) : undefined
  );

  const catalog = useMemo(() => getCatalogEntries(), []);
  const [showSettings, setShowSettings] = useState(false);

  const req = node?.request;
  const [service, setService] = useState<CatalogEntry['service']>(req?.service ?? 'kieai');
  const [providerId, setProviderId] = useState(req?.providerId ?? catalog[0]?.providerId ?? '');
  const [version, setVersion] = useState(req?.version ?? catalog[0]?.versions[0] ?? '');
  const [mode, setMode] = useState(req?.mode ?? 'std');
  const [prompt, setPrompt] = useState(req?.prompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(req?.negativePrompt ?? '');
  const [duration, setDuration] = useState(req?.duration ?? 5);
  const [aspectRatio, setAspectRatio] = useState(req?.aspectRatio ?? '16:9');

  const selectedEntry = useMemo(
    () => catalog.find((e) => e.service === service && e.providerId === providerId),
    [catalog, service, providerId]
  );

  const serviceProviders = useMemo(
    () => catalog.filter((e) => e.service === service),
    [catalog, service]
  );

  const handleServiceChange = useCallback((newService: CatalogEntry['service']) => {
    setService(newService);
    const first = catalog.find((e) => e.service === newService);
    if (first) {
      setProviderId(first.providerId);
      setVersion(first.versions[0] ?? '');
      setMode(first.modes[0] ?? 'std');
      if (!first.durations.includes(duration)) setDuration(first.durations[0] ?? 5);
      if (!first.aspectRatios.includes(aspectRatio)) setAspectRatio(first.aspectRatios[0] ?? '16:9');
    }
  }, [catalog, duration, aspectRatio]);

  const handleProviderChange = useCallback((newId: string) => {
    setProviderId(newId);
    const entry = catalog.find((e) => e.service === service && e.providerId === newId);
    if (entry) {
      setVersion(entry.versions[0] ?? '');
      if (!entry.modes.includes(mode)) setMode(entry.modes[0] ?? 'std');
      if (!entry.durations.includes(duration)) setDuration(entry.durations[0] ?? 5);
      if (!entry.aspectRatios.includes(aspectRatio)) setAspectRatio(entry.aspectRatios[0] ?? '16:9');
    }
  }, [catalog, service, mode, duration, aspectRatio]);

  const handleGenerate = useCallback(() => {
    if (!node || !prompt.trim()) return;
    updateNodeRequest(node.id, {
      service,
      providerId,
      version,
      mode,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      duration,
      aspectRatio,
      referenceMediaFileIds: [],
    });
    queueNode(node.id);
    closeComposer();
  }, [node, service, providerId, version, mode, prompt, negativePrompt, duration, aspectRatio, updateNodeRequest, queueNode, closeComposer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
    if (e.key === 'Escape') {
      closeComposer();
    }
  }, [handleGenerate, closeComposer]);

  if (!composerState.isOpen || !node) return null;

  const providerLabel = selectedEntry?.name ?? providerId;

  return (
    <div className="flashboard-bubble" onKeyDown={handleKeyDown}>
      <button className="flashboard-bubble-close" onClick={closeComposer}>&times;</button>

      <div className="flashboard-bubble-prompt-row">
        <textarea
          className="flashboard-bubble-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to generate..."
          rows={2}
          autoFocus
        />
        <button
          className="flashboard-bubble-generate"
          disabled={!prompt.trim()}
          onClick={handleGenerate}
          title="Generate (Ctrl+Enter)"
        >
          &#9654;
        </button>
      </div>

      <div className="flashboard-bubble-chips">
        <button
          className="flashboard-bubble-chip"
          onClick={() => setShowSettings(!showSettings)}
          title={providerLabel}
        >
          {providerLabel}
        </button>
        {selectedEntry && selectedEntry.aspectRatios.length > 1 && (
          <select
            className="flashboard-bubble-chip-select"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
          >
            {selectedEntry.aspectRatios.map((ar) => (
              <option key={ar} value={ar}>{ar}</option>
            ))}
          </select>
        )}
        {selectedEntry && selectedEntry.durations.length > 0 && (
          <select
            className="flashboard-bubble-chip-select"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {selectedEntry.durations.map((d) => (
              <option key={d} value={d}>{d}s</option>
            ))}
          </select>
        )}
        {selectedEntry && selectedEntry.modes.length > 1 && (
          <select
            className="flashboard-bubble-chip-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {selectedEntry.modes.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>

      {showSettings && (
        <div className="flashboard-bubble-settings">
          <div className="flashboard-bubble-field">
            <label>Service</label>
            <select
              value={service}
              onChange={(e) => handleServiceChange(e.target.value as CatalogEntry['service'])}
            >
              <option value="kieai">Kie.ai</option>
              <option value="piapi">PiAPI</option>
              <option value="cloud">Cloud</option>
            </select>
          </div>
          <div className="flashboard-bubble-field">
            <label>Model</label>
            <select value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
              {serviceProviders.map((e) => (
                <option key={e.providerId} value={e.providerId}>{e.name}</option>
              ))}
            </select>
          </div>
          {selectedEntry && selectedEntry.versions.length > 1 && (
            <div className="flashboard-bubble-field">
              <label>Version</label>
              <select value={version} onChange={(e) => setVersion(e.target.value)}>
                {selectedEntry.versions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flashboard-bubble-field">
            <label>Negative Prompt</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="What to avoid..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
