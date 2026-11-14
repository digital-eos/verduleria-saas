-- Líneas de "monto libre" (modo Precio de la caja): sin producto asociado
ALTER TABLE "SaleItem" ALTER COLUMN "productId" DROP NOT NULL;
