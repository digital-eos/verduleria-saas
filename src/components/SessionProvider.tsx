"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/session";

export type ClientSession = { name: string; username: string; role: Role } | null;

const Ctx = createContext<ClientSession>(null);

export function SessionProvider({ session, children }: { session: ClientSession; children: React.ReactNode }) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
export const useIsAdmin = () => useContext(Ctx)?.role === "ADMIN";

/** fetch que, si la sesión expiró (401), manda al login */
export async function apiFetch(input: string, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  return res;
}
