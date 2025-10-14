import { NextApiRequest, NextApiResponse } from "next";
import { generateAdminConsentUrl } from "@/features/auth-page/azure-consent";

const CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;
const REDIRECT_URI = process.env.ADMIN_CONSENT_CALLBACK_URL; // must be registered in app registration
const DEFAULT_EXPIRES = "24h";

if (!CLIENT_ID) {
  throw new Error("AZURE_AD_CLIENT_ID must be set in environment");
}
if (!REDIRECT_URI) {
  throw new Error("ADMIN_CONSENT_CALLBACK_URL must be set in environment");
}

/**
 * POST { tenantId?: string, expiresIn?: string }
 * - tenantId: external tenant GUID, or string 'organizations' to allow any org admin
 * - expiresIn: optional (e.g. "10m", "24h")
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    let { tenantId, expiresIn } = body as { tenantId?: string; expiresIn?: string };

    // Basic defaulting / validation
    expiresIn = expiresIn || DEFAULT_EXPIRES;

    // Allow 'organizations' (any org) or a tenant GUID. We validate GUID string roughly.
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required (or use 'organizations')" });
    }

    const isOrganizations = tenantId === "organizations" || tenantId === "common";
    const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!isOrganizations && !guidRegex.test(tenantId)) {
      return res.status(400).json({ error: "tenantId must be 'organizations', 'common' or a tenant GUID" });
    }

    // Use your helper to build the url (stateless JWT state will be created inside)
    const url = generateAdminConsentUrl({
      tenantId,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      expiresIn,
    });

    // Optionally: record an audit entry in DB here (who generated the link, which tenant requested)
    // await logAudit({ action: "generate_admin_consent", tenantId, expiresIn, generatedBy: req.user?.email });

    return res.status(200).json({ url });
  } catch (err: any) {
    console.error("Failed to generate admin consent URL:", err);
    return res.status(500).json({ error: err?.message || "server_error" });
  }
}
