import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, handleError, requireUser } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { MIN_PASSWORD, hashPassword } from "@/lib/password";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/users/:id  { name?, role?, active?, password? }
 * Reglas: no podés desactivarte ni quitarte el rol de admin a vos mismo,
 * y siempre tiene que quedar al menos un admin activo.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const me = await requireUser("ADMIN");
    const id = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "Usuario no encontrado");

    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new HttpError(400, "El nombre es obligatorio");
      data.name = name;
    }
    if (body.role !== undefined) data.role = body.role === "ADMIN" ? "ADMIN" : "CASHIER";
    if (body.active !== undefined) data.active = Boolean(body.active);

    if (id === me.id && (data.active === false || data.role === "CASHIER")) {
      throw new HttpError(400, "No podés desactivarte ni quitarte el rol de administrador a vos mismo");
    }
    const losesAdmin = target.role === "ADMIN" && target.active && (data.role === "CASHIER" || data.active === false);
    if (losesAdmin) {
      const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) throw new HttpError(400, "Tiene que quedar al menos un administrador activo");
    }

    let passwordChanged = false;
    if (body.password !== undefined && body.password !== "") {
      const password = String(body.password);
      if (password.length < MIN_PASSWORD) {
        throw new HttpError(400, `La clave debe tener al menos ${MIN_PASSWORD} caracteres`);
      }
      data.passwordHash = hashPassword(password);
      passwordChanged = true;
    }

    const changes = diff<Record<string, unknown>>(
      { name: target.name, role: target.role, active: target.active },
      { name: data.name, role: data.role, active: data.active },
    );

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, name: true, role: true, active: true, createdAt: true },
    });

    if (Object.keys(changes).length) await audit(me, "USER_UPDATE", "User", id, { usuario: target.username, ...changes });
    if (passwordChanged) await audit(me, "USER_PASSWORD_RESET", "User", id, { usuario: target.username });

    return NextResponse.json(user);
  } catch (e) {
    return handleError(e);
  }
}
