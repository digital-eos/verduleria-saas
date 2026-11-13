"use client";

/**
 * Diagnóstico de balanza ("modo espía"):
 * conecta a un puerto serie (cable USB-RS232 o Bluetooth SPP) y muestra TODO lo que llega,
 * sin interpretar nada. Sirve para descubrir el formato que envía la balanza
 * (modo PC, modo continuo o modo impresora ECO/NOVO).
 */

import { useEffect, useRef, useState } from "react";
import { isSerialSupported, parseWeightFrame, systelCrc } from "@/lib/scale";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Port = any;

type Entry = { id: number; dir: "in" | "out" | "info"; time: string; bytes: number[]; text?: string };

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const CTRL: Record<number, string> = {
  0x00: "NUL", 0x01: "SOH", 0x02: "STX", 0x03: "ETX", 0x04: "EOT", 0x05: "ENQ", 0x06: "ACK", 0x07: "BEL",
  0x08: "BS", 0x09: "TAB", 0x0a: "LF", 0x0b: "VT", 0x0c: "FF", 0x0d: "CR", 0x0e: "SO", 0x0f: "SI",
  0x10: "DLE", 0x11: "XON", 0x12: "DC2", 0x13: "XOFF", 0x14: "DC4", 0x15: "NAK", 0x16: "SYN", 0x17: "ETB",
  0x18: "CAN", 0x19: "EM", 0x1a: "SUB", 0x1b: "ESC", 0x1c: "FS", 0x1d: "GS", 0x1e: "RS", 0x1f: "US", 0x7f: "DEL",
};

const now = () => {
  const d = new Date();
  return `${d.toLocaleTimeString("es-AR", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};
const toHex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");

/** Texto legible: imprimibles tal cual, control como ⟨NOMBRE⟩, LF como salto de línea */
function toReadable(b: number[]) {
  return b
    .map((x) => {
      if (x === 0x0a) return "⟨LF⟩\n";
      if (CTRL[x]) return `⟨${CTRL[x]}⟩`;
      if (x >= 0x20 && x < 0x7f) return String.fromCharCode(x);
      if (x >= 0xa0) return String.fromCharCode(x); // latin-1 (ñ, á…)
      return `⟨${x.toString(16).padStart(2, "0").toUpperCase()}⟩`;
    })
    .join("");
}

/** Si el mensaje es una trama Systel STX+PESO+ETX+CRC, la interpreta */
function systelInfo(b: number[]): string | null {
  const i = b.indexOf(0x02);
  const j = b.indexOf(0x03, i + 1);
  if (i < 0 || j < 0 || j + 1 >= b.length) return null;
  const payload = b.slice(i + 1, j);
  const ok = b[j + 1] === systelCrc(payload);
  const raw = String.fromCharCode(...payload);
  const kg = parseWeightFrame(raw);
  return `Trama Systel ${ok ? "✓ CRC correcto" : "✗ CRC incorrecto"} · datos "${raw}"${kg !== null ? ` · ≈ ${kg} kg (a confirmar)` : ""}`;
}

function parseHexInput(s: string): number[] | null {
  const parts = s.trim().split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const n = parseInt(p.replace(/^0x/i, ""), 16);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    out.push(n);
  }
  return out;
}

export default function BalanzaDiagPage() {
  const [supported, setSupported] = useState(true);
  const [baud, setBaud] = useState(9600);
  const [dataBits, setDataBits] = useState(8);
  const [parity, setParity] = useState("none");
  const [stopBits, setStopBits] = useState(1);
  const [gapMs, setGapMs] = useState(150);

  const [connected, setConnected] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);
  const [showHex, setShowHex] = useState(true);
  const [hexInput, setHexInput] = useState("05");
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const [inSignals, setInSignals] = useState<Record<string, boolean>>({});
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState("");

  const portRef = useRef<Port>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReading = useRef(false);
  const pending = useRef<{ bytes: number[]; time: string } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  const gapRef = useRef(gapMs);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setSupported(isSerialSupported()), []);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { gapRef.current = gapMs; }, [gapMs]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [entries]);

  function push(e: Omit<Entry, "id">) {
    setEntries((list) => [...list.slice(-499), { ...e, id: ++idRef.current }]);
  }

  // Agrupa los bytes que llegan juntos (pausa < gapMs) en un solo "mensaje"
  function onBytes(chunk: Uint8Array) {
    setTotalBytes((n) => n + chunk.length);
    if (pausedRef.current) return;
    if (!pending.current) pending.current = { bytes: [], time: now() };
    pending.current.bytes.push(...chunk);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      if (pending.current) push({ dir: "in", time: pending.current.time, bytes: pending.current.bytes });
      pending.current = null;
    }, gapRef.current);
  }

  async function readLoop() {
    const port = portRef.current;
    while (keepReading.current && port?.readable) {
      const reader = port.readable.getReader();
      readerRef.current = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) onBytes(value);
        }
      } catch (e) {
        push({ dir: "info", time: now(), bytes: [], text: `Error de lectura: ${(e as Error).message}` });
      } finally {
        reader.releaseLock();
      }
    }
  }

  async function connect() {
    setError("");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: baud, dataBits, parity, stopBits, bufferSize: 4096 });
      portRef.current = port;
      try { await port.setSignals({ dataTerminalReady: dtr, requestToSend: rts }); } catch {}
      keepReading.current = true;
      setConnected(true);
      push({ dir: "info", time: now(), bytes: [], text: `Conectado: ${baud} baudios, ${dataBits}${parity[0].toUpperCase()}${stopBits}` });
      readLoop();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function disconnect() {
    keepReading.current = false;
    try { await readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close(); } catch {}
    portRef.current = null;
    setConnected(false);
    push({ dir: "info", time: now(), bytes: [], text: "Desconectado" });
  }

  async function reconnectWithNewSettings() {
    // Reabre el MISMO puerto con otra configuración (sin volver a elegirlo)
    const port = portRef.current;
    if (!port) return connect();
    keepReading.current = false;
    try { await readerRef.current?.cancel(); } catch {}
    try { await port.close(); } catch {}
    await port.open({ baudRate: baud, dataBits, parity, stopBits, bufferSize: 4096 });
    try { await port.setSignals({ dataTerminalReady: dtr, requestToSend: rts }); } catch {}
    keepReading.current = true;
    push({ dir: "info", time: now(), bytes: [], text: `Reconfigurado: ${baud} baudios, ${dataBits}${parity[0].toUpperCase()}${stopBits}` });
    readLoop();
  }

  async function send(bytes: number[]) {
    const port = portRef.current;
    if (!port?.writable) return;
    const w = port.writable.getWriter();
    try {
      await w.write(new Uint8Array(bytes));
      push({ dir: "out", time: now(), bytes });
    } finally {
      w.releaseLock();
    }
  }

  async function applySignals(nextDtr: boolean, nextRts: boolean) {
    setDtr(nextDtr);
    setRts(nextRts);
    try {
      await portRef.current?.setSignals({ dataTerminalReady: nextDtr, requestToSend: nextRts });
      push({ dir: "info", time: now(), bytes: [], text: `Señales: DTR=${nextDtr ? 1 : 0} RTS=${nextRts ? 1 : 0}` });
    } catch (e) {
      push({ dir: "info", time: now(), bytes: [], text: `No se pudieron cambiar las señales: ${(e as Error).message}` });
    }
  }

  // Lee las señales de entrada (CTS, DSR, DCD, RI) cada segundo
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(async () => {
      try {
        const s = await portRef.current?.getSignals();
        if (s) setInSignals({ CTS: s.clearToSend, DSR: s.dataSetReady, DCD: s.dataCarrierDetect, RI: s.ringIndicator });
      } catch {}
    }, 1000);
    return () => clearInterval(t);
  }, [connected]);

  function exportLog() {
    const lines = [
      `Diagnóstico balanza — ${new Date().toLocaleString("es-AR")}`,
      `Config: ${baud} baudios, ${dataBits} bits, paridad ${parity}, ${stopBits} stop`,
      "",
      ...entries.map((e) =>
        e.dir === "info"
          ? `[${e.time}] -- ${e.text}`
          : `[${e.time}] ${e.dir === "in" ? "<<" : ">>"} (${e.bytes.length} bytes)\n  TEXTO: ${toReadable(e.bytes).replace(/\n/g, "\n         ")}\n  HEX:   ${toHex(e.bytes)}`,
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `balanza-${Date.now()}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h1>Diagnóstico de balanza</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Muestra todo lo que envía la balanza, sin interpretar. Usalo para descubrir el formato del modo impresora o del
        modo continuo. Después tocá <b>Exportar</b> y mandá el archivo.
      </p>

      {!supported && (
        <div className="msg error">
          Este navegador no permite conectar puertos serie. Usá Google Chrome o Edge en una PC, o Chrome en Android.
        </div>
      )}
      {error && <div className="msg error">{error}</div>}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <div>
            <label>Velocidad (baudios)</label>
            <select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
              {BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 90 }}>
            <label>Bits</label>
            <select value={dataBits} onChange={(e) => setDataBits(Number(e.target.value))}>
              <option value={8}>8</option>
              <option value={7}>7</option>
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label>Paridad</label>
            <select value={parity} onChange={(e) => setParity(e.target.value)}>
              <option value="none">Ninguna</option>
              <option value="even">Par</option>
              <option value="odd">Impar</option>
            </select>
          </div>
          <div style={{ minWidth: 90 }}>
            <label>Stop</label>
            <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label>Agrupar si pausa &lt; (ms)</label>
            <input type="number" min={10} max={2000} value={gapMs} onChange={(e) => setGapMs(Number(e.target.value) || 150)} />
          </div>
          {!connected ? (
            <button className="primary" onClick={connect} disabled={!supported}>Conectar</button>
          ) : (
            <>
              <button onClick={reconnectWithNewSettings}>Aplicar config.</button>
              <button className="danger" onClick={disconnect}>Desconectar</button>
            </>
          )}
        </div>

        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="chips">
            <button disabled={!connected} onClick={() => send([0x05])}>Enviar ENQ (pedir peso)</button>
            <button disabled={!connected} onClick={() => send([0x06])}>ACK</button>
            <button disabled={!connected} onClick={() => send([0x15])}>NAK</button>
            <button disabled={!connected} onClick={() => send([0x11])}>XON</button>
          </div>
          <div style={{ minWidth: 200 }}>
            <label>Enviar bytes (hex)</label>
            <div className="row">
              <input value={hexInput} onChange={(e) => setHexInput(e.target.value)} placeholder="05 o 1B 40" />
              <button
                style={{ flex: "0 0 auto" }}
                disabled={!connected}
                onClick={() => { const b = parseHexInput(hexInput); if (b) send(b); else setError("Hex inválido"); }}
              >
                Enviar
              </button>
            </div>
          </div>
          <div className="chips" style={{ alignItems: "center" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={dtr} disabled={!connected} onChange={(e) => applySignals(e.target.checked, rts)} /> DTR
            </label>
            <label style={{ display: "flex", gap: 4, alignItems: "center", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={rts} disabled={!connected} onChange={(e) => applySignals(dtr, e.target.checked)} /> RTS
            </label>
            {connected && (
              <span className="muted">
                Entradas: {Object.entries(inSignals).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(" ") || "—"}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ marginBottom: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>
            Recibido <span className="muted">· {entries.filter((e) => e.dir === "in").length} mensajes · {totalBytes} bytes</span>
          </h2>
          <div className="chips" style={{ justifyContent: "flex-end" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={showHex} onChange={(e) => setShowHex(e.target.checked)} /> Hex
            </label>
            <button onClick={() => setPaused(!paused)}>{paused ? "Reanudar" : "Pausar"}</button>
            <button onClick={() => { setEntries([]); setTotalBytes(0); }}>Limpiar</button>
            <button className="primary" onClick={exportLog} disabled={entries.length === 0}>Exportar</button>
          </div>
        </div>

        <div className="spy-log">
          {entries.length === 0 && (
            <p className="muted">
              Esperando datos… Probá: <b>Enviar ENQ</b> (modo PC), o hacé una venta en la balanza configurada como
              impresora ECO. Si no llega nada, probá otra velocidad.
            </p>
          )}
          {entries.map((e) => (
            <div key={e.id} className={`spy-entry ${e.dir}`}>
              <span className="spy-time">{e.time}</span>
              {e.dir === "info" ? (
                <span className="spy-info">{e.text}</span>
              ) : (
                <div style={{ minWidth: 0 }}>
                  <span className="spy-dir">{e.dir === "in" ? "◀ balanza" : "▶ enviado"} · {e.bytes.length} B</span>
                  <pre className="spy-text">{toReadable(e.bytes)}</pre>
                  {showHex && <pre className="spy-hex">{toHex(e.bytes)}</pre>}
                  {e.dir === "in" && systelInfo(e.bytes) && <span className="spy-info">{systelInfo(e.bytes)}</span>}
                </div>
              )}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Cómo probar</h2>
        <ol className="muted" style={{ lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          <li>Conectá la balanza a la notebook con un cable USB ↔ RS-232 (o el boîtier Bluetooth ya emparejado).</li>
          <li><b>Modo PC</b>: 9600 / 8 / Ninguna / 1 → Conectar → <b>Enviar ENQ</b>. Debería llegar el peso.</li>
          <li><b>Modo impresora</b>: en la balanza MENÚ → Configuración → clave → <b>IMPrE</b> → ECO. Conectar y hacer una venta (PLU + peso + imprimir / TOTAL).</li>
          <li>Si no llega nada: probá otra velocidad (4800, 19200, 2400…) con <b>Aplicar config.</b>, y probá cambiar DTR/RTS.</li>
          <li>Si llegan caracteres raros (�, símbolos): la velocidad no es la correcta.</li>
          <li>Cuando veas datos, tocá <b>Exportar</b> y mandá el archivo .txt.</li>
        </ol>
      </section>
    </>
  );
}
