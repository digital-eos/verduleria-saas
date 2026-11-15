/** Utilidades de fechas en hora de Argentina (UTC-3, sin horario de verano). */

export const TZ = "America/Argentina/Buenos_Aires";
const OFFSET = "-03:00";
const DAY_MS = 24 * 60 * 60 * 1000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-12" de hoy en Argentina */
export const todayAR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/** "2026-11-12" de una fecha cualquiera, en Argentina */
export const dateKeyAR = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** Rango [desde, hasta) en UTC que cubre los días from..to (inclusive) en Argentina */
export function rangeAR(from: string, to: string) {
  const start = new Date(`${from}T00:00:00${OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${OFFSET}`).getTime() + DAY_MS);
  return { start, end };
}

/** Lista de días "AAAA-MM-DD" entre from y to (inclusive) */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const { start, end } = rangeAR(from, to);
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) out.push(dateKeyAR(new Date(t)));
  return out;
}

/** Suma (o resta) días a "AAAA-MM-DD" */
export function addDays(date: string, n: number): string {
  return dateKeyAR(new Date(new Date(`${date}T12:00:00${OFFSET}`).getTime() + n * DAY_MS));
}

/** Día de la semana de "AAAA-MM-DD" (0 = domingo … 6 = sábado) */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00${OFFSET}`).getUTCDay();

/** Lunes de la semana que contiene `date` */
export const weekStart = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

/** Último día del mes de `date` */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

/** Suma (o resta) meses; devuelve el día 1 del mes resultante */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export type Period = "dia" | "semana" | "mes";

/** Rango [from, to] del período que contiene `anchor` */
export function periodRange(period: Period, anchor: string): { from: string; to: string } {
  if (period === "semana") { const from = weekStart(anchor); return { from, to: addDays(from, 6) }; }
  if (period === "mes") return { from: anchor.slice(0, 8) + "01", to: monthEnd(anchor) };
  return { from: anchor, to: anchor };
}

/** Mueve el ancla un período hacia adelante (n > 0) o atrás (n < 0) */
export function shiftPeriod(period: Period, anchor: string, n: number): string {
  if (period === "semana") return addDays(anchor, 7 * n);
  if (period === "mes") return addMonths(anchor, n);
  return addDays(anchor, n);
}
