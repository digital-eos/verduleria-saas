import { isMpQrEnabled } from "@/lib/payments";
import CajaClient from "./CajaClient";

// FEATURE_MP_QR se lee en cada pedido (no queda fijo en el build)
export const dynamic = "force-dynamic";

export default function CajaPage() {
  return <CajaClient mpQrEnabled={isMpQrEnabled()} />;
}
