import { randomInt, randomUUID } from "node:crypto";
import type { MercadoPagoAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";
import { hasStoreAddress } from "@/lib/merchant";
import { decryptSecret, encryptSecret } from "./crypto";
import { MercadoPagoOrdersProvider, MercadoPagoReconnectError, mpRequest } from "./mercadopago";
import { OAuthError, refreshTokens, type OAuthTokens } from "./oauth";
import { PaymentProviderError } from "./types";

/**
 * Cuenta de Mercado Pago de cada comercio: tokens (cifrados), sucursal y caja.
 * SOLO SERVIDOR.
 */

/** Se renueva el token si vence dentro de menos de 7 días (los tokens de MP duran 180 días) */
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountStatus = "connected" | "revoked";

/** La cuenta existe pero todavía no puede cobrar (sin conectar, o sin caja creada) */
export class MercadoPagoNotReadyError extends PaymentProviderError {
  constructor(message: string) {
    super(message);
    this.name = "MercadoPagoNotReadyError";
  }
}

export async function markRevoked(accountId: string) {
  await prisma.mercadoPagoAccount.update({ where: { id: accountId }, data: { status: "revoked" } });
  console.warn(`[mercadopago] cuenta ${accountId} marcada como revocada`);
}

async function connectedAccount(merchantId: number): Promise<MercadoPagoAccount> {
  const account = await prisma.mercadoPagoAccount.findUnique({ where: { merchantId } });
  if (!account) throw new MercadoPagoNotReadyError("Conectá tu cuenta de Mercado Pago en Configuración → Pagos");
  if (account.status !== "connected") throw new MercadoPagoReconnectError();
  return account;
}

/**
 * Access token vigente del comercio. Si vence en menos de 7 días lo renueva (grant_type=refresh_token).
 * Si Mercado Pago rechaza el renuevo → cuenta "revoked" + "Reconectá tu cuenta de Mercado Pago".
 */
async function validAccessToken(account: MercadoPagoAccount): Promise<{ account: MercadoPagoAccount; accessToken: string }> {
  if (account.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return { account, accessToken: decryptSecret(account.accessToken) };
  }

  let tokens: OAuthTokens;
  try {
    tokens = await refreshTokens(decryptSecret(account.refreshToken));
  } catch (e) {
    if (e instanceof OAuthError && e.definitive) {
      await markRevoked(account.id);
      throw new MercadoPagoReconnectError(e.details);
    }
    // Falla momentánea (red, 5xx): si el token actual sigue vigente lo usamos y se reintenta la próxima vez
    if (account.expiresAt.getTime() > Date.now()) {
      console.warn("[mercadopago] no se pudo renovar el token, se usa el actual", (e as Error).message);
      return { account, accessToken: decryptSecret(account.accessToken) };
    }
    throw new PaymentProviderError("No pudimos conectar con Mercado Pago, intentá de nuevo");
  }

  // Bloqueo optimista: si otro pedido renovó a la vez, nos quedamos con lo que guardó él
  const claimed = await prisma.mercadoPagoAccount.updateMany({
    where: { id: account.id, refreshToken: account.refreshToken },
    data: {
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: encryptSecret(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      status: "connected",
    },
  });
  if (claimed.count === 0) {
    const fresh = await prisma.mercadoPagoAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (fresh.status !== "connected") throw new MercadoPagoReconnectError();
    return { account: fresh, accessToken: decryptSecret(fresh.accessToken) };
  }
  const fresh = await prisma.mercadoPagoAccount.findUniqueOrThrow({ where: { id: account.id } });
  return { account: fresh, accessToken: tokens.accessToken };
}

/**
 * Cliente de Mercado Pago de UN comercio: token descifrado (renovado si hace falta) + su caja.
 * Ante un 401 de la API, la cuenta pasa a "revoked".
 */
export async function getMerchantMpClient(merchantId: number) {
  const { account, accessToken } = await validAccessToken(await connectedAccount(merchantId));
  if (!account.externalPosId || !account.posId) {
    throw new MercadoPagoNotReadyError("Falta crear la caja de Mercado Pago (Configuración → Pagos)");
  }
  const onUnauthorized = () => markRevoked(account.id);
  return {
    account,
    accessToken,
    onUnauthorized,
    provider: new MercadoPagoOrdersProvider(accessToken, account.externalPosId, onUnauthorized),
  };
}

/* ---------- Conexión (callback de OAuth) ---------- */

/** Guarda (o actualiza) la cuenta conectada. Si es OTRA cuenta de MP, se olvidan sucursal y caja anteriores. */
export async function saveConnection(merchantId: number, tokens: OAuthTokens, nickname: string | null) {
  const other = await prisma.mercadoPagoAccount.findUnique({ where: { mpUserId: tokens.mpUserId } });
  if (other && other.merchantId !== merchantId) {
    throw new HttpError(409, "Esta cuenta de Mercado Pago ya está conectada a otro comercio");
  }
  const existing = await prisma.mercadoPagoAccount.findUnique({ where: { merchantId } });
  const sameMpUser = existing?.mpUserId === tokens.mpUserId;
  const data = {
    mpUserId: tokens.mpUserId,
    mpNickname: nickname,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: encryptSecret(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    status: "connected",
  };
  const reset = { storeId: null, externalStoreId: null, posId: null, externalPosId: null };
  return prisma.mercadoPagoAccount.upsert({
    where: { merchantId },
    create: { merchantId, ...data },
    update: sameMpUser ? data : { ...data, ...reset },
  });
}

/* ---------- Sucursal y caja ---------- */

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** external_id alfanumérico y único: "LIB" + comercio + tipo + 8 al azar (≤ 40 caracteres) */
const externalId = (merchantId: number, kind: "S" | "P") => {
  let s = `LIB${merchantId}${kind}`;
  for (let i = 0; i < 8; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
};

/** Nombre aceptado por MP: letras, números, espacios internos, - y _ */
const cleanName = (s: string, fallback: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) ||
  fallback;

type Search<T> = { results?: T[] };

/**
 * Crea la sucursal (POST /users/{id}/stores) y la caja (POST /v2/pos) del comercio, si faltan.
 * Se puede llamar las veces que haga falta: los external_id se guardan ANTES de crear, así un
 * reintento busca lo que ya exista en vez de duplicarlo.
 */
export async function provisionStoreAndPos(merchantId: number) {
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  if (!hasStoreAddress(merchant)) {
    throw new HttpError(400, "Completá la dirección del comercio para crear la caja en Mercado Pago");
  }
  let account: MercadoPagoAccount;
  let accessToken: string;
  try {
    ({ account, accessToken } = await validAccessToken(await connectedAccount(merchantId)));
  } catch (e) {
    if (e instanceof MercadoPagoReconnectError || e instanceof MercadoPagoNotReadyError) throw new HttpError(409, e.message);
    throw e;
  }
  const accountId = account.id;
  const opts = { onUnauthorized: () => markRevoked(accountId) };

  try {
    // 1) Sucursal
    if (!account.storeId) {
      const retry = !!account.externalStoreId;
      const extStore = account.externalStoreId ?? externalId(merchantId, "S");
      if (!retry) {
        account = await prisma.mercadoPagoAccount.update({ where: { id: account.id }, data: { externalStoreId: extStore } });
      }
      let storeId: string | null = null;
      if (retry) {
        const found = await mpRequest<Search<{ id: number | string }>>(
          accessToken,
          "GET",
          `/users/${encodeURIComponent(account.mpUserId)}/stores/search?external_id=${extStore}`,
          opts,
        ).catch(() => null);
        if (found?.results?.[0]) storeId = String(found.results[0].id);
      }
      if (!storeId) {
        const store = await mpRequest<{ id: number | string }>(
          accessToken,
          "POST",
          `/users/${encodeURIComponent(account.mpUserId)}/stores`,
          {
            ...opts,
            body: {
              name: cleanName(merchant.name, "Libretita"),
              external_id: extStore,
              location: {
                street_name: merchant.streetName,
                street_number: merchant.streetNumber,
                city_name: merchant.city,
                state_name: merchant.state,
                latitude: Number(merchant.latitude),
                longitude: Number(merchant.longitude),
                ...(merchant.reference ? { reference: merchant.reference } : {}),
              },
            },
          },
        );
        storeId = String(store.id);
      }
      account = await prisma.mercadoPagoAccount.update({ where: { id: account.id }, data: { storeId } });
    }

    // 2) Caja (POS) en modo "pdv": la atiende el cajero y cada cobro genera su QR dinámico
    if (!account.posId) {
      const extPos = account.externalPosId ?? externalId(merchantId, "P");
      if (!account.externalPosId) {
        account = await prisma.mercadoPagoAccount.update({ where: { id: account.id }, data: { externalPosId: extPos } });
      }
      let posId: string;
      try {
        const pos = await mpRequest<{ id: number | string }>(accessToken, "POST", "/v2/pos", {
          ...opts,
          idempotencyKey: randomUUID(),
          body: {
            name: "Caja 1",
            store_id: account.storeId,
            external_id: extPos,
            config: { qr: { operating_mode: "pdv" } },
          },
        });
        posId = String(pos.id);
      } catch (e) {
        // 409 pos_already_exists: un intento anterior ya la creó → la buscamos
        if (!(e instanceof PaymentProviderError) || e.httpStatus !== 409) throw e;
        const found = await mpRequest<Search<{ id: number | string }>>(
          accessToken,
          "GET",
          `/pos?external_id=${extPos}`,
          opts,
        );
        if (!found.results?.[0]) throw e;
        posId = String(found.results[0].id);
      }
      account = await prisma.mercadoPagoAccount.update({ where: { id: account.id }, data: { posId } });
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof MercadoPagoReconnectError) throw new HttpError(409, e.message);
    console.error("[mercadopago] provisionStoreAndPos", e);
    throw new HttpError(502, mpErrorMessage(e, "No pudimos crear la sucursal / caja en Mercado Pago, intentá de nuevo"));
  }
  return account;
}

/** Mensaje entendible para el comercio a partir de un error de la API */
export function mpErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof MercadoPagoReconnectError || e instanceof MercadoPagoNotReadyError) return e.message;
  if (e instanceof PaymentProviderError) {
    const d = e.details as { message?: string; errors?: { message?: string }[] } | null;
    const detail = d?.errors?.[0]?.message ?? d?.message;
    if (e.httpStatus === 400 && detail) return `${fallback} (Mercado Pago: ${detail})`;
    if (e.httpStatus === 404) return `${fallback} (Mercado Pago no encuentra la caja: revisá Configuración → Pagos)`;
  }
  return fallback;
}

/* ---------- Estado para la interfaz ---------- */

export type MpAccountStatusDTO = {
  provider: "mock" | "mercadopago";
  /** Hay cuenta conectada (no revocada) */
  connected: boolean;
  status: AccountStatus | null;
  nickname: string | null;
  mpUserId: string | null;
  storeReady: boolean;
  posReady: boolean;
  /** Puede cobrar con QR ahora mismo */
  ready: boolean;
};

export function toAccountStatusDTO(provider: "mock" | "mercadopago", a: MercadoPagoAccount | null): MpAccountStatusDTO {
  const connected = a?.status === "connected";
  const posReady = !!(a?.posId && a.externalPosId);
  return {
    provider,
    connected,
    status: (a?.status as AccountStatus) ?? null,
    nickname: a?.mpNickname ?? null,
    mpUserId: a?.mpUserId ?? null,
    storeReady: !!a?.storeId,
    posReady,
    ready: provider === "mock" || (connected && posReady),
  };
}
