import { Download, RefreshCw, CheckCircle } from "lucide-react";
import type { UpdateState } from "../hooks/useUpdater";

interface Props {
  state: UpdateState;
}

export function UpdateBanner({ state }: Props) {
  if (state.status === "idle") return null;

  if (state.status === "available") {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-gray-900 border border-gray-700 text-white rounded-xl shadow-2xl p-4 flex items-start gap-3 max-w-xs">
        <Download className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Update available</p>
          <p className="text-xs text-gray-400 mt-0.5">v{state.version}</p>
          {state.notes ? (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{state.notes}</p>
          ) : null}
        </div>
        <button
          onClick={state.onInstall}
          data-testid="button-install-update"
          className="shrink-0 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          Install
        </button>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-gray-900 border border-gray-700 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 max-w-xs">
        <RefreshCw className="w-5 h-5 text-blue-400 shrink-0 animate-spin" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Downloading update…</p>
          <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">{state.progress}%</p>
        </div>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-green-900 border border-green-700 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 max-w-xs">
        <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Update installed</p>
          <p className="text-xs text-green-300 mt-0.5">Close and reopen GlobiPOS to apply.</p>
        </div>
      </div>
    );
  }

  return null;
}
