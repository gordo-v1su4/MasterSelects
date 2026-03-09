import { useSettingsStore, type GPUPowerPreference } from '../../../stores/settingsStore';

export function PerformanceSettings() {
  const {
    turboModeEnabled,
    nativeHelperPort,
    nativeHelperConnected,
    gpuPowerPreference,
    setTurboModeEnabled,
    setNativeHelperPort,
    setGpuPowerPreference,
  } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Performance</h2>

      <div className="settings-group">
        <div className="settings-group-title">GPU</div>

        <label className="settings-row">
          <span className="settings-label">GPU Power Preference</span>
          <select
            value={gpuPowerPreference}
            onChange={(e) => setGpuPowerPreference(e.target.value as GPUPowerPreference)}
            className="settings-select"
          >
            <option value="high-performance">High Performance (Discrete GPU)</option>
            <option value="low-power">Low Power (Integrated GPU)</option>
          </select>
        </label>
        <p className="settings-hint">
          Requires page reload to take effect.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Native Helper</div>

        <label className="settings-row">
          <span className="settings-label">Enable Native Helper</span>
          <input
            type="checkbox"
            checked={turboModeEnabled}
            onChange={(e) => setTurboModeEnabled(e.target.checked)}
            className="settings-checkbox"
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">WebSocket Port</span>
          <input
            type="number"
            value={nativeHelperPort}
            onChange={(e) => setNativeHelperPort(Number(e.target.value))}
            className="settings-input settings-input-number"
            min={1024}
            max={65535}
            disabled={!turboModeEnabled}
          />
        </label>

        <div className="settings-status">
          <span className={`status-indicator ${nativeHelperConnected ? 'connected' : 'disconnected'}`} />
          <span className="status-text">
            {nativeHelperConnected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <p className="settings-hint">
          Native Helper enables downloads, Firefox project save/open, and the local AI bridge.
        </p>
      </div>
    </div>
  );
}
