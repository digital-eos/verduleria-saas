-- Multi-comercio: cada comercio ve solo sus productos, ventas, usuarios y auditoría.
-- Los datos que ya existen (instalación de un solo comercio) quedan en el primer comercio.

-- 1) Comercio por defecto para los datos existentes (solo si hay datos y todavía no hay ningún comercio)
INSERT INTO "merchants" ("name", "updated_at")
SELECT 'Mi comercio', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "merchants")
  AND (EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "Product") OR EXISTS (SELECT 1 FROM "Sale")
       OR EXISTS (SELECT 1 FROM "AuditLog"));

-- 2) Usuarios: email / Google / verificación; la clave pasa a ser opcional (cuentas solo con Google)
ALTER TABLE "User" DROP CONSTRAINT "User_merchantId_fkey";
ALTER TABLE "User" ADD COLUMN "email" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "googleId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;
UPDATE "User" SET "merchantId" = (SELECT MIN("id") FROM "merchants") WHERE "merchantId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "merchantId" SET NOT NULL;

-- 3) Productos, ventas y auditoría: columna del comercio + reparto de lo existente
ALTER TABLE "Product" ADD COLUMN "merchantId" INTEGER;
ALTER TABLE "Sale" ADD COLUMN "merchantId" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN "merchantId" INTEGER;

UPDATE "Product" SET "merchantId" = (SELECT MIN("id") FROM "merchants");
-- La venta va al comercio de su cajero (o del equipo de balanza), si no al primero
UPDATE "Sale" s SET "merchantId" = u."merchantId" FROM "User" u WHERE s."userId" = u."id";
UPDATE "Sale" s SET "merchantId" = ds."merchant_id"
  FROM "device_sales" ds WHERE ds."sale_id" = s."id" AND ds."merchant_id" IS NOT NULL AND s."merchantId" IS NULL;
UPDATE "Sale" SET "merchantId" = (SELECT MIN("id") FROM "merchants") WHERE "merchantId" IS NULL;
UPDATE "AuditLog" a SET "merchantId" = u."merchantId" FROM "User" u WHERE a."userId" = u."id";
UPDATE "AuditLog" SET "merchantId" = (SELECT MIN("id") FROM "merchants") WHERE "merchantId" IS NULL;
UPDATE "payment_orders" SET "merchant_id" = (SELECT MIN("id") FROM "merchants") WHERE "merchant_id" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "merchantId" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "merchantId" SET NOT NULL;

-- Los usuarios que ya existían no tienen email: no necesitan verificación

-- 4) El código de producto pasa a ser único por comercio
DROP INDEX "Product_code_key";
CREATE UNIQUE INDEX "Product_merchantId_code_key" ON "Product"("merchantId", "code");

-- 5) Enlaces de verificación de email
CREATE TABLE "email_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- 6) Índices
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");
CREATE INDEX "email_tokens_user_id_idx" ON "email_tokens"("user_id");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
CREATE INDEX "User_merchantId_idx" ON "User"("merchantId");
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");
CREATE INDEX "Sale_merchantId_createdAt_idx" ON "Sale"("merchantId", "createdAt");

-- 7) Claves foráneas
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
