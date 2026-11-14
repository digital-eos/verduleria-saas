-- Multi-comercio + conexión OAuth con Mercado Pago

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "merchantId" INTEGER;

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "merchant_id" INTEGER;

-- CreateTable
CREATE TABLE "merchants" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "street_name" TEXT,
    "street_number" TEXT,
    "city" TEXT,
    "state" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mercadopago_accounts" (
    "id" TEXT NOT NULL,
    "merchant_id" INTEGER NOT NULL,
    "mp_user_id" TEXT NOT NULL,
    "mp_nickname" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "store_id" TEXT,
    "external_store_id" TEXT,
    "pos_id" TEXT,
    "external_pos_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mercadopago_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mercadopago_accounts_merchant_id_key" ON "mercadopago_accounts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mercadopago_accounts_mp_user_id_key" ON "mercadopago_accounts"("mp_user_id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mercadopago_accounts" ADD CONSTRAINT "mercadopago_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Datos existentes: un comercio por defecto (id 1) al que pertenecen los usuarios y cobros actuales
INSERT INTO "merchants" ("id", "name", "updated_at") VALUES (1, 'Mi comercio', CURRENT_TIMESTAMP);
SELECT setval(pg_get_serial_sequence('"merchants"', 'id'), 1, true);
UPDATE "User" SET "merchantId" = 1 WHERE "merchantId" IS NULL;
UPDATE "payment_orders" SET "merchant_id" = 1 WHERE "merchant_id" IS NULL;
