import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Login } from "../src/pages/Login";
import { SyncHeader } from "../src/components/SyncHeader";
import { Setup } from "../src/pages/Setup";
import { readDeviceKey, writeDeviceKey } from "../src/lib/deviceKey";
import type { TerminalConfig, SyncTelemetry, CashierSession } from "../src/types";

const config = {
  server_url: "https://fixture.invalid", terminal_code: "FIXTURE-1",
  terminal_id: "terminal-fixture", terminal_name: "Fixture till",
  location_id: "location-fixture", location_name: "Fixture shop", price_level: 1,
} as TerminalConfig;
const session = { cashier_id: "fixture", cashier_name: "Fixture cashier", role: "cashier", permissions: [] } as CashierSession;
const telemetry = {
  phase: "idle", syncing: false, online: true, serverReachable: true,
  outboxPending: 0, outboxFailed: 0, auditPending: 0, auditFailed: 0,
  catalogReceived: 0, catalogCommitted: 0, catalogPages: 0, inboxReceived: 0,
  transactionsConfirmed: 0, auditsConfirmed: 0, progressAt: null,
  retryAt: null, error: null, runId: null, deviceId: "fixture-device", sequence: 0,
} as SyncTelemetry;

(window as any).deviceFixture = { readDeviceKey, writeDeviceKey };

function ConfigureFixture() {
  const [current, setCurrent] = useState(config);
  const [setup, setSetup] = useState(false);
  return setup
    ? <Setup initialConfig={current} onCancel={() => setSetup(false)}
        onComplete={cfg => { setCurrent(cfg); setSetup(false); }} />
    : <Login config={current} onLogin={() => {}} onConfigure={() => setSetup(true)} />;
}

function Fixture() {
  const [loggedIn, setLoggedIn] = useState<CashierSession | null>(null);
  return location.search === "?configure" ? <ConfigureFixture /> : location.search === "?login" ? loggedIn
    ? <p data-testid="signed-in">{loggedIn.cashier_name}</p>
    : <Login config={config} onLogin={setLoggedIn} />
    : <div className="min-h-screen bg-gray-950 text-white">
      <SyncHeader config={config} session={session} syncStatus={{ online: true, outbox_pending: 0, outbox_failed: 0 } as any}
        syncTelemetry={telemetry} syncNowBusy={false} peripheralHealth={null} notifications={[]}
        theme="dark" onToggleTheme={() => {}} onSyncCatalog={async () => {}} onSyncNow={async () => {}}
        onLogout={() => {}} />
      <button data-testid="sell-item" onClick={() => {
        document.getElementById("sale-result")!.textContent = "Item added";
      }} className="m-12 rounded bg-burgundy-600 p-5">Sell fixture item</button>
      <p id="sale-result" />
    </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);