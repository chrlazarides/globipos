export type ExternalLaunch = { type: "web" | "server" | "app"; target: string };

export function validExternalLaunch(value: unknown): value is ExternalLaunch {
  if (!value || typeof value !== "object") return false;
  const launch = value as Record<string, unknown>;
  if (typeof launch.target !== "string" || !launch.target.trim() || launch.target.length > 2048) return false;
  try {
    const url = new URL(launch.target);
    if (url.username || url.password) return false;
    if (launch.type === "web" || launch.type === "server") return ["https:", "http:"].includes(url.protocol);
    return launch.type === "app" && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
      !["http:", "https:", "file:", "javascript:", "data:", "blob:", "ftp:", "shell:", "cmd:", "powershell:"].includes(url.protocol);
  } catch { return false; }
}

export function approvedExternalTools(
  buttons: { buttonType: string; actionCode: string | null }[],
  settings: { key: string; value: string }[],
): Record<string, ExternalLaunch> {
  const values = new Map(settings.map(setting => [setting.key, setting.value]));
  const result: Record<string, ExternalLaunch> = Object.create(null);
  for (const button of buttons) {
    if (button.buttonType !== "action" || !button.actionCode) continue;
    const code = button.actionCode.toUpperCase();
    const value = values.get(`pos_function_definition_${code.toLowerCase()}`);
    if (!value) continue;
    try {
      const definition = JSON.parse(value);
      if (definition?.approved !== true || definition.mode !== "single" ||
          !validExternalLaunch(definition.launch) ||
          !validExternalLaunch(definition.launchApproval) ||
          definition.launch.type !== definition.launchApproval.type ||
          definition.launch.target !== definition.launchApproval.target ||
          (code === "OPEN_BROWSER" && definition.launch.type === "app")) continue;
      result[code] = { type: definition.launch.type, target: definition.launch.target };
    } catch { /* Invalid saved definitions are never sent to terminals. */ }
  }
  return result;
}