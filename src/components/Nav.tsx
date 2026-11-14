"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./SessionProvider";

const links = [
  { href: "/caja", label: "Caja", admin: false },
  { href: "/ventas", label: "Ventas", admin: false },
  { href: "/productos", label: "Productos", admin: true },
  { href: "/usuarios", label: "Usuarios", admin: true },
  { href: "/auditoria", label: "Auditoría", admin: true },
  { href: "/configuracion", label: "Configuración", admin: true },
];

export default function Nav() {
  const path = usePathname();
  const session = useSession();
  if (path === "/" || path === "/login" || !session) return null;

  const isAdmin = session.role === "ADMIN";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="topbar">
      <span className="brand">📒 Libretita</span>
      <nav>
        {links
          .filter((l) => isAdmin || !l.admin)
          .map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href || path.startsWith(l.href + "/") ? "active" : ""}>
              {l.label}
            </Link>
          ))}
      </nav>
      <div className="user-box">
        <span>
          {session.name} <small>· {isAdmin ? "Admin" : "Cajero"}</small>
        </span>
        <button onClick={logout}>Salir</button>
      </div>
    </header>
  );
}
