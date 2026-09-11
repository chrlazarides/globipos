import { expect, test } from "@playwright/test";
import {
  parseAdminImportRequest,
  shouldRestoreBackupSettings,
} from "../server/import-settings-policy";

test.describe("deployment settings import policy", () => {
  test("/api/admin/import preserves settings for legacy and wrapped requests by default", () => {
    const legacyBackup = { version: 1, systemSettings: [{ key: "company_name" }] };

    expect(parseAdminImportRequest(legacyBackup)).toEqual({
      data: legacyBackup,
      restoreSystemSettings: false,
    });
    expect(parseAdminImportRequest({ backup: legacyBackup })).toEqual({
      data: legacyBackup,
      restoreSystemSettings: false,
    });
  });

  test("/api/admin/import restores settings only for an explicit boolean opt-in", () => {
    const backup = { version: 1 };

    expect(parseAdminImportRequest({ backup, restoreSystemSettings: true })).toEqual({
      data: backup,
      restoreSystemSettings: true,
    });
    expect(parseAdminImportRequest({ backup, restoreSystemSettings: "true" })).toEqual({
      data: backup,
      restoreSystemSettings: false,
    });
  });

  test("/api/backup/restore preserves settings by default", () => {
    expect(shouldRestoreBackupSettings(undefined)).toBe(false);
    expect(shouldRestoreBackupSettings({})).toBe(false);
    expect(shouldRestoreBackupSettings({ restoreSystemSettings: false })).toBe(false);
  });

  test("/api/backup/restore requires an explicit boolean opt-in", () => {
    expect(shouldRestoreBackupSettings({ restoreSystemSettings: true })).toBe(true);
    expect(shouldRestoreBackupSettings({ restoreSystemSettings: "true" })).toBe(false);
    expect(shouldRestoreBackupSettings({ restoreSystemSettings: 1 })).toBe(false);
  });
});