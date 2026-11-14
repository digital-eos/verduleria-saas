import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const services = [
  {
    icon: "⚖️",
    title: "Caja con balanza",
    text: "Leé el peso directo de la balanza o cargalo a mano. Por kilo o por unidad, el total se calcula solo.",
  },
  {
    icon: "📷",
    title: "Códigos de barras",
    text: "Escaneá etiquetas de balanza y productos con lector o con la cámara del celular.",
  },
  {
    icon: "🧾",
    title: "Ventas y medios de pago",
    text: "Cada venta queda registrada con fecha, cajero y medio de pago. Exportá a CSV cuando quieras.",
  },
  {
    icon: "📊",
    title: "Reportes",
    text: "Facturación por día y por hora, productos más vendidos y rendimiento por cajero.",
  },
  {
    icon: "👥",
    title: "Usuarios y permisos",
    text: "Administradores y cajeros con accesos separados. Todo cambio queda en la auditoría.",
  },
  {
    icon: "📱",
    title: "En cualquier dispositivo",
    text: "Funciona en la PC del mostrador, en la tablet o en el celular. Sin instalar nada.",
  },
];

export default async function HomePage() {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  return (
    <div className="landing">
      <header className="landing-head">
        <span className="landing-brand">🥬 Verdulería</span>
        {session ? (
          <div className="landing-user">
            <span className="muted">Hola, {session.name}</span>
            <Link href="/caja" className="btn-link primary">Ir a la caja</Link>
          </div>
        ) : (
          <Link href="/login" className="btn-link primary">Ingresar</Link>
        )}
      </header>

      <section className="hero">
        <h1>La caja de tu verdulería, simple y conectada a la balanza</h1>
        <p>
          Cobrá más rápido, controlá precios y mirá cómo va el negocio desde un solo lugar.
          Pensado para el mostrador, por kilo y por unidad.
        </p>
        <Link href={session ? "/caja" : "/login"} className="btn-link primary big-link">
          {session ? "Ir a la caja" : "Ingresar al sistema"}
        </Link>
      </section>

      <section className="services">
        {services.map((s) => (
          <article key={s.title} className="panel service">
            <span className="service-icon" aria-hidden>{s.icon}</span>
            <h2>{s.title}</h2>
            <p className="muted">{s.text}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot muted">© {new Date().getFullYear()} Verdulería · Punto de venta</footer>
    </div>
  );
}
