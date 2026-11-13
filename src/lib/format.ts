const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const kg = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const formatMoney = (n: number | string) => money.format(Number(n));
export const formatKg = (n: number | string) => `${kg.format(Number(n))} kg`;

/** "1,250 kg" o "3 u." según la unidad */
export const formatQty = (n: number | string, unit: "KG" | "UNIT") =>
  unit === "KG" ? formatKg(n) : `${Number(n).toLocaleString("es-AR")} u.`;

/** "$2.500,00/kg" o "$800,00/u." */
export const formatUnitPrice = (n: number | string, unit: "KG" | "UNIT") =>
  `${formatMoney(n)}/${unit === "KG" ? "kg" : "u."}`;

export const formatDateTime = (d: string | Date) =>
  new Date(d).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  });

/** Acepta "1,250" o "1.250" o "1250g" y devuelve kg como número. */
export function parseWeightInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s/g, "");
  if (!s) return null;
  const grams = s.endsWith("g") && !s.endsWith("kg");
  const n = Number(s.replace(/kg|g/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return grams ? n / 1000 : n;
}

/** Normaliza el código: quita espacios y completa con ceros a 4 dígitos si es numérico corto. */
export function normalizeCode(raw: string): string {
  const s = raw.trim();
  return /^\d{1,4}$/.test(s) ? s.padStart(4, "0") : s;
}
