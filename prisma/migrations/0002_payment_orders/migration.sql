-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "sale_id" INTEGER,
    "provider" TEXT NOT NULL,
    "mp_order_id" TEXT,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "qr_data" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "expires_at" TIMESTAMP(3),
    "items" JSONB NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_sale_id_key" ON "payment_orders"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_mp_order_id_key" ON "payment_orders"("mp_order_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
