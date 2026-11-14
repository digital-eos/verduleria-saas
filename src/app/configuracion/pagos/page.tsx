import { notFound } from "next/navigation";
import { isMpQrEnabled } from "@/lib/payments";
import PagosClient from "./PagosClient";

// FEATURE_MP_QR se lee en cada pedido (no queda fijo en el build)
export const dynamic = "force-dynamic";

export default function PagosPage() {
  if (!isMpQrEnabled()) notFound();
  return <PagosClient />;
}
