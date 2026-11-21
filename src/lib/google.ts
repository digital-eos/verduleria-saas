/**
 * Ingreso / registro con Google (OAuth 2.0 + OpenID Connect, sin dependencias).
 * Variables: GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (Google Cloud → Credenciales → ID de cliente OAuth, "Aplicación web").
 * URI de redireccionamiento autorizada: <APP_URL>/api/auth/google/callback
 */

export const GOOGLE_STATE_COOKIE = "vs_google";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const googleRedirectUri = (base: string) => `${base}/api/auth/google/callback`;

export function googleAuthUrl(base: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(base),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };

/** Cambia el `code` por un token y lee el perfil (email verificado por Google). */
export async function googleProfile(base: string, code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(base),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("Google no devolvió access_token");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new Error(`Google userinfo ${infoRes.status}`);
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; given_name?: string };
  if (!info.sub || !info.email) throw new Error("Google no devolvió el email");
  return {
    sub: info.sub,
    email: info.email.trim().toLowerCase(),
    emailVerified: info.email_verified === true,
    name: (info.name || info.given_name || info.email.split("@")[0]).slice(0, 80),
  };
}
