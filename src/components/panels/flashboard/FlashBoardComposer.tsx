import { useState, useCallback, useMemo } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectNodeById } from '../../../stores/flashboardStore/selectors';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { FlashBoardReferenceTray } from './FlashBoardReferenceTray';

export function FlashBoardComposer() {
  const composerState = useFlashBoardStore((s) => s.composer);
  const closeComposer = useFlashBoardStore((s) => s.closeComposer);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const node = useFlashBoardStore((s) =>
    composerState.draftNodeId ? selectNodeById(s, composerState.draftNodeId) : undefined
  );

  const catalog = useMemo(() => getCatalogEntries(), []);

  // Local form state derived from node request or defaults
  const req = node?.request;
  const [service, setService] = useState<CatalogEntry['service']>(req?.service ?? 'kieai');
  const [providerId, setProviderId] = useState(req?.providerId ?? catalog[0]?.providerId ?? '');
  const [version, setVersion] = useState(req?.version ?? catalog[0]?.versions[0] ?? '');
  const [mode, setMode] = useState(req?.mode ?? 'std');
  const [prompt, setPrompt] = useState(req?.prompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(req?.negativePrompt ?? '');
  const [duration, setDuration] = useState(req?.duration ?? 5);
  const [aspectRatio, setAspectRatio] = useState(req?.aspectRatio ?? '16:9');
  const [showNegative, setShowNegative] = useState(false);

  // Get the selected catalog entry
  const selectedEntry = useMemo(
    () => catalog.find((e) => e.service === service && e.providerId === providerId),
    [catalog, service, providerId]
  );

  // Filter providers by service
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
      if (!first.durations.includes(duration)) {
        setDuration(first.durations[0] ?? 5);
      }
      if (!first.aspectRatios.includes(aspectRatio)) {
        setAspectRatio(first.aspectRatios[0] ?? '16:9');
      }
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

  if (!composerState.isOpen || !node) return null;

  const services: CatalogEntry['service'][] = ['kieai', 'piapi', 'cloud'];

  return (
    <div className="flashboard-composer">
      <div className="flashboard-composer-header">
        <span>Compose Generation</span>
        <button className="flashboard-composer-close" onClick={closeComposer}>
          &times;
        </button>
      </div>

      <div className="flashboard-composer-body">
        <div className="flashboard-field">
          <label>Service</label>
          <select
            value={service}
            onChange={(e) => handleServiceChange(e.target.value as CatalogEntry['service'])}
          >
            {services.map((s) => (
              <option key={s} value={s}>{s === 'kieai' ? 'Kie.ai' : s === 'piapi' ? 'PiAPI' : 'Cloud'}</option>
            ))}
          </select>
        </div>

        <div className="flashboard-field">
          <label>Provider</label>
          <select
            value={providerId}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {serviceProviders.map((e) => (
              <option key={e.providerId} value={e.providerId}>{e.name}</option>
            ))}
          </select>
        </div>

        {selectedEntry && selectedEntry.versions.length > 1 && (
          <div className="flashboard-field">
            <label>Version</label>
            <select value={version} onChange={(e) => setVersion(e.target.value)}>
              {selectedEntry.versions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {selectedEntry && selectedEntry.modes.length > 1 && (
          <div className="flashboard-field">
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {selectedEntry.modes.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flashboard-field">
          <label>Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what to generate..."
            rows={4}
          />
        </div>

        <div>
          <button
            className="flashboard-collapsible-header"
            onClick={() => setShowNegative(!showNegative)}
          >
            <span className={`flashboard-collapsible-arrow ${showNegative ? 'open' : ''}`}>
              &#9654;
            </span>
            Negative Prompt
          </button>
          {showNegative && (
            <div className="flashboard-field" style={{ marginTop: 4 }}>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="What to avoid..."
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="flashboard-field-row">
          {selectedEntry && selectedEntry.durations.length > 1 && (
            <div className="flashboard-field">
              <label>Duration</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {selectedEntry.durations.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </select>
            </div>
          )}
          {selectedEntry && selectedEntry.aspectRatios.length > 1 && (
            <div className="flashboard-field">
              <label>Aspect Ratio</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                {selectedEntry.aspectRatios.map((ar) => (
                  <option key={ar} value={ar}>{ar}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <FlashBoardReferenceTray />
      </div>

      <div className="flashboard-composer-footer">
        <button
          className="flashboard-generate-btn"
          disabled={!prompt.trim()}
          onClick={handleGenerate}
        >
          Generate
        </button>
      </div>
    </div>
  );
}
