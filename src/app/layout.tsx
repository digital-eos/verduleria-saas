import type { Metadata } from "next";
import { cookies } from "next/headers";
import Nav from "@/components/Nav";
import { SessionProvider, type ClientSession } from "@/components/SessionProvider";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Libretita — La caja de tu negocio",
  description: "Chau cuaderno, hola Libretita. Punto de venta simple para negocios de barrio.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const session: ClientSession = s ? { name: s.name, username: s.username, role: s.role } : null;

  return (
    <html lang="es">
      <body>
        <SessionProvider session={session}>
          <Nav />
          <main>{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
