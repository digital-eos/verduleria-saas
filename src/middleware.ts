import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC_EXACT = ["/"];
// /api/webhooks: los llama Mercado Pago (sin sesión); se validan con firma
// /api/cron: los llama Vercel Cron (sin sesión); se validan con CRON_SECRET
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/setup", "/api/webhooks", "/api/cron"];
const ADMIN_PAGES = ["/productos", "/usuarios", "/auditoria", "/dashboard", "/configuracion"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

/**
 * Protege toda la app: sin sesión -> /login (o 401 en la API).
 * Cajeros no pueden entrar a las pantallas de administración.
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
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session.role !== "ADMIN" && matches(pathname, ADMIN_PAGES)) {
    return NextResponse.redirect(new URL("/caja", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
