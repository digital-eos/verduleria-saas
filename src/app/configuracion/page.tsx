import Link from "next/link";
import { isMpQrEnabled } from "@/lib/payments";

// FEATURE_MP_QR se lee en cada pedido (no queda fijo en el build)
export const dynamic = "force-dynamic";

/**
 * Ajustes técnicos del comercio (solo admin).
 * Lo del día a día (cobrar y consultar precios en la Caja, ventas) queda en el menú principal.
 */
const items = [
  {
    href: "/configuracion/pagos",
    title: "💳 Pagos · Mercado Pago",
    text: "Conectar la cuenta de Mercado Pago del comercio para cobrar con QR en la Caja.",
  },
  {
    href: "/configuracion/balanza",
    title: "⚖️ Balanza",
    text: "Conectar y probar la balanza: ver lo que envía (modo espía) para dejarla funcionando con la Caja.",
  },
  {
    href: "/configuracion/auditoria",
    title: "🕵️ Auditoría",
    text: "Registro de ingresos, cambios de precio, anulaciones de ventas y cambios de usuarios.",
  },
];

export default function ConfiguracionPage() {
  return (
    <>
      <h1>Configuración</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Ajustes técnicos. Para cobrar usá la <Link href="/caja">Caja</Link>: ahí se lee la balanza y el escáner.
      </p>
      {items.filter((i) => isMpQrEnabled() || i.href !== "/configuracion/pagos").map((i) => (
        <Link key={i.href} href={i.href} className="panel" style={{ display: "block", textDecoration: "none", color: "inherit", marginBottom: 12 }}>
          <h2 style={{ margin: "0 0 6px" }}>{i.title}</h2>
          <p className="muted" style={{ margin: 0 }}>{i.text}</p>
        </Link>
      ))}
    </>
  );
}
