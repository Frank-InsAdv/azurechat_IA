import { NextApiRequest, NextApiResponse } from "next";
import { generateAdminConsentUrl } from "@/features/auth-page/azure-consent";

const CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;
const REDIRECT_URI = process.env.ADMIN_CONSENT_CALLBACK_URL;
const DEFAULT_EXPIRES = "24h";

if (!CLIENT_ID) throw new Error("AZURE_AD_CLIENT_ID must be set in environment");
if (!REDIRECT_URI) throw new Error("ADMIN_CONSENT_CALLBACK_URL must be set in environment");

const CLIENT_ID_STR: string = CLIENT_ID;
const REDIRECT_URI_STR: string = REDIRECT_URI;

type Body = { tenantId?: string; expiresIn?: string };

/**
 * POST { tenantId: string|'organizations', expiresIn?: string }
 * Returns: { url: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { tenantId, expiresIn } = (req.body || {}) as Body;
  const expires = expiresIn || DEFAULT_EXPIRES;

  if (!tenantId) return res.status(400).json({ error: "tenantId is required (or use 'organizations')" });

  const isOrganizations = tenantId === "organizations" || tenantId === "common";
  const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!isOrganizations && !guidRegex.test(tenantId)) {
    return res.status(400).json({ error: "tenantId must be 'organizations', 'common' or a tenant GUID" });
  }

  try {
    const url = generateAdminConsentUrl({
      tenantId,
      clientId: CLIENT_ID_STR,
      redirectUri: REDIRECT_URI_STR,
      expiresIn: expires,
    });

    // TODO: add auth check (NextAuth) so only internal admins can call this endpoint
    // TODO: log audit record (who generated the link / when / jti from the JWT)

    return res.status(200).json({ url });
  } catch (err: any) {
    console.error("Failed to generate admin consent URL:", err);
    return res.status(500).json({ error: err?.message || "server_error" });
  }
}
