-- CreateTable
CREATE TABLE "catalog_products" (
    "ean" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "presentation" TEXT,
    "source" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("ean")
);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "presentation" TEXT;
