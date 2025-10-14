// src/features/auth-page/azure-consent.ts
import crypto from "crypto";
import jwt from "jsonwebtoken";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET must be set for signing admin-consent state");
}
// TypeScript now knows this is a string
const secret: string = NEXTAUTH_SECRET;

/**
 * Generate admin consent URL for external tenant.
 *
 * @param params.tenantId  - tenant to request admin consent for
 * @param params.clientId  - your app registration client id
 * @param params.redirectUri - callback registered in app registration
 * @param params.expiresIn - optional JWT expiry (e.g. "10m", "24h")
 */
export function generateAdminConsentUrl(params: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  expiresIn?: string | number;
}) {
  const { tenantId, clientId, redirectUri, expiresIn = "24h" } = params;

  const payload = {
    jti: crypto.randomBytes(16).toString("hex"),
    iat: Math.floor(Date.now() / 1000),
    purpose: "admin_consent",
    redirectUri,
  };

  const stateJwt = jwt.sign(payload, secret, { expiresIn });

  const url = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId
  )}/adminconsent?client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(
    stateJwt
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return url;
}
