"use client";

import { useEffect, useRef, useState } from "react";

/* ---------- Tipos locales para la API BarcodeDetector (no está en lib.dom) ---------- */

type DetectedBarcode = { rawValue: string; format: string };

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

type WindowWithBarcode = Window & { BarcodeDetector?: BarcodeDetectorConstructor };

const WANTED_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const DETECT_INTERVAL_MS = 150;
/** Lecturas iguales seguidas para aceptar un código (evita lecturas parciales/erróneas) */
const CONFIRM_READS = 2;

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

/** BarcodeDetector nativo (Chrome Android) y, si no está, ZXing (iPhone, Firefox, etc.) */
async function createDetector(): Promise<Detect> {
  const Native = (window as WindowWithBarcode).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
      if (formats.length > 0) {
        const d = new Native({ formats });
        return async (video) => (await d.detect(video)).find((c) => c.rawValue)?.rawValue ?? null;
      }
    } catch {
      // seguimos con ZXing
    }
  }

  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  return async (video) => {
    try {
      return reader.decode(video).getText() || null;
    } catch {
      return null; // NotFoundException: no hay código en este cuadro
    }
  };
}

/**
 * Vista de la cámara trasera que lee códigos de barras (EAN/UPC/Code128).
 * Mientras está montado tiene la cámara abierta; al desmontarlo se apaga.
 * Llama a onDetected una sola vez y deja de leer.
 */
export default function CameraScanner({
  onDetected,
  onError,
}: {
  onDetected: (code: string) => void;
  onError?: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
    onErrorRef.current = onError;
  }, [onDetected, onError]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let lastCode = "";
    let hits = 0;

    const fail = (msg: string) => {
      if (stopped) return;
      setError(msg);
      onErrorRef.current?.(msg);
    };

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        return fail("La cámara solo funciona con HTTPS. Escribí el código abajo.");
      }

      let detect: Detect;
      try {
        detect = await createDetector();
      } catch {
        return fail("No se pudo cargar el lector de códigos. Escribí el código abajo.");
      }
      if (stopped) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        return fail(
          name === "NotAllowedError" || name === "SecurityError"
            ? "No diste permiso para usar la cámara. Habilitalo en el navegador (candado al lado de la dirección) o escribí el código abajo."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No se encontró ninguna cámara. Escribí el código abajo."
              : name === "NotReadableError"
                ? "La cámara está siendo usada por otra app. Cerrala y probá de nuevo."
                : "No se pudo abrir la cámara. Escribí el código abajo.",
        );
      }

      // Si se cerró mientras se pedía permiso
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Enfoque continuo si el teléfono lo permite (mejora mucho la lectura de cerca)
      const track = stream.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities?.() as { focusMode?: string[] } | undefined;
        if (caps?.focusMode?.includes("continuous")) {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        }
      } catch {
        // no soportado: seguimos igual
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (!stopped) setReady(true);

      const loop = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const code = await detect(video).catch(() => null);
          if (stopped) return;
          if (code) {
            hits = code === lastCode ? hits + 1 : 1;
            lastCode = code;
            if (hits >= CONFIRM_READS) {
              stopped = true;
              navigator.vibrate?.(80);
              stream?.getTracks().forEach((t) => t.stop());
              onDetectedRef.current(code);
              return;
            }
          }
        }
        timer = window.setTimeout(loop, DETECT_INTERVAL_MS);
      };
      void loop();
    }

    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <div className="msg error">{error}</div>;

  return (
    <div style={{ position: "relative", marginBottom: 10, overflow: "hidden", borderRadius: 8 }}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }}
      />
      {/* Guía de encuadre */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          top: "35%",
          bottom: "35%",
          border: "2px solid rgba(255,255,255,.85)",
          borderRadius: 8,
          boxShadow: "0 0 0 9999px rgba(0,0,0,.25)",
          pointerEvents: "none",
        }}
      />
      {!ready && (
        <p style={{ position: "absolute", inset: 0, margin: 0, display: "grid", placeItems: "center", color: "#fff" }}>
          Abriendo la cámara…
        </p>
      )}
    </div>
  );
}
