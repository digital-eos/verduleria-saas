"use client";

import { useState } from "react";
import CameraScanner from "./CameraScanner";

/** Modal con la cámara trasera que lee códigos de barras (EAN/UPC/Code128). Si no hay cámara, permite escribirlo. */

export default function BarcodeScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState("");

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Escanear producto</h2>

        <CameraScanner onDetected={onDetected} onError={() => setFailed(true)} />
        {!failed && <p className="muted">Apuntá la cámara al código de barras.</p>}

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
              autoFocus={failed}
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
