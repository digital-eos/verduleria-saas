"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./SessionProvider";

const links = [
  { href: "/", label: "Caja", admin: false },
  { href: "/precios", label: "Precios", admin: false },
  { href: "/ventas", label: "Ventas", admin: false },
  { href: "/dashboard", label: "Reportes", admin: true },
  { href: "/productos", label: "Productos", admin: true },
  { href: "/usuarios", label: "Usuarios", admin: true },
  { href: "/auditoria", label: "Auditoría", admin: true },
  { href: "/balanza", label: "Balanza", admin: true },
];

export default function Nav() {
  const path = usePathname();
  const session = useSession();
  if (path === "/login" || !session) return null;

  const isAdmin = session.role === "ADMIN";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="topbar">
      <span className="brand">🥬 Verdulería</span>
      <nav>
        {links
          .filter((l) => isAdmin || !l.admin)
          .map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
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
