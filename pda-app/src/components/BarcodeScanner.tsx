import { useEffect, useRef, useState } from "react";
import { Camera, X, Keyboard } from "lucide-react";
import { cn } from "@/lib/cn";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  className?: string;
}

// Uses the native BarcodeDetector API (supported on Chrome/Android + most
// handheld Android scanner browsers). Falls back to manual entry when the
// API is unavailable or camera access is denied — the PDA must remain usable
// even on devices/browsers without BarcodeDetector support.
export function BarcodeScanner({ onScan, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported("BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScan() {
    setError(null);
    if (!("BarcodeDetector" in window)) {
      setSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
      });
      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            const value = codes[0].rawValue;
            stopScan();
            onScan(value);
            return;
          }
        } catch { /* detection hiccup — keep trying */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setError("Camera access denied or unavailable. Use manual entry below.");
      setScanning(false);
    }
  }

  function stopScan() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }

  function submitManual() {
    if (!manualCode.trim()) return;
    onScan(manualCode.trim());
    setManualCode("");
  }

  return (
    <div className={cn("space-y-3", className)}>
      {scanning ? (
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-8 border-2 border-primary rounded-lg pointer-events-none" />
          <button
            onClick={stopScan}
            className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-2"
            data-testid="button-stop-scan"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <button
          onClick={startScan}
          disabled={supported === false}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-4 text-base font-medium disabled:opacity-50"
          data-testid="button-start-scan"
        >
          <Camera className="w-5 h-5" />
          {supported === false ? "Camera scan not supported" : "Scan Barcode"}
        </button>
      )}
      {error && <p className="text-sm text-destructive" data-testid="text-scan-error">{error}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Keyboard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
            placeholder="Or enter barcode / SKU manually"
            className="w-full pl-9 pr-3 py-3 rounded-lg border border-border bg-card text-base"
            data-testid="input-manual-barcode"
          />
        </div>
        <button
          onClick={submitManual}
          className="px-4 py-3 rounded-lg bg-muted text-foreground font-medium"
          data-testid="button-submit-manual"
        >
          Go
        </button>
      </div>
    </div>
  );
}
