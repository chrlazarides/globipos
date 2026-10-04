// Browser-test bridge only. Native simulator conversion/persistence are tested in Rust.
import type { HardwareConfig, ScaleReading } from "../src/hooks/useHardware";
let override: ScaleReading | null | undefined;
const defaults = {
  scale_enabled: true, scale_mode: "simulated", scale_port: "COM3",
  scale_baud: 9600, scale_protocol: "digi",
  scale_simulation: { value: .75, unit: "kg", state: "stable", tared: false },
  printer_enabled: false, printer_port: "", printer_columns: 42, printer_logo: false,
  drawer_enabled: false, drawer_pulse_ms: 200, customer_display_enabled: false,
  customer_display_port: "", vfd_enabled: false, vfd_port: "", vfd_baud: 9600, vfd_protocol: "generic",
};
function config(): HardwareConfig {
  return JSON.parse(localStorage.getItem("fixture-scale-config") ?? JSON.stringify(defaults));
}
export function overrideReading(value: ScaleReading | null) { override = value; }
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: any) => {
    switch (command) {
      case "get_hardware_config": return config();
      case "save_hardware_config":
        localStorage.setItem("fixture-scale-config", JSON.stringify(args.config));
        override = undefined;
        return;
      case "get_payment_config": return { provider: "mock", endpoint: "", merchant_id: "", api_key: "" };
      case "save_payment_config": return;
      case "check_printer_status": return false;
      case "scale_read_weight": {
        await new Promise(resolve => setTimeout(resolve, 150));
        const cfg = config();
        if (!cfg.scale_enabled) throw "Scale not configured";
        if (cfg.scale_mode !== "simulated") throw "Physical scale unavailable in browser fixture";
        if (override !== undefined) {
          if (override === null) throw "Simulated scale disconnected";
          return override;
        }
        const sim = cfg.scale_simulation!;
        if (sim.state === "disconnected") throw "Simulated scale disconnected";
        const grams = sim.unit === "kg" ? sim.value * 1000 : sim.value;
        return { grams, kg: grams / 1000, stable: sim.state === "stable", tared: sim.tared };
      }
      case "scale_tare": {
        const cfg = config();
        if (cfg.scale_mode !== "simulated") throw "Physical scale unavailable in browser fixture";
        cfg.scale_simulation = { ...cfg.scale_simulation!, value: 0, tared: true };
        localStorage.setItem("fixture-scale-config", JSON.stringify(cfg));
        override = undefined;
        return;
      }
      default: throw `Unexpected fixture command: ${command}`;
    }
  },
};