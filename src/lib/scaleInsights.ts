import { prisma } from "@/lib/prisma";
import { TZ } from "@/lib/dates";

/**
 * Análisis de las ventas de balanza que llegan SIN producto (solo precio por kilo).
 *
 * Las líneas pesadas de los equipos se guardan con productId = null y código "BAL-<precio>".
 * Como el precio por kilo de cada producto está en el catálogo (y sus cambios quedan en la
 * auditoría), se puede deducir qué producto era: el/los producto(s) por kilo que tenían ese
 * precio en el momento de la venta. Si un solo producto coincide → identificado; si varios →
 * ambiguo (se muestran todos); si ninguno → queda solo el precio.
 *
 * Cuando una balanza mande el PLU, la línea trae productId y deja de pasar por acá.
 */

const SCALE_KG_PREFIX = "BAL-";
const SCALE_UNIT_PREFIX = "BAL-U-";

export const isScaleKgLine = (i: { productId: number | null; productCode: string; unit: string }) =>
  i.productId === null && i.unit === "KG" && i.productCode.startsWith(SCALE_KG_PREFIX) && !i.productCode.startsWith(SCALE_UNIT_PREFIX);

type Segment = { productId: number; name: string; active: boolean; price: string; from: number; to: number };

/** Precio vigente de cada producto por kilo a lo largo del tiempo, a partir del precio actual y la auditoría */
async function priceHistory(): Promise<Map<string, Segment[]>> {
  const products = await prisma.product.findMany({
    where: { unit: "KG" },
    select: { id: true, name: true, price: true, active: true, createdAt: true },
  });
  const logs = await prisma.auditLog.findMany({
    where: { action: "PRODUCT_UPDATE", entity: "Product" },
    select: { entityId: true, createdAt: true, details: true },
    orderBy: { createdAt: "desc" },
  });
  const changes = new Map<number, { at: number; before: string }[]>();
  for (const l of logs) {
    const d = l.details as { price?: { antes?: unknown } } | null;
    if (!d?.price || !l.entityId) continue;
    const before = d.price.antes ?? 0; // null = antes no tenía precio
    const id = Number(l.entityId);
    const list = changes.get(id) ?? [];
    list.push({ at: l.createdAt.getTime(), before: Number(before).toFixed(2) });
    changes.set(id, list);
  }

  const byPrice = new Map<string, Segment[]>();
  const add = (s: Segment) => {
    if (Number(s.price) <= 0) return; // tramo sin precio
    const list = byPrice.get(s.price) ?? [];
    list.push(s);
    byPrice.set(s.price, list);
  };
  for (const p of products) {
    // Recorre los cambios del más nuevo al más viejo: [cambio, fin) tenía el precio "después"
    let price = p.price === null ? "0.00" : p.price.toFixed(2);
    let to = Infinity;
    for (const c of changes.get(p.id) ?? []) {
      add({ productId: p.id, name: p.name, active: p.active, price, from: c.at, to });
      price = c.before;
      to = c.at;
    }
    // Antes del primer cambio: desde siempre (puede haber ventas de balanza antes de cargarlo)
    add({ productId: p.id, name: p.name, active: p.active, price, from: -Infinity, to });
  }
  return byPrice;
}

export type ScaleLine = { createdAt: Date; unitPrice: number; quantity: number; subtotal: number };

export type ScalePriceRow = {
  price: number;
  kg: number;
  total: number;
  lines: number;
  /** Líneas para las que había al menos un producto con ese precio en ese momento */
  matchedLines: number;
  share: number; // % de los kilos de balanza
  peakHour: number | null;
  kgByHour: number[]; // 24 posiciones
  /** Productos que tenían ese precio por kilo al momento de las ventas (lines = cuántas líneas coinciden) */
  candidates: { id: number; name: string; lines: number }[];
  /** "identificado" = un solo producto; "ambiguo" = varios; "sin_producto" = ninguno (ver matchedLines si es parcial) */
  match: "identificado" | "ambiguo" | "sin_producto";
};

export type ScaleInsights = {
  kg: number;
  total: number;
  lines: number;
  kgByHour: number[];
  peakHour: number | null;
  byPrice: ScalePriceRow[]; // ordenado por kilos (desc)
};

const hourAR = (d: Date) => Number(d.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const peak = (arr: number[]) => (arr.some((v) => v > 0) ? arr.indexOf(Math.max(...arr)) : null);

export async function scaleInsights(lines: ScaleLine[]): Promise<ScaleInsights> {
  const history = lines.length ? await priceHistory() : new Map<string, Segment[]>();
  const groups = new Map<string, { price: number; kg: number; total: number; lines: number; matched: number; kgByHour: number[]; cand: Map<number, { id: number; name: string; lines: number }> }>();
  const kgByHour = Array<number>(24).fill(0);
  let kg = 0, total = 0;

  for (const l of lines) {
    const key = l.unitPrice.toFixed(2);
    const g = groups.get(key) ?? { price: l.unitPrice, kg: 0, total: 0, lines: 0, matched: 0, kgByHour: Array<number>(24).fill(0), cand: new Map() };
    const h = hourAR(l.createdAt);
    g.kg += l.quantity; g.total += l.subtotal; g.lines++; g.kgByHour[h] += l.quantity;
    kg += l.quantity; total += l.subtotal; kgByHour[h] += l.quantity;

    const t = l.createdAt.getTime();
    let found = false;
    for (const s of history.get(key) ?? []) {
      if (t < s.from || t >= s.to) continue;
      found = true;
      const c = g.cand.get(s.productId) ?? { id: s.productId, name: s.name, lines: 0 };
      c.lines++;
      g.cand.set(s.productId, c);
    }
    if (found) g.matched++;
    groups.set(key, g);
  }

  const byPrice: ScalePriceRow[] = [...groups.values()]
    .map((g) => {
      const candidates = [...g.cand.values()].sort((a, b) => b.lines - a.lines);
      return {
        price: g.price,
        kg: r3(g.kg),
        total: r2(g.total),
        lines: g.lines,
        matchedLines: g.matched,
        share: kg ? Math.round((g.kg / kg) * 1000) / 10 : 0,
        peakHour: peak(g.kgByHour),
        kgByHour: g.kgByHour.map(r3),
        candidates,
        match: candidates.length === 0 ? "sin_producto" : candidates.length === 1 ? "identificado" : "ambiguo",
      } as ScalePriceRow;
    })
    .sort((a, b) => b.kg - a.kg);

  return { kg: r3(kg), total: r2(total), lines: lines.length, kgByHour: kgByHour.map(r3), peakHour: peak(kgByHour), byPrice };
}
