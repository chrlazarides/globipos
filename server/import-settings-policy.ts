export type AdminImportRequest = {
  backup?: unknown;
  restoreSystemSettings?: unknown;
};

export function parseAdminImportRequest(body: AdminImportRequest | undefined) {
  return {
    data: (body?.backup ?? body) as Record<string, any> | undefined,
    restoreSystemSettings: body?.restoreSystemSettings === true,
  };
}

export function shouldRestoreBackupSettings(payload: { restoreSystemSettings?: unknown } | undefined) {
  return payload?.restoreSystemSettings === true;
}