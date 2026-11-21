"use client";

import { useState } from "react";
import Link from "next/link";
import GoogleButton from "@/components/GoogleButton";

/**
 * Registro de un negocio nuevo: el que se registra queda como administrador.
 * Con Google entra directo; con email y clave recibe un enlace para confirmar el email.
 */
export default function RegistroClient({ googleEnabled }: { googleEnabled: boolean }) {
  const [merchantName, setMerchantName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantName, name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear la cuenta");
      try {
        // Solo desarrollo (sin proveedor de email): el enlace se muestra en /verificar
        if (data.devLink) sessionStorage.setItem("libretita-dev-link", data.devLink);
      } catch {}
      window.location.href = "/verificar";
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={submit}>
        <h1>📒 Libretita</h1>
        <p className="muted" style={{ textAlign: "center" }}>
          Registrá tu negocio. Después vas a poder sumar a tus cajeros.
        </p>
        {error && <div className="msg error">{error}</div>}

        <div className="field">
          <label>Nombre del negocio</label>
          <input
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
            placeholder="ej: Verdulería Don Juan"
            maxLength={80}
            required
            autoFocus
          />
        </div>

        {googleEnabled && (
          <>
            <GoogleButton params={{ comercio: merchantName.trim() }} label="Registrarme con Google" />
            <div className="auth-or">o con tu email</div>
          </>
        )}

        <div className="field">
          <label>Tu nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label>Clave</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            placeholder="mínimo 6 caracteres"
            required
          />
        </div>
        <button className="primary big" disabled={loading}>
          {loading ? "Creando…" : "Crear mi cuenta"}
        </button>

        <p className="muted auth-foot">
          ¿Ya tenés cuenta? <Link href="/login">Ingresá</Link>
        </p>
      </form>
    </div>
  );
}
