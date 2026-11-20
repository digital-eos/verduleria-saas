/** Sin dependencias de servidor: lo usan la Caja (navegador) y las ventas (servidor). */
export type CatalogFields = { name: string; presentation: string | null };

/** Nombre para el producto: el del catálogo + la presentación si no la trae ("Coca-Cola" + "2,25 l"). */
export function suggestedName(hit: CatalogFields): string {
  const pres = hit.presentation?.trim();
  if (!pres) return hit.name;
  const num = pres.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".");
  return num && hit.name.replace(/,/g, ".").includes(num) ? hit.name : `${hit.name} ${pres}`;
}
