import { PaymentProviderError } from "./types";

/**
 * OAuth de Mercado Pago: cada comercio conecta SU cuenta y cobra con su propio token.
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/security/oauth
 *
 * SOLO SERVIDOR (usa MP_CLIENT_SECRET).
 */

const AUTH_URL = "https://auth.mercadopago.com.ar/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";

export const OAUTH_STATE_COOKIE = "mp_oauth_state";
export const OAUTH_STATE_TTL = 10 * 60; // 10 minutos para completar la autorización

function env(name: "MP_CLIENT_ID" | "MP_CLIENT_SECRET" | "MP_REDIRECT_URI"): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable ${name} (necesaria para conectar Mercado Pago)`);
  return v;
}

export function authorizationUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env("MP_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", env("MP_REDIRECT_URI"));
  return url.toString();
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  mpUserId: string;
  expiresAt: Date;
};

/** Error de OAuth. `definitive` = MP rechazó el pedido (4xx): el code / refresh_token no sirve más. */
export class OAuthError extends PaymentProviderError {
  constructor(message: string, public readonly definitive: boolean, details?: unknown) {
    super(message, details);
    this.name = "OAuthError";
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  user_id?: number | string;
  expires_in?: number;
};

async function tokenRequest(body: Record<string, string>): Promise<OAuthTokens> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), ...body }),
      cache: "no-store",
    });
  } catch (e) {
    throw new OAuthError("No pudimos conectar con Mercado Pago", false, String(e));
  }
  const data = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!res.ok || !data?.access_token || !data.refresh_token || data.user_id == null) {
    // Nunca logueamos el body enviado (lleva el client_secret); la respuesta de error no tiene secretos
    console.error(`[mercadopago oauth] ${body.grant_type} -> ${res.status}`, data);
    throw new OAuthError(`Mercado Pago rechazó la autorización (${res.status})`, res.status >= 400 && res.status < 500, data);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    mpUserId: String(data.user_id),
    expiresAt: new Date(Date.now() + (data.expires_in ?? 0) * 1000),
  };
}

/** Callback: cambia el `code` por los tokens del comercio */
export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env("MP_REDIRECT_URI") });

/** Renueva el access token (el refresh_token también cambia: hay que guardar el nuevo) */
export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

/** Nombre visible de la cuenta ("Conectado como …"). Si falla, no pasa nada. */
export async function fetchNickname(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { nickname?: string; email?: string };
    return me.nickname ?? me.email ?? null;
  } catch {
    return null;
  }
}
