import { useState, useEffect } from "react";

export type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; notes: string; onInstall: () => Promise<void> }
  | { status: "downloading"; progress: number }
  | { status: "ready" };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useUpdater(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    async function checkForUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update?.available || cancelled) return;

        setState({
          status: "available",
          version: update.version,
          notes: update.body ?? "",
          onInstall: async () => {
            let downloaded = 0;
            let total = 0;
            await update.downloadAndInstall((event) => {
              if (event.event === "Started") {
                total = event.data.contentLength ?? 0;
                setState({ status: "downloading", progress: 0 });
              } else if (event.event === "Progress") {
                downloaded += event.data.chunkLength;
                const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
                setState({ status: "downloading", progress: pct });
              } else if (event.event === "Finished") {
                setState({ status: "ready" });
              }
            });
          },
        });
      } catch (e) {
        console.debug("[updater] check skipped:", e);
      }
    }

    const t1 = setTimeout(checkForUpdate, 15_000);
    const t2 = setInterval(checkForUpdate, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearInterval(t2);
    };
  }, []);

  return state;
}
