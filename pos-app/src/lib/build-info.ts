declare const __APP_VERSION__: string;
declare const __BUILD_REFERENCE__: string;
declare const __BUILD_ENVIRONMENT__: string;

export const buildInfo = {
  version: __APP_VERSION__,
  reference: __BUILD_REFERENCE__,
  environment: __BUILD_ENVIRONMENT__,
  isDevelopment: __BUILD_ENVIRONMENT__ !== "production",
} as const;