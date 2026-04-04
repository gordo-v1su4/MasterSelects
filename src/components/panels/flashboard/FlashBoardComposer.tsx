import { useState, useCallback, useMemo, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry } from '../../../services/flashboard/types';

export function FlashBoardComposer() {
  const board = useFlashBoardStore(selectActiveBoard);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
  const queueNode = useFlashBoardStore((s) => s.queueNode);

  const catalog = useMemo(() => getCatalogEntries(), []);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const [service, setService] = useState<CatalogEntry['service']>('kieai');
  const [providerId, setProviderId] = useState(catalog[0]?.providerId ?? '');
  const [version, setVersion] = useState(catalog[0]?.versions[0] ?? '');
  const [mode, setMode] = useState('std');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');

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
    if (!board || !prompt.trim()) return;
    const node = createDraftNode(board.id);
    updateNodeRequest(node.id, {
      service,
      providerId,
      version,
      mode,
      prompt: prompt.trim(),
      duration,
      aspectRatio,
      referenceMediaFileIds: [],
    });
    queueNode(node.id);
    setPrompt('');
  }, [board, prompt, service, providerId, version, mode, duration, aspectRatio, createDraftNode, updateNodeRequest, queueNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [handleGenerate]);

  if (!board) return null;

  const providerShort = selectedEntry?.name?.replace(' (Kie.ai)', '') ?? providerId;

  return (
    <div className="fb-bubble" onKeyDown={handleKeyDown}>
      <div className="fb-bubble-row">
        <textarea
          className="fb-bubble-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to generate..."
          rows={1}
        />
        <button
          className="fb-bubble-go"
          disabled={!prompt.trim()}
          onClick={handleGenerate}
          title="Generate (Ctrl+Enter)"
        >
          &#9654;
        </button>
      </div>
      <div className="fb-bubble-bar">
        <button
          className="fb-chip"
          onClick={() => setShowSettings((v) => !v)}
        >
          {providerShort}
        </button>
        {selectedEntry && selectedEntry.aspectRatios.length > 1 && (
          <select className="fb-chip-sel" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            {selectedEntry.aspectRatios.map((ar) => <option key={ar} value={ar}>{ar}</option>)}
          </select>
        )}
        {selectedEntry && selectedEntry.durations.length > 0 && (
          <select className="fb-chip-sel" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {selectedEntry.durations.map((d) => <option key={d} value={d}>{d}s</option>)}
          </select>
        )}
        {selectedEntry && selectedEntry.modes.length > 1 && (
          <select className="fb-chip-sel" value={mode} onChange={(e) => setMode(e.target.value)}>
            {selectedEntry.modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>
      {showSettings && (
        <div className="fb-settings" ref={settingsRef}>
          <select className="fb-settings-sel" value={service} onChange={(e) => handleServiceChange(e.target.value as CatalogEntry['service'])}>
            <option value="kieai">Kie.ai</option>
            <option value="piapi">PiAPI</option>
            <option value="cloud">Cloud</option>
          </select>
          <select className="fb-settings-sel" value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
            {serviceProviders.map((e) => <option key={e.providerId} value={e.providerId}>{e.name}</option>)}
          </select>
          {selectedEntry && selectedEntry.versions.length > 1 && (
            <select className="fb-settings-sel" value={version} onChange={(e) => setVersion(e.target.value)}>
              {selectedEntry.versions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
