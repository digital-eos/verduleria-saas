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

/** Modal con la cámara trasera que lee códigos de barras (EAN/UPC/Code128). Si no hay soporte, permite escribirlo. */

export default function BarcodeScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let stopped = false;
    let busy = false;
    let lastDetect = 0;

    async function start() {
      const Detector = (window as WindowWithBarcode).BarcodeDetector;
      if (!Detector) {
        setError(
          "Este navegador no puede leer códigos con la cámara (pasa en iPhone y Firefox). Usá Chrome en Android o escribí el código abajo.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("La cámara solo funciona con HTTPS. Escribí el código abajo.");
        return;
      }

      let formats: string[];
      try {
        const supported = await Detector.getSupportedFormats();
        formats = WANTED_FORMATS.filter((f) => supported.includes(f));
      } catch {
        formats = [];
      }
      if (formats.length === 0) {
        setError("Este dispositivo no puede leer códigos de barras con la cámara. Escribí el código abajo.");
        return;
      }
      const detector = new Detector({ formats });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "No diste permiso para usar la cámara. Habilitalo en el navegador o escribí el código abajo."
            : name === "NotFoundError"
              ? "No se encontró ninguna cámara. Escribí el código abajo."
              : "No se pudo abrir la cámara. Escribí el código abajo.",
        );
        return;
      }

      // Si el modal se cerró mientras se pedía permiso
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const tick = (now: number) => {
        if (stopped) return;
        if (!busy && now - lastDetect >= DETECT_INTERVAL_MS && video.readyState >= 2) {
          busy = true;
          lastDetect = now;
          detector
            .detect(video)
            .then((codes) => {
              const value = codes.find((c) => c.rawValue)?.rawValue;
              if (value && !stopped) {
                stopped = true;
                navigator.vibrate?.(80);
                onDetectedRef.current(value);
              }
            })
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }
        if (!stopped) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Escanear producto</h2>

        {error ? (
          <div className="msg error">{error}</div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "4 / 3", objectFit: "cover" }}
            />
            <p className="muted">Apuntá la cámara al código de barras.</p>
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onDetected(manual.trim());
          }}
        >
          <label htmlFor="scan-manual">O escribí el código</label>
          <div className="row">
            <input
              id="scan-manual"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus={error !== null}
            />
            <button type="submit" className="primary" disabled={!manual.trim()} style={{ flex: "0 0 auto", padding: "12px 16px" }}>
              OK
            </button>
          </div>
        </form>

        <button onClick={onCancel} style={{ width: "100%", marginTop: 12 }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
