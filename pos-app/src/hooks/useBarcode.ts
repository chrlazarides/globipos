/**
 * USB barcode scanner hook — listens for rapid keyboard input terminated by Enter.
 * HID scanners emulate a keyboard: characters arrive rapidly then Enter is fired.
 */
import { useEffect, useRef, useCallback } from "react";

const SCAN_TIMEOUT_MS = 80;    // characters must arrive within 80ms of each other
const MIN_BARCODE_LEN = 3;      // ignore sequences shorter than this

interface UseBarcodeOptions {
  onScan: (barcode: string) => void;
  enabled?: boolean;
}

export function useBarcode({ onScan, enabled = true }: UseBarcodeOptions): void {
  const bufferRef = useRef<string>("");
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyTimeRef = useRef<number>(0);

  const flush = useCallback(() => {
    const code = bufferRef.current.trim();
    bufferRef.current = "";
    if (code.length >= MIN_BARCODE_LEN) {
      onScan(code);
    }
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      // Ignore when focus is inside an input/textarea (manual typing)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const now = Date.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        if (timerRef.current) clearTimeout(timerRef.current);
        flush();
        return;
      }

      // Only accumulate printable single chars
      if (e.key.length !== 1) {
        // Non-printable key resets the buffer
        bufferRef.current = "";
        return;
      }

      // If the gap between keystrokes is too long, this is manual typing — reset
      if (bufferRef.current.length > 0 && delta > SCAN_TIMEOUT_MS * 3) {
        bufferRef.current = "";
      }

      bufferRef.current += e.key;

      // Reset the flush timer
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SCAN_TIMEOUT_MS * 2);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, flush]);
}
