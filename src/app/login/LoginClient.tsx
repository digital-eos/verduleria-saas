"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GoogleButton from "@/components/GoogleButton";

const ERRORS: Record<string, string> = {
  google: "No pudimos ingresar con Google. Probá de nuevo.",
  "google-email": "Tu cuenta de Google no tiene el email verificado.",
  "google-off": "El ingreso con Google no está disponible.",
  inactivo: "Tu usuario está desactivado. Pedile al administrador de tu negocio que lo active.",
};

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "");

export default function LoginClient({ googleEnabled }: { googleEnabled: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setNext(safeNext(sp.get("next")));
    const err = sp.get("error");
    if (err) setError(ERRORS[err] ?? "No se pudo ingresar");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo ingresar");
      // recarga completa para que el layout lea la nueva sesión
      window.location.href = data.pendingVerification ? "/verificar" : next || "/caja";
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1>📒 Libretita</h1>
        <p className="muted" style={{ textAlign: "center" }}>Ingresá a tu negocio</p>
        {error && <div className="msg error">{error}</div>}

        {googleEnabled && (
          <>
            <GoogleButton params={{ next }} />
            <div className="auth-or">o con tu usuario</div>
          </>
        )}

        <div className="field">
          <label>Email o usuario</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label>Clave</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="primary big" disabled={loading}>
          {loading ? "Ingresando…" : "Ingresar"}
        </button>

        <p className="muted auth-foot">
          ¿Todavía no usás Libretita? <Link href="/registro">Registrá tu negocio gratis</Link>
        </p>
      </form>
    </div>
  );
}
