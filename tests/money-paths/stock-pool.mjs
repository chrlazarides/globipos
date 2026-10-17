// Deliberately small SQL-boundary fixture, NOT a replacement inventory engine.
// Runs receivePosStock itself. Unknown statements fail; transactions restore
// fixture state on rollback. Does not claim to test PostgreSQL locking/races.
export function stockPool({ failAudit = false } = {}) {
  const state = { global: 10, location: 10, audits: new Map() };
  let backup, auditKey;
  const rows = values => ({ rows: values, rowCount: values.length });
  return {
    state,
    async connect() {
      return {
        release() {},
        async query(text, args = []) {
          const sql = text.replace(/\s+/g, " ").trim();
          if (sql === "BEGIN") { backup = structuredClone(state); return rows([]); }
          if (sql === "COMMIT") return rows([]);
          if (sql === "ROLLBACK") { Object.assign(state, backup); return rows([]); }
          if (sql.startsWith("SELECT pg_advisory_xact_lock")) return rows([]);
          if (sql.startsWith("SELECT detail FROM pos_audit_logs")) {
            auditKey = JSON.stringify(args);
            return rows(state.audits.has(auditKey) ? [{ detail: state.audits.get(auditKey) }] : []);
          }
          if (sql.startsWith("SELECT id, active, has_variants FROM items")) {
            return rows([{ id: "sample-item", active: true, has_variants: false }]);
          }
          if (sql.startsWith("SELECT id FROM pos_locations")) return rows([{ id: "sample-location" }]);
          if (sql.startsWith("SELECT id, quantity FROM item_location_stock")) return rows([{ id: "stock-1", quantity: state.location }]);
          if (sql.startsWith("UPDATE items SET stock_quantity = stock_quantity +")) {
            state.global += args[0]; return rows([{ stock_quantity: state.global }]);
          }
          if (sql.startsWith("UPDATE item_location_stock SET quantity =")) {
            state.location = args[0]; return rows([]);
          }
          if (sql.includes("FROM inventory_reservations")) return rows([{ quantity: 0 }]);
          if (sql.startsWith("SELECT LEAST(COALESCE(MIN(local_id)")) return rows([{ local_id: -state.audits.size - 1 }]);
          if (sql.startsWith("INSERT INTO pos_audit_logs")) {
            if (failAudit) throw new Error("fixture audit failure");
            const detail = args.find(v => typeof v === "string" && v.includes('"requestHash":'));
            if (!detail || !auditKey) throw new Error("Missing stock audit binding");
            state.audits.set(auditKey, detail);
            return rows([]);
          }
          throw new Error(`Unsupported fixture SQL: ${sql}`);
        },
      };
    },
  };
}
