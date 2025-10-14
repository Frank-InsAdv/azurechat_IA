// src/app/api/admin/admin-consent-callback/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/** Fetch NEXTAUTH_SECRET from env or Key Vault (same logic as azure-consent.ts) */
async function fetchNextAuthSecret(): Promise<string> {
  const env = process.env.NEXTAUTH_SECRET;
  if (env && !env.startsWith("@Microsoft.KeyVault")) return env;
  if (!env) throw new Error("NEXTAUTH_SECRET is not set in environment");

  const match = env.match(/VaultName=(.+?);SecretName=(.+)/);
  if (!match) throw new Error("Invalid NEXTAUTH_SECRET Key Vault reference format");

  const [, vaultName, secretName] = match;
  const url = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(url, new DefaultAzureCredential());
  const secret = await client.getSecret(secretName);
  if (!secret.value) throw new Error(`Key Vault secret ${secretName} has no value`);
  return secret.value;
}

async function verifyStateJwt(stateJwt: string) {
  const secret = await fetchNextAuthSecret();
  return jwt.verify(stateJwt, secret) as any;
}

/** Use explicit absolute redirect targets from env (recommended) */
function getRedirectTargets() {
  const publicBase =
    process.env.ADMIN_CONSENT_PUBLIC_HOST ||
    process.env.NEXTAUTH_URL || // fallback
    "";

  const SUCCESS =
    process.env.ADMIN_CONSENT_SUCCESS_REDIRECT ||
    (publicBase ? `${publicBase.replace(/\/$/, "")}/chat` : "/chat");
  const FAILURE =
    process.env.ADMIN_CONSENT_FAILURE_REDIRECT ||
    (publicBase ? `${publicBase.replace(/\/$/, "")}/reporting` : "/");

  return { SUCCESS, FAILURE };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const state = params.get("state");
    const tenant = params.get("tenant") || params.get("tid");
    const adminConsent = params.get("admin_consent") || params.get("admin_consented");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    const { SUCCESS, FAILURE } = getRedirectTargets();

    if (!state) {
      console.warn("admin-consent callback: missing state");
      // absolute redirect
      return NextResponse.redirect(`${FAILURE}?consent=error&msg=missing_state`);
    }

    // Verify state JWT
    let payload: any;
    try {
      payload = await verifyStateJwt(state);
    } catch (err: any) {
      console.error("admin-consent callback: state verification failed:", err?.message || err);
      return NextResponse.redirect(`${FAILURE}?consent=error&msg=invalid_state`);
    }

    if (payload?.purpose !== "admin_consent") {
      console.warn("admin-consent callback: invalid state purpose", payload?.purpose);
      return NextResponse.redirect(`${FAILURE}?consent=error&msg=bad_purpose`);
    }

    if (error) {
      const msg = errorDescription || error;
      return NextResponse.redirect(`${FAILURE}?consent=error&msg=${encodeURIComponent(msg)}`);
    }

    if (adminConsent && (adminConsent.toLowerCase() === "true" || adminConsent.toLowerCase() === "yes")) {
      const dest = tenant ? `${SUCCESS}?consent=success&tenant=${encodeURIComponent(tenant)}` : `${SUCCESS}?consent=success`;
      return NextResponse.redirect(dest);
    }

    // unknown response
    return NextResponse.redirect(`${FAILURE}?consent=error&msg=unknown_response`);
  } catch (err: any) {
    console.error("admin-consent callback: unexpected error:", err);
    const { FAILURE } = getRedirectTargets();
    return NextResponse.redirect(`${FAILURE}?consent=error&msg=server_error`);
  }
}
