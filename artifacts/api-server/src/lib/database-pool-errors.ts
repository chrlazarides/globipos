type PoolErrorSource = {
  on: (event: "error", listener: (error: Error) => void) => unknown;
};

export function handleDatabasePoolErrors(
  pool: PoolErrorSource,
  report: (fields: { code?: string; message: string }, message: string) => void,
): void {
  // pg-pool already evicts the broken idle client. Handle its error event so
  // EventEmitter does not crash the process; future queries acquire a new client.
  pool.on("error", (error) => {
    report(
      { code: (error as Error & { code?: string }).code, message: error.message },
      "Idle database connection lost; discarded connection will be replaced",
    );
  });
}