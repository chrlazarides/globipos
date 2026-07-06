import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";

interface ResolvedContent {
  kind: "media" | "item" | "offer";
  url?: string;
  mediaType?: string;
  name?: string;
  imageUrl?: string;
  price?: string;
  brand?: string;
  description?: string;
  discountPercentage?: string;
}

interface PlaylistItem {
  id: string;
  contentType: string;
  durationSeconds: number;
  resolved: ResolvedContent | null;
}

interface PlayResponse {
  screen: { id: string; name: string; screenType: string };
  items: PlaylistItem[];
}

const REFRESH_MS = 60_000;
const HEARTBEAT_MS = 30_000;

export default function SignagePlayer() {
  const params = useParams<{ code: string }>();
  const code = (params.code || "").toUpperCase();
  const [data, setData] = useState<PlayResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [index, setIndex] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPlaylist() {
      try {
        const res = await fetch(`/api/signage/play/${code}`);
        if (res.status === 404) { if (!cancelled) setNotFound(true); return; }
        if (!res.ok) return;
        const json: PlayResponse = await res.json();
        if (!cancelled) { setData(json); setNotFound(false); }
      } catch { /* keep last known state on transient network errors */ }
    }
    fetchPlaylist();
    const interval = setInterval(fetchPlaylist, REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [code]);

  useEffect(() => {
    const beat = () => fetch(`/api/signage/play/${code}/heartbeat`, { method: "POST" }).catch(() => {});
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [code]);

  useEffect(() => {
    setIndex(0);
  }, [data?.items.length]);

  const items = data?.items || [];
  const current = items[index] || null;

  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (!current || current.resolved?.mediaType === "video") return;
    const ms = Math.max(2, current.durationSeconds || 8) * 1000;
    advanceTimer.current = setTimeout(() => {
      setIndex(i => (items.length ? (i + 1) % items.length : 0));
    }, ms);
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, [current, items.length]);

  const handleVideoEnded = () => setIndex(i => (items.length ? (i + 1) % items.length : 0));

  if (notFound) {
    return (
      <div className="min-h-screen w-screen bg-black text-white flex flex-col items-center justify-center gap-2" data-testid="page-signage-not-found">
        <p className="text-2xl font-semibold">Unknown screen</p>
        <p className="text-white/60">Pairing code "{code}" was not found. Check the code in Digital Signage → Screens.</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="min-h-screen w-screen bg-black text-white flex flex-col items-center justify-center gap-3" data-testid="page-signage-waiting">
        <p className="text-3xl font-semibold" data-testid="text-signage-screen-name">{data?.screen?.name || "Signage screen"}</p>
        <p className="text-white/50 text-lg">Waiting for content — assign a playlist to this screen in Digital Signage.</p>
        <p className="text-white/30 text-sm mt-4">Pairing code: {code}</p>
      </div>
    );
  }

  const r = current.resolved!;

  return (
    <div className="min-h-screen w-screen bg-black text-white overflow-hidden relative" data-testid="page-signage-player">
      {r.kind === "media" && r.mediaType === "video" && (
        <video
          key={current.id}
          src={r.url}
          className="w-full h-screen object-contain"
          autoPlay
          muted
          playsInline
          onEnded={handleVideoEnded}
          data-testid="video-signage-content"
        />
      )}
      {r.kind === "media" && r.mediaType !== "video" && (
        <img key={current.id} src={r.url} className="w-full h-screen object-contain" alt={r.name || "Promotion"} data-testid="img-signage-content" />
      )}
      {r.kind === "item" && (
        <div className="w-full h-screen flex flex-col items-center justify-center gap-6" data-testid="card-signage-item">
          {r.imageUrl && <img src={r.imageUrl} className="max-h-[60vh] object-contain" alt={r.name} />}
          <div className="text-center">
            {r.brand && <p className="text-2xl text-white/60">{r.brand}</p>}
            <p className="text-5xl font-bold" data-testid="text-signage-item-name">{r.name}</p>
            {r.price && <p className="text-6xl font-extrabold text-emerald-400 mt-4" data-testid="text-signage-item-price">£{r.price}</p>}
          </div>
        </div>
      )}
      {r.kind === "offer" && (
        <div className="w-full h-screen flex flex-col items-center justify-center gap-4 text-center px-12" data-testid="card-signage-offer">
          <p className="text-6xl font-extrabold text-amber-400" data-testid="text-signage-offer-discount">{r.discountPercentage}% OFF</p>
          <p className="text-4xl font-bold" data-testid="text-signage-offer-name">{r.name}</p>
          {r.description && <p className="text-xl text-white/70">{r.description}</p>}
        </div>
      )}
    </div>
  );
}
