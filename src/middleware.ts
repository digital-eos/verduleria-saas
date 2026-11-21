import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC_EXACT = ["/"];
// /api/webhooks: los llama Mercado Pago (sin sesión); se validan con firma
// /api/cron: los llama Vercel Cron (sin sesión); se validan con CRON_SECRET
// /api/devices/sales y /heartbeat: los llama el equipo de la balanza; se validan con su clave + secreto
const PUBLIC = [
  "/login",
  "/registro",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify",
  "/api/auth/google",
  "/api/auth/logout",
  "/api/webhooks",
  "/api/cron",
  "/api/devices/sales",
  "/api/devices/heartbeat",
];
// Con el email sin verificar solo se puede ver esto (reenviar el email, salir)
const UNVERIFIED_OK = ["/verificar", "/api/auth/me", "/api/auth/resend"];
const ADMIN_PAGES = ["/stock", "/usuarios", "/dashboard", "/configuracion"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

/**
 * Protege toda la app: sin sesión -> /login (o 401 en la API).
 * Email sin verificar -> solo /verificar. Cajeros no pueden entrar a las pantallas de administración.
 * (Las APIs vuelven a validar usuario y rol contra la base.)
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_EXACT.includes(pathname) || matches(pathname, PUBLIC)) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesión expirada. Volvé a ingresar." }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    // Con la búsqueda: el QR del equipo lleva ?cle=…&code=… y tiene que sobrevivir al login
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (session.pv && !matches(pathname, UNVERIFIED_OK)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Primero verificá tu email (revisá tu correo)" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/verificar", req.url));
  }

  if (session.role !== "ADMIN" && matches(pathname, ADMIN_PAGES)) {
    return NextResponse.redirect(new URL("/caja", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
