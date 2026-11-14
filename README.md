# 📒 Libretita — Chau cuaderno, hola Libretita

Punto de venta web para negocios de barrio (almacenes, kioscos, verdulerías…): catálogo de productos vendidos **por kilo o por unidad**,
carga por código + peso/cantidad (manual o leyendo la balanza), cobro del ticket,
medio de pago opcional y registro de ventas con fecha.

**Stack:** Next.js 15 (App Router) · Prisma 6 · PostgreSQL (Neon vía Vercel) · TypeScript.

## Pantallas

| Ruta         | Rol | Qué hace |
|--------------|-----|----------|
| `/login`     | —   | Ingreso. En el primer uso permite crear el administrador. |
| `/`          | —   | Página de presentación pública, con acceso a usuarios arriba a la derecha. |
| `/caja`      | Todos | **Caja** (cobrar): balanza, escáner o código/nombre → peso (o cantidad) → ticket → un toque en el medio de pago (Efectivo, Débito, Mercado Pago…) cobra directo (F2 = efectivo). |
| `/ventas`    | Todos | Ventas del día (el admin puede elegir cualquier día), detalle, medio de pago, CSV. Solo el admin anula. Pestaña **Reporte** (admin, `/ventas?vista=reporte`): por rango, facturación por día y por hora, ranking de productos, medio de pago, cajero. `/dashboard` redirige acá. |
| `/productos` | Admin | Alta, edición, desactivación de productos (código PLU, nombre, por kilo / por unidad, precio). |
| `/usuarios`  | Admin | Alta de usuarios, rol (Admin / Cajero), reseteo de clave, desactivar. |
| `/auditoria` | Admin | Registro de ingresos, cambios de precio, anulaciones, cambios de usuarios… |
| `/configuracion` | Admin | Ajustes técnicos. `/configuracion/balanza`: diagnóstico de la balanza (modo espía). |

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
| POST | `/api/payments/orders` | `{ items: [{ code, quantity }] }` → crea un cobro con QR (Mercado Pago). Devuelve `orderId`, `qrData`, `expiresAt`. |
| GET | `/api/payments/orders/:orderId` | Estado del cobro (la caja lo consulta cada 3 s). Si está pagado, registra la venta. |
| POST | `/api/payments/orders/:orderId/cancel` | Cancela el cobro |
| POST | `/api/payments/orders/:orderId/simulate` | **Solo modo demo**: simula el pago |
| POST | `/api/webhooks/mercadopago` | Notificaciones de Mercado Pago (pública, validada con firma) |

> El precio **siempre** se toma de la base al validar (no del navegador), y cada línea guarda una
> copia del nombre y precio del momento: si mañana cambiás el precio, el histórico no cambia.

## Tablas

- `User` (username, name, passwordHash, role `ADMIN`/`CASHIER`, active)
- `AuditLog` (fecha, usuario, acción, entidad, detalle JSON con antes → después)
- `Product` (id, code único, name, unit `KG`/`UNIT`, price, active, fechas)
- `Sale` (id, createdAt, total, status, paymentMethod opcional, userId = cajero)
- `SaleItem` (saleId, productId, productCode, productName, unit, unitPrice, quantity, subtotal)
- `payment_orders` (id, sale_id, provider `mock`/`mercadopago`, mp_order_id, total_amount, qr_data, status, expires_at, items, fechas)

## Cobro con QR de Mercado Pago

En la caja, tocá **Mercado Pago (QR)**: aparece un QR dinámico
por el total del ticket, válido 16 minutos. La caja consulta el estado cada 3 s; cuando el pago queda
aprobado (`processed`) se registra la venta sola, con medio de pago *Mercado Pago*.

- **Modo demo** (`PAYMENT_PROVIDER=mock`, por defecto): no se cobra nada. El modal muestra *MODO DEMO* y un
  botón *Simular pago (demo)*. Con `MOCK_AUTO_APPROVE_SECONDS=8` se aprueba solo a los 8 s.
- **Producción**: `PAYMENT_PROVIDER=mercadopago` + `MP_ACCESS_TOKEN`, `MP_EXTERNAL_POS_ID`, `MP_WEBHOOK_SECRET`.
  Además, en Mercado Pago: crear la sucursal y la caja (POS) y configurar el webhook de **Order** apuntando a
  `https://<tu-dominio>/api/webhooks/mercadopago`. Nada más cambia: la interfaz es la misma.

Toda la comunicación con Mercado Pago pasa por el servidor (`src/lib/payments/`): el access token nunca
llega al navegador. Los puntos a revisar al conectar la API real están marcados con `// TODO MP:`.

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

`Enter` avanzar · `F4` leer balanza · `F2` cobrar en efectivo · `Esc` cerrar ticket
