"use client";

import { useEffect, useState } from "react";

type Me = { email: string | null; name: string; merchantName: string; pendingVerification: boolean };

/** "Revisá tu correo": hasta confirmar el email no se puede usar la app. */
export default function VerificarPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "ok" | "info"; text: string } | null>(null);
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(): Promise<Me | null> {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) {
      setLoggedOut(true);
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as Me;
    if (!data.pendingVerification) {
      window.location.href = "/caja";
      return data;
    }
    setMe(data);
    return data;
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "enlace") {
      setMsg({ type: "error", text: "El enlace no es válido o ya venció. Pedí uno nuevo." });
    }
    try {
      setDevLink(sessionStorage.getItem("libretita-dev-link") ?? "");
    } catch {}
    load();
    // Si confirma el email desde el celular, esta pestaña se entera sola
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function resend() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/auth/resend", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ type: "error", text: data.error ?? "No pudimos reenviar el email" });
    if (data.alreadyVerified) return (window.location.href = "/caja");
    if (data.devLink) setDevLink(data.devLink);
    setMsg({ type: "ok", text: "Listo, te mandamos un email nuevo." });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (loggedOut) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h1>📒 Libretita</h1>
          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
          <p className="muted" style={{ textAlign: "center" }}>
            Ingresá con tu email y clave para pedir un enlace nuevo.
          </p>
          <a className="btn-link primary" href="/login" style={{ display: "block", textAlign: "center" }}>Ingresar</a>
        </div>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <h1>📬 Revisá tu correo</h1>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <p>
          Hola {me.name}, te mandamos un enlace a <b>{me.email}</b> para confirmar tu email y activar{" "}
          <b>{me.merchantName}</b>.
        </p>
        <p className="muted">Si no lo ves, fijate en Spam o Promociones. El enlace vale 48 horas.</p>
        {devLink && (
          <div className="msg info">
            Modo desarrollo (sin proveedor de email): <a href={devLink}>confirmar el email acá</a>
          </div>
        )}
        <button className="primary big" onClick={resend} disabled={busy}>
          {busy ? "Enviando…" : "Reenviar el email"}
        </button>
        <p className="muted auth-foot">
          ¿Te equivocaste de email? <button className="linklike" onClick={logout}>Salir</button> y registrate de nuevo.
        </p>
      </div>
    </div>
  );
}
