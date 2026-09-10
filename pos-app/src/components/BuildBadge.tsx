import { buildInfo } from "@/lib/build-info";

export function BuildBadge() {
  return (
    <div
      className="fixed bottom-2 right-3 z-[100] rounded bg-black/60 px-2 py-1 text-[10px] text-gray-400 backdrop-blur-sm"
      data-testid="pos-build-version"
      title={`${buildInfo.environment} build ${buildInfo.reference}`}
    >
      POS v{buildInfo.version}
      {buildInfo.isDevelopment ? ` · dev ${buildInfo.reference}` : ""}
    </div>
  );
}