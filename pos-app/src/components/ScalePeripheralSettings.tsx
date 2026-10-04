import scaleProtocols from "../../scale-protocols.json";

export interface ScalePeripheralConfig {
  scale_enabled: boolean;
  scale_port: string;
  scale_baud: number;
  scale_protocol: string;
  scale_profile?: string;
  scale_mode?: "physical" | "simulated";
  scale_simulation?: { value: number; unit: "kg" | "g"; state: "stable" | "unstable" | "disconnected"; tared: boolean };
}

export const DEFAULT_SCALE_SIMULATION = { value: 0.75, unit: "kg" as const, state: "stable" as const, tared: false };

export function ScalePeripheralSettings({ config, onChange }: {
  config: ScalePeripheralConfig;
  onChange: (patch: Partial<ScalePeripheralConfig>) => void;
}) {
  const simulated = config.scale_mode === "simulated";
  const reading = config.scale_simulation ?? DEFAULT_SCALE_SIMULATION;
  const control = "w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2 text-sm";
  function updateReading(patch: Partial<typeof reading>) {
    onChange({ scale_simulation: { ...reading, ...patch, tared: false } });
  }
  return <div className="space-y-4" data-testid="scale-peripheral-settings">
    <label className="flex items-center justify-between">
      Scale enabled
      <input aria-label="Scale enabled" type="checkbox" checked={config.scale_enabled}
        onChange={e => onChange({ scale_enabled: e.target.checked })} />
    </label>
    <label className="block space-y-1">
      <span>Scale source</span>
      <select aria-label="Scale source" className={control} value={config.scale_mode ?? "physical"}
        onChange={e => onChange({ scale_mode: e.target.value as "physical" | "simulated" })}>
        <option value="physical">Physical checkout scale</option>
        <option value="simulated">Simulator — test weights only</option>
      </select>
    </label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block space-y-1">
        <span>Physical port</span>
        <input aria-label="Physical scale port" className={control} placeholder="/dev/ttyUSB0 or COM3"
          value={config.scale_port} onChange={e => onChange({ scale_port: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span>Baud rate</span>
        <input aria-label="Scale baud rate" className={control} type="number" min={300} max={115200}
          value={config.scale_baud} onChange={e => onChange({ scale_baud: Number(e.target.value) })} />
      </label>
    </div>
    <label className="block space-y-1">
      <span>Physical protocol provision</span>
      <select aria-label="Scale protocol" className={control} value={config.scale_protocol}
        onChange={e => onChange({ scale_protocol: e.target.value })}>
        {scaleProtocols.map(protocol => <option key={protocol.id} value={protocol.id}>
          {protocol.label}{protocol.adapter ? "" : " — adapter pending"}
        </option>)}
      </select>
    </label>
    <label className="block space-y-1">
      <span>Model / protocol variant{config.scale_protocol === "custom" ? " (required)" : ""}</span>
      <input aria-label="Scale model / protocol variant" className={control} maxLength={200}
        placeholder="Manufacturer, model and protocol/version from the scale manual"
        value={config.scale_profile ?? ""} onChange={e => onChange({ scale_profile: e.target.value })} />
    </label>
    {scaleProtocols.find(protocol => protocol.id === config.scale_protocol)?.adapter === false &&
      <p role="note" className="text-sm text-amber-400">Provision only — physical adapter pending. This selection works with simulated readings; it does not enable a real hardware driver.</p>}
    <p className="text-sm text-gray-400">Physical models and protocols require hardware verification before rollout. Simulator mode keeps these settings for later.</p>
    {simulated && <div className="space-y-3 border border-amber-600 rounded-md p-3">
      <strong className="text-amber-400">SIMULATED SCALE — test weights, not real measurements</strong>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span>Simulated weight</span>
          <input aria-label="Simulated weight" className={control} type="number" min={0} step="any"
            value={reading.value} onChange={e => updateReading({ value: Number(e.target.value) })} />
        </label>
        <label className="block space-y-1">
          <span>Units</span>
          <select aria-label="Simulated units" className={control} value={reading.unit}
            onChange={e => updateReading({ unit: e.target.value as "kg" | "g" })}>
            <option value="kg">Kilograms (kg)</option><option value="g">Grams (g)</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span>Reading state</span>
        <select aria-label="Simulated reading state" className={control} value={reading.state}
          onChange={e => updateReading({ state: e.target.value as typeof reading.state })}>
          <option value="stable">Stable</option>
          <option value="unstable">Unstable</option>
          <option value="disconnected">Disconnected</option>
        </select>
      </label>
      <p className="text-sm text-gray-400">Enter 0 to test zero-weight rejection. Use only with test orders and test inventory.</p>
    </div>}
  </div>;
}