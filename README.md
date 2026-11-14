# 🥬 Verdulería SaaS — Caja con balanza

Punto de venta web para verdulería: catálogo de productos vendidos **por kilo o por unidad**,
carga por código + peso/cantidad (manual o leyendo la balanza), validación del carrito,
medio de pago opcional y registro de ventas con fecha.

**Stack:** Next.js 15 (App Router) · Prisma 6 · PostgreSQL (Neon vía Vercel) · TypeScript.

## Pantallas

| Ruta         | Rol | Qué hace |
|--------------|-----|----------|
| `/login`     | —   | Ingreso. En el primer uso permite crear el administrador. |
| `/`          | —   | Página de presentación pública, con acceso a usuarios arriba a la derecha. |
| `/caja`      | Todos | **Caja**: código o nombre → peso (o cantidad) → carrito → medio de pago (opcional) → *Validar venta* (F2). |
| `/ventas`    | Todos | Ventas del día (el admin puede elegir cualquier día), detalle, medio de pago, CSV. Solo el admin anula. |
| `/dashboard` | Admin | Reportes por rango: facturación por día y por hora, ranking de productos, medio de pago, cajero. |
| `/productos` | Admin | Alta, edición, desactivación de productos (código PLU, nombre, por kilo / por unidad, precio). |
| `/usuarios`  | Admin | Alta de usuarios, rol (Admin / Cajero), reseteo de clave, desactivar. |
| `/auditoria` | Admin | Registro de ingresos, cambios de precio, anulaciones, cambios de usuarios… |

## Usuarios y permisos

- **Primer uso**: entrás a la app y te pide crear el usuario **administrador**. Después creás los cajeros en *Usuarios*.
- **Cajero**: caja, búsqueda de productos, ventas del día y corrección del medio de pago del día.
- **Admin**: todo lo anterior + precios/productos, anular ventas, ver cualquier fecha, reportes, usuarios y auditoría.
- Sesión de 12 h en cookie firmada (`AUTH_SECRET`). Las claves se guardan hasheadas (scrypt).
- Un usuario desactivado pierde el acceso al instante. Siempre tiene que quedar al menos un admin activo.
- Cada venta guarda qué usuario la hizo.

## API

| Método | Ruta | Body / descripción |
|---|---|---|
| GET | `/api/products?q=&all=1` | Lista productos |
| POST | `/api/products` | `{ code, name, unit: "KG"\|"UNIT", price }` |
| PUT / DELETE | `/api/products/:id` | Editar / borrar (si tiene ventas, se desactiva) |
| GET | `/api/products/by-code/:code` | Busca por PLU |
| POST | `/api/sales` | `{ items: [{ code, quantity }], paymentMethod? }` → valida, calcula y guarda. Devuelve el total. `quantity` = kg o unidades (entero). |
| GET | `/api/sales?date=AAAA-MM-DD` | Ventas del día + totales (cajero: solo hoy) |
| POST | `/api/auth/login` · `/api/auth/logout` · `/api/auth/setup` | Sesión y primer administrador |
| GET/POST · PUT | `/api/users` · `/api/users/:id` | Usuarios (admin) |
| GET | `/api/reports?from=&to=` | Reportes (admin) |
| GET | `/api/audit?from=&to=&action=` | Auditoría (admin) |
| PATCH | `/api/sales/:id` | `{ status: "CANCELLED" }` para anular · `{ paymentMethod }` para corregir el medio de pago |

> El precio **siempre** se toma de la base al validar (no del navegador), y cada línea guarda una
> copia del nombre y precio del momento: si mañana cambiás el precio, el histórico no cambia.

## Tablas

- `User` (username, name, passwordHash, role `ADMIN`/`CASHIER`, active)
- `AuditLog` (fecha, usuario, acción, entidad, detalle JSON con antes → después)
- `Product` (id, code único, name, unit `KG`/`UNIT`, price, active, fechas)
- `Sale` (id, createdAt, total, status, paymentMethod opcional, userId = cajero)
- `SaleItem` (saleId, productId, productCode, productName, unit, unitPrice, quantity, subtotal)

Medios de pago: Efectivo, Débito, Crédito, Transferencia, Mercado Pago, Otro (o ninguno).

## Correr en local (Windows)

```bash
npm install
copy .env.example .env      # completar DATABASE_URL
npx prisma migrate deploy   # crea las tablas
npm run db:seed             # (opcional) productos de ejemplo
npm run dev                 # http://localhost:3000
```

Necesitás una base Postgres: lo más simple es crear una gratis en Neon (o desde Vercel, ver abajo)
y pegar la URL en `.env`.

## Deploy en Vercel

1. Subí el repo a GitHub e importalo en Vercel.
2. En el proyecto de Vercel: **Storage → Create Database → Neon (Postgres)** y conectala al proyecto.
   Eso crea `DATABASE_URL` y `DATABASE_URL_UNPOOLED` automáticamente.
3. En **Settings → Environment Variables** agregá `AUTH_SECRET` (obligatoria, una clave larga y aleatoria:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. Deploy. El build corre `prisma migrate deploy`, así que las tablas se crean solas.
5. Entrá a la URL **enseguida** y creá el administrador (la pantalla de primer uso solo aparece mientras no haya usuarios).

## Conexión con la balanza Systel Clipse / Croma

Según el manual, la balanza **solo tiene salida serie RS-232** (no Bluetooth ni USB).
Hay dos formas de integrarla:

### Opción A — Leer el peso por cable (implementado)
- Comprá un **adaptador USB ↔ RS-232 (DB9)** (chip FTDI o Prolific) e instalá su driver.
  Según el pinout del manual puede hacer falta un cable cruzado (null-modem).
- En la balanza: 9600 baudios, 8 bits, sin paridad, 1 stop (valores por defecto).
- Abrí la app en **Chrome o Edge** (Web Serial no funciona en Firefox/Safari) → *Caja* → **Conectar** → elegí el puerto COM.
- Al ingresar un código, la app pide el peso a la balanza automáticamente (o con **F4**).
- Protocolo: PC envía `ENQ`, la balanza responde `STX + PESO + ETX + CRC`.
  El manual no detalla el formato exacto del peso: la pantalla muestra la **"Última trama"**
  recibida; si el peso sale mal, ajustá `parseWeightFrame` en `src/lib/scale.ts`.

### Opción B — Escanear la etiqueta (sin cable a la balanza)
La balanza imprime etiquetas EAN-13 `SS PPPP VVVVVV C` (sector, PLU, peso o importe, control).
Con un **lector de código de barras USB** (≈ USD 20, funciona como teclado) se escanea la etiqueta en
el campo código y la línea se agrega sola.
Configurar en `.env`: `NEXT_PUBLIC_EAN_MODE` (`CANTIDAD` o `TOTAL`, igual que en Menú → Configuración → EAN13)
y `NEXT_PUBLIC_EAN_DECIMALS` (verificar con una etiqueta de peso conocido).

**Importante:** los códigos PLU de la app tienen que coincidir con los PLU cargados en la balanza.

## Atajos de teclado (Caja)

`Enter` avanzar · `F4` leer balanza · `F2` validar venta · `Esc` cerrar ticket
