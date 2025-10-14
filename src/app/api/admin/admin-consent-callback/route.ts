// src/app/(authenticated)/api/admin/admin-consent-callback/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/**
 * Helper: get NEXTAUTH_SECRET string.
 * Mirrors the logic you added to azure-consent.ts so we can verify the state JWT.
 */
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
  // jwt.verify will throw if invalid/expired
  const payload = jwt.verify(stateJwt, secret) as any;
  return payload;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const state = params.get("state");
    const tenant = params.get("tenant") || params.get("tid"); // Azure may include 'tenant' or other keys
    const adminConsent = params.get("admin_consent") || params.get("admin_consented"); // check common names
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (!state) {
      // Bad request from Azure
      return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent("missing_state")}`, req.nextUrl.origin));
    }

    // Verify the state JWT
    let payload: any;
    try {
      payload = await verifyStateJwt(state);
    } catch (err: any) {
      console.error("admin-consent callback: state verification failed:", err);
      return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent("invalid_state")}`, req.nextUrl.origin));
    }

    // Optional: check payload.purpose and redirectUri match expectation
    if (payload?.purpose !== "admin_consent") {
      console.warn("admin-consent callback: state purpose mismatch", payload);
      return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent("bad_purpose")}`, req.nextUrl.origin));
    }

    // If Azure reported an error, redirect with message
    if (error) {
      const msg = errorDescription || error;
      return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent(msg)}`, req.nextUrl.origin));
    }

    // Successful admin consent: Azure returns admin_consent=True and tenant id
    // Note: Azure commonly returns `tenant` query param containing the tenant id
    if (adminConsent && (adminConsent.toLowerCase() === "true" || adminConsent.toLowerCase() === "yes")) {
      // TODO: persist audit/logging if desired: payload.jti, payload.iat, tenant, who requested...
      // For now just redirect to chat or reporting with success
      return NextResponse.redirect(new URL(`/chat?consent=success&tenant=${encodeURIComponent(tenant ?? "")}`, req.nextUrl.origin));
    }

    // Fallback: unknown response — redirect with info
    return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent("unknown_response")}`, req.nextUrl.origin));
  } catch (err: any) {
    console.error("admin-consent callback unexpected error:", err);
    // On server error, redirect to reporting with message
    const origin = typeof req.nextUrl?.origin === "string" ? req.nextUrl.origin : "/";
    return NextResponse.redirect(new URL(`/reporting?consent=error&msg=${encodeURIComponent("server_error")}`, origin));
  }
}
