/**
 * Lectura de peso desde la balanza Systel Clipse/Croma por puerto serie (RS-232),
 * usando la Web Serial API (Chrome / Edge de escritorio, sobre https o localhost).
 *
 * Protocolo según manual (pregunta-respuesta):
 *   PC  -> ENQ (0x05)
 *   Bal -> STX (0x02) + PESO + ETX (0x03) + CRC     (o WACK 0x11 = "esperá")
 *   PC  -> ACK (0x06) si llegó bien / NACK (0x15) si no
 * Config por defecto de la balanza: 9600 baudios, 8 bits, sin paridad, 1 bit de stop.
 *
 * CRC según manual (pág. 29): STX XOR Dato1 XOR ... XOR DatoN XOR ETX (1 byte).
 * El manual NO detalla el formato del PESO, así que el parser es tolerante:
 * toma los dígitos entre STX y ETX. Ajustá `parseWeightFrame` con una trama real.
 */

const ENQ = 0x05, STX = 0x02, ETX = 0x03, ACK = 0x06, NACK = 0x15, WACK = 0x11;

// Tipos mínimos de Web Serial (no vienen en lib.dom de TypeScript)
type SerialPortLike = {
  open(opts: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

export const isSerialSupported = () =>
  typeof navigator !== "undefined" && "serial" in navigator;

export type ScaleReading = { kg: number; raw: string };

/** CRC Systel: XOR de STX, todos los bytes de datos y ETX */
export function systelCrc(payload: number[]): number {
  return payload.reduce((acc, b) => acc ^ b, STX ^ ETX);
}

/** Interpreta el contenido entre STX y ETX. */
export function parseWeightFrame(payload: string): number | null {
  const clean = payload.replace(/[^\d.,-]/g, "");
  if (!clean) return null;
  // Si trae separador decimal, se usa tal cual.
  if (/[.,]/.test(clean)) {
    const n = Number(clean.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  // Sin separador: asumimos gramos (ej. "01250" = 1,250 kg). Verificar con la balanza real.
  const n = Number(clean);
  return Number.isFinite(n) ? n / 1000 : null;
}

export class SystelScale {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer: number[] = [];

  get connected() {
    return this.port !== null;
  }

  async connect(baudRate = 9600) {
    if (!isSerialSupported()) throw new Error("Este navegador no soporta Web Serial. Usá Chrome o Edge.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const port: SerialPortLike = await (navigator as any).serial.requestPort();
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
    this.port = port;
    this.reader = port.readable!.getReader();
    this.writer = port.writable!.getWriter();
  }

  async disconnect() {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } finally {
      this.port = null;
      this.reader = null;
      this.writer = null;
      this.buffer = [];
    }
  }

  private async send(byte: number) {
    await this.writer!.write(new Uint8Array([byte]));
  }

  private async readByte(timeoutMs: number): Promise<number | null> {
    if (this.buffer.length) return this.buffer.shift()!;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    const read = this.reader!.read().then(({ value }) => {
      if (value) this.buffer.push(...value);
      return this.buffer.length ? this.buffer.shift()! : null;
    });
    return Promise.race([read, timeout]);
  }

  /** Pide el peso a la balanza. Reintenta si la balanza responde WACK. */
  async readWeight(retries = 5, timeoutMs = 1500): Promise<ScaleReading> {
    if (!this.port) throw new Error("Balanza no conectada");
    for (let attempt = 0; attempt < retries; attempt++) {
      this.buffer = [];
      await this.send(ENQ);

      let byte = await this.readByte(timeoutMs);
      if (byte === WACK) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      // Avanzar hasta STX
      while (byte !== null && byte !== STX) byte = await this.readByte(timeoutMs);
      if (byte === null) continue;

      const payload: number[] = [];
      byte = await this.readByte(timeoutMs);
      while (byte !== null && byte !== ETX) {
        payload.push(byte);
        byte = await this.readByte(timeoutMs);
      }
      if (byte === null) { await this.send(NACK); continue; }
      const crc = await this.readByte(300);
      if (crc === null || crc !== systelCrc(payload)) { await this.send(NACK); continue; }

      const raw = String.fromCharCode(...payload);
      const kg = parseWeightFrame(raw);
      if (kg === null) { await this.send(NACK); continue; }
      await this.send(ACK);
      return { kg, raw };
    }
    throw new Error("La balanza no respondió. Revisá cable, puerto y velocidad (9600).");
  }
}
