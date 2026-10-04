export class Resource {
  constructor(public rid: number) {}
  async close() {}
}

export async function invoke(command: string, args?: any): Promise<any> {
  const fixture = (window as any).nativeFixture ??= { refreshes: 0, rejectRefresh: false };
  if (command === "sync_cashiers") {
    fixture.refreshes++;
    if (fixture.rejectRefresh) throw new Error("Fixture offline");
    return 2;
  }
  if (command === "validate_pin") {
    const cashier = args.pin === "1234" ? "First cashier" : args.pin === "87654321" ? "Second cashier" : null;
    return cashier ? { cashier_id: cashier, cashier_name: cashier, role: "cashier", permissions: [] } : null;
  }
  if (command === "write_audit") return null;
  if (command === "register_terminal") {
    if (fixture.blockSwitch) throw new Error("Cannot switch yet: unsynced sales. Use Sync now before switching.");
    fixture.registered = args;
    return {
      server_url: args.serverUrl, terminal_code: args.terminalCode, terminal_name: args.terminalCode,
      terminal_id: "fixture-new", location_id: "location-fixture", location_name: "Fixture shop",
      price_level: 1, restart_required: args.terminalCode !== "FIXTURE-1",
    };
  }
  if (command === "restart_pos") { fixture.restarted = true; return; }
  throw new Error(`Unexpected fixture command: ${command}`);
}