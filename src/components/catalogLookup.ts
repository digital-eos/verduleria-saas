import type { CatalogHit } from "@/lib/catalog";
import { apiFetch } from "@/components/SessionProvider";

export type { CatalogHit };
export { suggestedName } from "@/lib/catalogName";

/** Busca un código de barras en el catálogo de productos de Argentina. null si no está o no es un EAN. */
export async function fetchCatalog(code: string): Promise<CatalogHit | null> {
  if (!/^\d{8,14}$/.test(code.trim())) return null; // los PLU cortos de la balanza no están en el catálogo
  try {
    const res = await apiFetch(`/api/catalog/${encodeURIComponent(code.trim())}`);
    return res.ok ? ((await res.json()) as CatalogHit) : null;
  } catch {
    return null;
  }
}
