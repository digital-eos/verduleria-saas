/**
 * Etiquetas EAN-13 que imprime la balanza Systel Clipse/Croma.
 * Formato según manual:  SS PPPP VVVVVV C
 *   SS     = sector (01-99)
 *   PPPP   = PLU (código del producto en la balanza)
 *   VVVVVV = CANTIDAD (peso) o TOTAL (importe), según Menú > Configuración > EAN13
 *   C      = dígito verificador
 *
 * El manual no indica los decimales del valor: se configuran con NEXT_PUBLIC_EAN_DECIMALS.
 * Verificalo imprimiendo una etiqueta de peso conocido.
 */

export type ParsedLabel = {
  sector: string;
  code: string;
  mode: "CANTIDAD" | "TOTAL";
  /** kg si mode = CANTIDAD, importe si mode = TOTAL */
  value: number;
};

const MODE = (process.env.NEXT_PUBLIC_EAN_MODE ?? "CANTIDAD").toUpperCase() === "TOTAL" ? "TOTAL" : "CANTIDAD";
const DECIMALS = Number(process.env.NEXT_PUBLIC_EAN_DECIMALS ?? "3");

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

export function parseScaleLabel(raw: string): ParsedLabel | null {
  const code = raw.trim();
  if (!isValidEan13(code)) return null;
  const sector = code.slice(0, 2);
  const plu = code.slice(2, 6);
  const value = Number(code.slice(6, 12)) / Math.pow(10, DECIMALS);
  return { sector, code: plu, mode: MODE, value };
}
