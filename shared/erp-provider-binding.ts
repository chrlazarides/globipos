export function erpProviderBinding<T extends { provider: string; enabled: boolean }>(config: T | null | undefined, selectedProvider: string | undefined) {
  const matchingConfig = config && selectedProvider && config.provider === selectedProvider ? config : null;
  return {
    matchingConfig,
    canTest: Boolean(matchingConfig),
    canRun: Boolean(matchingConfig?.enabled),
    mismatchLabel: config && selectedProvider && config.provider !== selectedProvider
      ? `Active configured provider: ${config.provider === "sap-b1" ? "SAP Business One" : config.provider === "softone" ? "SoftOne" : config.provider}`
      : null,
  };
}