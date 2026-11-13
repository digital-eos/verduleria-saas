"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((d) => setNeedsSetup(Boolean(d.needsSetup)))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (needsSetup && password !== password2) return setError("Las claves no coinciden");
    setLoading(true);
    try {
      const res = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo ingresar");
      const next = new URLSearchParams(window.location.search).get("next");
      // recarga completa para que el layout lea la nueva sesión
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  if (needsSetup === null) return null;

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1>🥬 Verdulería</h1>
        {needsSetup ? (
          <p className="muted">
            Primer uso: creá el usuario <b>administrador</b>. Después vas a poder crear los usuarios de los cajeros.
          </p>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>Ingresá con tu usuario</p>
        )}
        {error && <div className="msg error">{error}</div>}

        {needsSetup && (
          <div className="field">
            <label>Tu nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
        )}
        <div className="field">
          <label>Usuario</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            required
            autoFocus={!needsSetup}
          />
        </div>
        <div className="field">
          <label>Clave</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            required
          />
        </div>
        {needsSetup && (
          <div className="field">
            <label>Repetir clave</label>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
          </div>
        )}
        <button className="primary big" disabled={loading}>
          {loading ? "Ingresando…" : needsSetup ? "Crear administrador" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
