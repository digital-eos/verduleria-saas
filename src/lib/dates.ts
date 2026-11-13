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
