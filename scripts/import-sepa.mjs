// Carga el catálogo de productos de Argentina (tabla catalog_products) desde el dataset abierto SEPA
// (Precios Claros, Secretaría de Comercio, licencia CC-BY 4.0):
//   https://datos.produccion.gob.ar/dataset/sepa-precios   → descargar un "sepa_<día>.zip"
//
//   npm run catalog:import-sepa -- C:\Descargas\sepa_jueves.zip
//   npm run catalog:import-sepa -- https://datos.produccion.gob.ar/.../download/sepa_jueves.zip
//   npm run catalog:import-sepa -- carpeta-ya-descomprimida   (o un productos.csv suelto)
//   npm run catalog:import-sepa -- --dry-run sepa_jueves.zip  → solo lee y muestra ejemplos, no toca la base
//
// El zip trae un zip por cadena de supermercados, cada uno con su productos.csv (una fila por
// sucursal y producto). Se descomprime todo con `tar` (incluido en Windows 10+, macOS y Linux con bsdtar;
// si no, `unzip`), se juntan los códigos de barras válidos y se hace upsert: el nombre que queda es la
// descripción más usada entre las cadenas. Se puede volver a correr cuando se quiera para actualizar.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, basename } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PrismaClient, Prisma } from "@prisma/client";

const dryRun = process.argv.includes("--dry-run");
const inputs = process.argv.slice(2).filter((a) => a !== "--dry-run");
if (!inputs.length) {
  console.error("Uso: npm run catalog:import-sepa -- <sepa.zip | URL | carpeta | productos.csv> [...]");
  process.exit(1);
}

/** Igual que gtinKey() en src/lib/catalog.ts: GTIN válido completado a 14 dígitos, o null. */
function gtinKey(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return null;
  const g = s.padStart(14, "0");
  if (/^0+$/.test(g)) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(g[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[13]) ? g : null;
}

const clean = (s) => (s ?? "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
/** "GASEOSA COCA COLA 2.25 LT" → "Gaseosa Coca Cola 2.25 Lt" (solo si viene todo en mayúsculas) */
const tidy = (s) =>
  /[a-zà-ÿ]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());

// En Windows, "tar" puede ser el GNU tar de Git (no abre .zip): se usa el bsdtar del sistema
const TAR = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
function unzip(file, dest) {
  const tries = [
    [TAR, ["-xf", file, "-C", dest]],
    ["unzip", ["-o", "-q", file, "-d", dest]],
    ["powershell", ["-NoProfile", "-Command", "Expand-Archive -Force -LiteralPath $args[0] -DestinationPath $args[1]", file, dest]],
  ];
  for (const [cmd, args] of tries) {
    try {
      execFileSync(cmd, args, { stdio: "ignore" });
      return;
    } catch {}
  }
  throw new Error(`No se pudo descomprimir ${file}`);
}

/** Descomprime recursivamente los .zip de `dir` y devuelve los productos*.csv encontrados. */
async function collectCsv(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await collectCsv(p, out);
    else if (extname(p).toLowerCase() === ".zip") {
      const sub = await mkdtemp(join(work, "z-")); // nunca dentro de la carpeta del usuario
      unzip(p, sub);
      await collectCsv(sub, out);
    } else if (/^productos.*\.csv$/i.test(entry.name)) out.push(p);
  }
  return out;
}

async function detectEncoding(file) {
  const fh = await open(file, "r");
  const { buffer, bytesRead } = await fh.read(Buffer.alloc(256 * 1024), 0, 256 * 1024, 0);
  await fh.close();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, Math.max(0, bytesRead - 4)));
    return "utf8";
  } catch {
    return "latin1";
  }
}

/** ean → { names: Map<nombre, veces>, brands: Map, pres: Map } */
const catalog = new Map();
/** Unidad normalizada: "Grs." → "g", "Kgm" → "kg", "Lts" → "l", "cc" → "ml", "Un" → "u" */
const UNITS = [
  [/^(kgs?|kgm|kilos?|kilogramos?)$/, "kg"],
  [/^(g|gr|grs|gramos?|grm)$/, "g"],
  [/^(l|lt|lts|litros?|ltr)$/, "l"],
  [/^(ml|cc|cm3|mls)$/, "ml"],
  [/^(un|u|uni|unid|unidad(es)?)$/, "u"],
  [/^(mt|mts|m|metros?)$/, "m"],
];
function unitOf(raw) {
  const u = String(raw ?? "").toLowerCase().replace(/[.\s]/g, "");
  return UNITS.find(([re]) => re.test(u))?.[1] ?? null;
}

/** "0.800" + "gr." → "800 g" (un gramaje < 1 en realidad son kilos); "2.250" + "lt" → "2,25 l" */
function formatPresentation(qtyRaw, unitRaw) {
  let n = Number(String(qtyRaw ?? "").replace(",", "."));
  let u = unitOf(unitRaw);
  if (!Number.isFinite(n) || n <= 0 || !u) return null;
  if (u === "g" && n < 1) n *= 1000;
  if (u === "ml" && n < 1) n *= 1000;
  if (u === "kg" && n < 1) [n, u] = [n * 1000, "g"];
  if (u === "l" && n < 1) [n, u] = [n * 1000, "ml"];
  if (u === "g" && n >= 1000 && n % 100 === 0) [n, u] = [n / 1000, "kg"];
  if (u === "ml" && n >= 1000 && n % 100 === 0) [n, u] = [n / 1000, "l"];
  const num = String(Math.round(n * 1000) / 1000).replace(".", ",");
  return `${num} ${u}`;
}

/** Última medida que aparece en el nombre: "Nutrilon 4 Pouch X 1.2 kg" → "1,2 kg", "x750g" → "750 g" */
function presentationFromName(name) {
  const re = /(\d+(?:[.,]\d+)?)\s*(kgs?|kgm|kilos?|grs?\.?|gramos|g|lts?\.?|litros?|l|ml|cc|cm3)(?![a-z])/gi;
  let last = null;
  for (const m of name.matchAll(re)) last = m;
  return last ? formatPresentation(last[1], last[2]) : null;
}

const bump = (m, k) => k && m.set(k, (m.get(k) ?? 0) + 1);
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

async function readProductos(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: await detectEncoding(file) }), crlfDelay: Infinity });
  let cols = null;
  let sep = "|";
  let rows = 0;
  let valid = 0;
  for await (let line of rl) {
    if (!cols) {
      line = line.replace(/^\uFEFF/, "");
      sep = ["|", ";", ",", "\t"].find((d) => line.includes(d)) ?? "|";
      const h = line.split(sep).map((c) => clean(c).toLowerCase());
      const idx = (...names) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
      cols = {
        n: h.length,
        ean: idx("productos_ean", "ean"),
        id: idx("id_producto"),
        name: idx("productos_descripcion", "descripcion"),
        brand: idx("productos_marca", "marca"),
        qty: idx("productos_cantidad_presentacion"),
        unit: idx("productos_unidad_medida_presentacion"),
      };
      if (cols.name < 0 || (cols.ean < 0 && cols.id < 0)) {
        console.warn(`  ! ${file}: columnas no reconocidas (${h.join(", ")}), se saltea`);
        return;
      }
      continue;
    }
    const f = line.split(sep);
    if (f.length < cols.n) continue; // pie "Última actualización: ..." o fila rota
    rows++;
    // `productos_ean` a veces es el código y a veces una marca 0/1 que indica si `id_producto` es un EAN
    const key = gtinKey(clean(f[cols.ean])) ?? gtinKey(clean(f[cols.id]));
    const name = clean(f[cols.name]);
    if (!key || !name) continue;
    valid++;
    let e = catalog.get(key);
    if (!e) catalog.set(key, (e = { names: new Map(), brands: new Map(), pres: new Map() }));
    if (e.names.size < 8 || e.names.has(name)) bump(e.names, name);
    if (cols.brand >= 0 && e.brands.size < 8) bump(e.brands, clean(f[cols.brand]));
    if (e.pres.size < 8) {
      // Los campos de presentación vienen mal cargados seguido ("1 gr" en un paquete de 1 kg):
      // primero se lee del nombre ("x 800 gr", "1.2 kg"), y si no, de los campos
      const pres =
        presentationFromName(name) ??
        (cols.qty >= 0 ? formatPresentation(clean(f[cols.qty]), cols.unit >= 0 ? clean(f[cols.unit]) : "") : null);
      bump(e.pres, pres);
    }
  }
  console.log(`  ${basename(file)}: ${rows.toLocaleString("es-AR")} filas, ${valid.toLocaleString("es-AR")} con código de barras`);
}

const entries0 = () => [...catalog.entries()].slice(0, 15);
const work = await mkdtemp(join(tmpdir(), "libretita-sepa-"));
const prisma = dryRun ? null : new PrismaClient();
try {
  const files = [];
  for (const input of inputs) {
    if (/^https?:\/\//i.test(input)) {
      const dest = join(work, `descarga-${files.length}.zip`);
      console.log(`Descargando ${input} …`);
      const res = await fetch(input);
      if (!res.ok || !res.body) throw new Error(`No se pudo descargar (${res.status})`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const sub = await mkdtemp(join(work, "u-"));
      unzip(dest, sub);
      files.push(...(await collectCsv(sub)));
    } else if ((await stat(input)).isDirectory()) {
      files.push(...(await collectCsv(input)));
    } else if (extname(input).toLowerCase() === ".zip") {
      const sub = await mkdtemp(join(work, "u-"));
      unzip(input, sub);
      files.push(...(await collectCsv(sub)));
    } else files.push(input);
  }
  if (!files.length) throw new Error("No se encontró ningún productos.csv");

  console.log(`Leyendo ${files.length} archivo(s) productos.csv …`);
  for (const f of files) await readProductos(f);
  console.log(`Productos distintos con código de barras: ${catalog.size.toLocaleString("es-AR")}`);

  if (dryRun) {
    for (const [ean, e] of entries0()) {
      console.log(`  ${ean}  ${tidy(top(e.names))}  | ${top(e.brands) ?? "—"} | ${top(e.pres) ?? "—"}`);
    }
    console.log("--dry-run: no se guardó nada.");
  } else await save();
} catch (e) {
  console.error(`\nError: ${e.message}`);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
  await rm(work, { recursive: true, force: true });
}

async function save() {
  const now = new Date();
  const entries = [...catalog.entries()];
  const BATCH = 1000;
  for (let i = 0; i < entries.length; i += BATCH) {
    const values = entries.slice(i, i + BATCH).map(([ean, e]) => {
      const brand = top(e.brands);
      return Prisma.sql`(${ean}, ${tidy(top(e.names))}, ${brand ? tidy(brand) : null}, ${top(e.pres)}, 'sepa', ${now})`;
    });
    await prisma.$executeRaw`
      INSERT INTO "catalog_products" ("ean", "name", "brand", "presentation", "source", "updated_at")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("ean") DO UPDATE SET
        "name" = EXCLUDED."name", "brand" = EXCLUDED."brand", "presentation" = EXCLUDED."presentation",
        "source" = EXCLUDED."source", "updated_at" = EXCLUDED."updated_at"`;
    process.stdout.write(`\r  Guardados ${Math.min(i + BATCH, entries.length).toLocaleString("es-AR")}/${entries.length.toLocaleString("es-AR")}`);
  }
  const total = await prisma.catalogProduct.count();
  console.log(`\nListo. El catálogo tiene ${total.toLocaleString("es-AR")} productos.`);
}
