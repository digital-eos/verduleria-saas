import { googleConfigured } from "@/lib/google";
import RegistroClient from "./RegistroClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Registrá tu negocio — Libretita" };

export default function RegistroPage() {
  return <RegistroClient googleEnabled={googleConfigured()} />;
}
