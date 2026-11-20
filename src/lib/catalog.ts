import { prisma } from "@/lib/prisma";

/**
 * Catálogo de productos de Argentina: código de barras → nombre, marca y presentación.
 * 1) Tabla `catalog_products` (cargada con el dataset SEPA, ver scripts/import-sepa.mjs)
 * 2) Si no está, Open Food Facts en vivo; lo que encuentra se guarda en la tabla para la próxima.
 */

export type CatalogHit = {
  ean: string;
  name: string;
  brand: string | null;
  presentation: string | null;
  source: string;
};

/**
 * Clave del catálogo: el GTIN completado con ceros a 14 dígitos, así "7790895000997", "07790895000997"
 * o un UPC-A de 12 dígitos caen en la misma fila. Devuelve null si no es un GTIN válido
 * (8, 12, 13 o 14 dígitos con dígito verificador correcto). Igual que en scripts/import-sepa.mjs.
 */
export function gtinKey(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return null;
  const g = s.padStart(14, "0");
  if (/^0+$/.test(g)) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(g[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[13]) ? g : null;
}

const OFF_TIMEOUT_MS = 3500;
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
/** Códigos que Open Food Facts no conoce (por instancia del servidor), para no repetir la consulta. */
const offMisses = new Map<string, number>();

const clean = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim().replace(/\s+/g, " ") : null);

async function fetchOpenFoodFacts(key: string): Promise<CatalogHit | null> {
  const missAt = offMisses.get(key);
  if (missAt && Date.now() - missAt < MISS_TTL_MS) return null;

  // OFF guarda los EAN-13 sin el cero inicial del GTIN-14
  const code = key.replace(/^0+/, "").padStart(13, "0");
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${code}.json` +
    "?fields=product_name_es,product_name,brands,quantity";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Libretita/1.0 (punto de venta)" },
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) {
      offMisses.set(key, Date.now());
      return null;
    }
    if (!res.ok) return null; // error temporal: no se marca como inexistente
    const data = await res.json();
    const p = data?.product;
    const name = clean(p?.product_name_es) ?? clean(p?.product_name);
    if (data?.status !== 1 || !name) {
      offMisses.set(key, Date.now());
      return null;
    }
    const brand = clean(p.brands)?.split(",")[0].trim() ?? null;
    return { ean: key, name, brand, presentation: clean(p.quantity), source: "off" };
  } catch {
    return null; // sin internet o timeout: la Caja sigue sin nombre sugerido
  }
}

/** Solo la tabla local (sin Open Food Facts): para ventas, donde no se puede esperar a internet. */
export async function findInCatalog(keys: string[]): Promise<Map<string, CatalogHit>> {
  if (!keys.length) return new Map();
  const rows = await prisma.catalogProduct.findMany({ where: { ean: { in: keys } } });
  return new Map(rows.map((r) => [r.ean, toHit(r)]));
}

const toHit = (r: CatalogHit): CatalogHit => ({
  ean: r.ean,
  name: r.name,
  brand: r.brand,
  presentation: r.presentation,
  source: r.source,
});

export async function lookupCatalog(raw: string): Promise<CatalogHit | null> {
  const key = gtinKey(raw);
  if (!key) return null;

  const row = await prisma.catalogProduct.findUnique({ where: { ean: key } });
  if (row) return toHit(row);

  const hit = await fetchOpenFoodFacts(key);
  if (hit) {
    await prisma.catalogProduct
      .upsert({
        where: { ean: key },
        create: { ean: key, name: hit.name, brand: hit.brand, presentation: hit.presentation, source: "off" },
        update: {},
      })
      .catch(() => {}); // si falla el guardado igual se devuelve el nombre
  }
  return hit;
}
