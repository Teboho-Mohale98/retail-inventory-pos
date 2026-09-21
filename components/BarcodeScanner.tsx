// ---------------------------------------------------------------------------
// components/BarcodeScanner.tsx
//
// Hardware barcode input component supporting BOTH retail scanner classes:
//
//  1. Keyboard-wedge / USB-HID scanners  — the most common (and cheapest)
//     class. They type the code extremely fast then send `Enter`. This
//     component buffers printable keystrokes and flushes on `Enter`.
//
//  2. Camera-based scanning              — uses the native `BarcodeDetector`
//     API (Chromium). When unavailable, shows a clear fallback hint and keeps
//     keyboard scanning fully functional.
//
// Error handling:
//  - Missing barcode: `onScan` returns `false` (caller marks "not found").
//  - Offline network: the keyboard path is entirely local, so scanning always
//    works; camera requires no network either.
//  - Permissions: camera failures surface via `onError`.
// ---------------------------------------------------------------------------

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { cn, parseBarcodeInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ScanSource = "keyboard" | "camera";
export type ScanOutcome = "success" | "notFound" | "invalid";

export interface BarcodeScannerProps {
  /** Called with the trimmed code + the hardware source that produced it. */
  onScan: (code: string, source: ScanSource) => ScanOutcome | void;
  /** When true the scanner keeps focus and stays "hot". Default true. */
  enabled?: boolean;
  /** Placeholder shown above the live-scan area. */
  label?: string;
  /** Fires when camera permission / hardware fails. */
  onError?: (err: Error) => void;
  className?: string;
}

/** Typing-speed cutoff (ms) that separates "human typing" from "scanner burst". */
const SCANNER_PAUSE_MS = 60;
/** Idle timeout (ms) after which a partially-typed buffer is discarded. */
const BUFFER_TIMEOUT_MS = 250;

// Lightweight typed wrapper around the non-standard BarcodeDetector API.
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

/** Feature-detects the native barcode detector. */
function hasBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function BarcodeScanner({ onScan, enabled = true, label = "Scan a barcode", onError, className }: BarcodeScannerProps) {
  const bufferRef = useRef<string>("");
  const lastKeyAtRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [useCamera, setUseCamera] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState<ScanOutcome | null>(null);

  // Latest-props refs so long-lived camera loops never capture stale closures.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const camReadyRef = useRef(false);
  camReadyRef.current = camReady;

  const emitScan = useCallback(
    (raw: string) => {
      const parsed = parseBarcodeInput(raw);
      if (!parsed.valid) {
        setFeedback("invalid");
        return; // ignore garbage bursts (e.g. random typing)
      }
      const outcome = onScanRef.current(parsed.value, "keyboard") ?? "success";
      setFeedback(outcome === "success" ? "success" : outcome);
      // Visual confirmation state, auto-clears.
      window.setTimeout(() => setFeedback(null), 600);
    },
    []
  );

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore input fields so operators can still type into MODIFIER fields.
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (inField && e.key !== "Enter") return;

      if (e.key === "Enter") {
        if (bufferRef.current.length > 0) {
          e.preventDefault();
          emitScan(bufferRef.current);
          bufferRef.current = "";
        }
        return;
      }

      // Scanners emit only printable ASCII — skip everything else (modifiers…).
      if (e.key.length !== 1 || !e.key.match(/[\x20-\x7E]/)) return;
      // A human typing pauses >60ms between keys; scanners don't.
      const now = performance.now();
      if (now - lastKeyAtRef.current > SCANNER_PAUSE_MS) bufferRef.current = "";
      lastKeyAtRef.current = now;
      bufferRef.current += e.key;

      // Safety flush: a scanner burst is shorter than this window.
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(() => {
        if (bufferRef.current.length >= 8) emitScan(bufferRef.current);
        bufferRef.current = "";
      }, BUFFER_TIMEOUT_MS);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    };
  }, [enabled, emitScan]);

  // ------------------------------------------------------------------ camera
  const startCamera = useCallback(async () => {
    if (!useCamera) return;
    setCamError(null);
    if (!hasBarcodeDetector()) {
      setCamError("Camera scanning needs Chrome/Edge (BarcodeDetector). Keyboard scanning still works.");
      setCamReady(false);
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
        setCamReady(true);

        // Detection loop: debounced barcode frames -> onScan.
        const detector = new (window as unknown as { BarcodeDetector: new () => BarcodeDetectorLike }).BarcodeDetector();
        const tick = async () => {
          if (!videoRef.current || !camReadyRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const first = codes[0];
            if (first && first.rawValue) {
              onScanRef.current(first.rawValue, "camera");
              await new Promise((r) => setTimeout(r, 800)); // avoid re-firing same frame
            }
            // eslint-disable-next-line no-restricted-globals
            requestAnimationFrame(tick);
          } catch {
            // Detection occasionally throws on empty frames — silently retry.
            // eslint-disable-next-line no-restricted-globals
            requestAnimationFrame(tick);
          }
        };
        void tick();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Camera permission denied.";
      setCamError(message);
      setCamReady(false);
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [useCamera, onError]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCamera]);

  // Manual fallback input for damaged barcodes.
  const submitManual = () => {
    if (manual.trim()) emitScan(manual);
    setManual("");
  };

  const feedbackClass =
    feedback === "success" ? "border-success bg-success/10 text-success-foreground" : 
    feedback === "notFound" ? "border-destructive bg-destructive/10 text-destructive" :
    feedback === "invalid" ? "border-warning bg-warning/10 text-warning-foreground" : "";

  return (
    <div className={cn("space-y-3 border-t pt-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Button
          type="button"
          variant={useCamera ? "destructive" : "outline"}
          size="sm"
          onClick={() => {
            if (useCamera) {
              stopCamera();
              setUseCamera(false);
            } else {
              setUseCamera(true);
            }
          }}
        >
          {useCamera ? "Stop camera" : "Camera"}
        </Button>
      </div>

      {/* Keyboard-wedge hint + manual entry */}
      <div className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitManual()}
          placeholder="Type or scan barcode (USB scanners work out of the box)…"
          className={cn("flex-1", feedbackClass)}
          aria-label={label}
        />
        <Button type="button" variant="secondary" onClick={submitManual} disabled={!manual.trim()}>
          Add
        </Button>
      </div>

      {/* Camera viewport */}
      {useCamera && (
        <div className="space-y-2">
          {camError ? (
            <p className="text-xs text-destructive">{camError}</p>
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-40 w-full rounded-md border bg-muted object-cover"
              aria-hidden
            />
          )}
          {!camReady && !camError && <p className="text-xs text-muted-foreground">Starting camera…</p>}
        </div>
      )}
    </div>
  );
}