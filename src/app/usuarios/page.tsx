"use client";

import { useEffect, useState } from "react";
import { apiFetch, useSession } from "@/components/SessionProvider";
import { formatDateTime } from "@/lib/format";

type Role = "ADMIN" | "CASHIER";
type User = { id: number; username: string; name: string; role: Role; active: boolean; createdAt: string };
type Form = { id?: number; username: string; name: string; role: Role; password: string };

const empty: Form = { username: "", name: "", role: "CASHIER", password: "" };
const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrador", CASHIER: "Cajero" };

export default function UsuariosPage() {
  const me = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [msg, setMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);

  async function load() {
    const res = await apiFetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const editing = Boolean(form.id);
    const body = editing
      ? { name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}) }
      : form;
    const res = await apiFetch(editing ? `/api/users/${form.id}` : "/api/users", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setMsg({ type: "error", text: data.error ?? "Error al guardar" });
    setMsg({ type: "ok", text: editing ? "Usuario actualizado" : `Usuario "${data.username}" creado` });
    setForm(empty);
    load();
  }

  async function toggleActive(u: User) {
    if (u.active && !confirm(`¿Desactivar a ${u.name}? No va a poder ingresar más.`)) return;
    const res = await apiFetch(`/api/users/${u.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    const data = await res.json();
    if (!res.ok) setMsg({ type: "error", text: data.error });
    load();
  }

  return (
    <div className="grid-pos">
      <section className="panel">
        <h2>{form.id ? `Editar: ${form.username}` : "Nuevo usuario"}</h2>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <form onSubmit={save}>
          {!form.id && (
            <div className="field">
              <label>Usuario (para ingresar)</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                autoCapitalize="none"
                placeholder="ej: juan"
                required
              />
            </div>
          )}
          <div className="field">
            <label>Nombre</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Rol</label>
            <div className="pay-options">
              {(["CASHIER", "ADMIN"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={form.role === r ? "selected" : ""}
                  onClick={() => setForm({ ...form, role: r })}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              {form.role === "CASHIER"
                ? "Cajero: usa la caja y ve las ventas del día. No puede cambiar precios ni anular ventas."
                : "Administrador: acceso completo (productos, precios, anulaciones, usuarios, reportes)."}
            </p>
          </div>
          <div className="field">
            <label>{form.id ? "Nueva clave (dejar vacío para no cambiarla)" : "Clave (mínimo 6 caracteres)"}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!form.id}
            />
          </div>
          <div className="row">
            {form.id && (
              <button type="button" onClick={() => setForm(empty)} style={{ flex: "0 0 auto" }}>
                Cancelar
              </button>
            )}
            <button className="primary big" type="submit">
              {form.id ? "Guardar cambios" : "Crear usuario"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Usuarios</h2>
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Alta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "cancelled"}>
                <td>{u.username}</td>
                <td>{u.name}{u.username === me?.username && <span className="muted"> (vos)</span>}</td>
                <td><span className="badge">{ROLE_LABEL[u.role]}</span></td>
                <td className="muted">{formatDateTime(u.createdAt)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => setForm({ id: u.id, username: u.username, name: u.name, role: u.role, password: "" })}>
                    Editar
                  </button>{" "}
                  {u.username !== me?.username && (
                    <button className={u.active ? "danger" : ""} onClick={() => toggleActive(u)}>
                      {u.active ? "Desactivar" : "Activar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
