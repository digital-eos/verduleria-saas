-- Equipos Libretita (ESP32 en la balanza) y ventas recibidas de ellos

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "claim_code_hash" TEXT NOT NULL,
    "merchant_id" INTEGER,
    "label" TEXT,
    "claimed_at" TIMESTAMP(3),
    "firmware" TEXT,
    "scale_model" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "last_heartbeat_at" TIMESTAMP(3),
    "last_rssi" INTEGER,
    "last_ip" TEXT,
    "pending_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sales" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "device_id" INTEGER NOT NULL,
    "merchant_id" INTEGER,
    "sale_id" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sold_at" TIMESTAMP(3) NOT NULL,
    "device_time" TIMESTAMP(3),
    "scale_date" TEXT,
    "ticket_number" TEXT,
    "item_count" INTEGER,
    "total" DECIMAL(12,2),
    "decoded" BOOLEAN NOT NULL DEFAULT false,
    "raw_ticket" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "device_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_key_key" ON "devices"("key");

-- CreateIndex
CREATE UNIQUE INDEX "device_sales_device_id_event_id_key" ON "device_sales"("device_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_sales_sale_id_key" ON "device_sales"("sale_id");

-- CreateIndex
CREATE INDEX "device_sales_device_id_received_at_idx" ON "device_sales"("device_id", "received_at");

-- CreateIndex
CREATE INDEX "device_sales_merchant_id_sold_at_idx" ON "device_sales"("merchant_id", "sold_at");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sales" ADD CONSTRAINT "device_sales_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sales" ADD CONSTRAINT "device_sales_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sales" ADD CONSTRAINT "device_sales_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
