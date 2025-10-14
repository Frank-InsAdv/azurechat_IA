// src/features/auth-page/azure-consent.ts
import crypto from "crypto";
import jwt from "jsonwebtoken";

// Optional: only needed if we fetch from Key Vault dynamically
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

// Function to fetch NEXTAUTH_SECRET from Key Vault if needed
async function fetchNextAuthSecret(): Promise<string> {
  if (process.env.NEXTAUTH_SECRET && !process.env.NEXTAUTH_SECRET.startsWith("@Microsoft.KeyVault")) {
    return process.env.NEXTAUTH_SECRET;
  }

  const keyVaultRef = process.env.NEXTAUTH_SECRET; // "@Microsoft.KeyVault(VaultName=...;SecretName=NEXTAUTH-SECRET)"
  if (!keyVaultRef) {
    throw new Error("NEXTAUTH_SECRET must be set for signing admin-consent state");
  }

  // Parse VaultName and SecretName from the reference string
  const match = keyVaultRef.match(/VaultName=(.+?);SecretName=(.+)/);
  if (!match) {
    throw new Error("Invalid NEXTAUTH_SECRET Key Vault reference format");
  }

  const [, vaultName, secretName] = match;
  const url = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(url, new DefaultAzureCredential());
  const secret = await client.getSecret(secretName);
  if (!secret.value) {
    throw new Error(`Secret ${secretName} in Key Vault ${vaultName} is empty`);
  }

  return secret.value;
}

// Lazy load the secret at runtime
let secret: string | null = null;
async function getSecret(): Promise<string> {
  if (!secret) {
    secret = await fetchNextAuthSecret();
  }
  return secret;
}

/**
 * Generate admin consent URL for external tenant.
 */
export async function generateAdminConsentUrl(params: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  expiresIn?: string | number;
}) {
  const { tenantId, clientId, redirectUri, expiresIn = "24h" } = params;

  const secretValue = await getSecret();

  const payload = {
    jti: crypto.randomBytes(16).toString("hex"),
    iat: Math.floor(Date.now() / 1000),
    purpose: "admin_consent",
    redirectUri,
  };

  const stateJwt = (jwt as any).sign(payload, secretValue, { expiresIn: `${expiresIn}` });

  const url = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId
  )}/adminconsent?client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(
    stateJwt
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return url;
}
