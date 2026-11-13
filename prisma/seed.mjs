// Carga unos productos de ejemplo:  npm run db:seed
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  { code: "0001", name: "Tomate redondo", unit: "KG", price: 2500 },
  { code: "0002", name: "Papa", unit: "KG", price: 1200 },
  { code: "0003", name: "Cebolla", unit: "KG", price: 1100 },
  { code: "0004", name: "Banana", unit: "KG", price: 2200 },
  { code: "0005", name: "Manzana roja", unit: "KG", price: 2800 },
  { code: "0006", name: "Zanahoria", unit: "KG", price: 1300 },
  { code: "0007", name: "Naranja", unit: "KG", price: 1600 },
  { code: "0101", name: "Lechuga (planta)", unit: "UNIT", price: 1500 },
  { code: "0102", name: "Atado de perejil", unit: "UNIT", price: 800 },
  { code: "0103", name: "Maple de huevos x30", unit: "UNIT", price: 7500 },
];

for (const p of products) {
  await prisma.product.upsert({ where: { code: p.code }, update: {}, create: p });
}
console.log(`Seed OK: ${products.length} productos`);
await prisma.$disconnect();
