import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!NEXTAUTH_SECRET) {
  // Fail fast so types/build won't allow the app to run without this secret.
  throw new Error("NEXTAUTH_SECRET must be set for admin-consent callback verification");
}

/**
 * Optional environment variables:
 * - ADMIN_CONSENT_CALLBACK_URL: the exact redirect URI you registered in Azure (recommended)
 * - ADMIN_CONSENT_SUCCESS_REDIRECT: where to send user after success (defaults to /chat)
 * - ADMIN_CONSENT_FAILURE_REDIRECT: where to send user on failure (defaults to /)
 */
const EXPECTED_CALLBACK = process.env.ADMIN_CONSENT_CALLBACK_URL;
const SUCCESS_REDIRECT = process.env.ADMIN_CONSENT_SUCCESS_REDIRECT || "/chat";
const FAILURE_REDIRECT = process.env.ADMIN_CONSENT_FAILURE_REDIRECT || "/?consent=failed";

type StatePayload = {
  jti?: string;
  iat?: number;
  purpose?: string;
  redirectUri?: string;
  // any other custom fields you added
  [k: string]: any;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Azure can return an error in query params if consent failed/cancelled
  const { state, tenant, error, error_description } = req.query;

  if (error) {
    console.error("Azure admin-consent returned an error:", error, error_description);
    // Redirect to failure page and include details for diagnostics (URL-encoded)
    return res.redirect(
      `${FAILURE_REDIRECT}?azure_error=${encodeURIComponent(String(error))}&desc=${encodeURIComponent(
        String(error_description || "")
      )}`
    );
  }

  if (!state || typeof state !== "string") {
    console.error("Missing or invalid state in admin-consent callback");
    return res.redirect(`${FAILURE_REDIRECT}?reason=missing_state`);
  }

  try {
    // Verify JWT state using the same secret used to sign it
    const payload = jwt.verify(state, NEXTAUTH_SECRET) as StatePayload | string;

    if (typeof payload === "string") {
      // Not expected: we expect an object payload we encoded earlier
      console.error("State JWT payload is a string (unexpected)", payload);
      return res.redirect(`${FAILURE_REDIRECT}?reason=invalid_state_payload`);
    }

    // Basic checks
    if (payload.purpose !== "admin_consent") {
      console.error("State JWT has invalid purpose:", payload.purpose);
      return res.redirect(`${FAILURE_REDIRECT}?reason=invalid_state_purpose`);
    }

    // Optional: verify redirect URI embedded in the JWT matches your expected callback
    // This prevents an attacker from reusing a valid state with a different redirect target.
    if (EXPECTED_CALLBACK && payload.redirectUri && payload.redirectUri !== EXPECTED_CALLBACK) {
      console.error("State redirectUri mismatch", { expected: EXPECTED_CALLBACK, got: payload.redirectUri });
      return res.redirect(`${FAILURE_REDIRECT}?reason=redirect_uri_mismatch`);
    }

    // At this point, the state is verified and short-lived (jwt.verify also checks expiry)
    // Azure sends back the tenant id as `tenant` (query param). Use that to mark this tenant as approved.
    const tenantId = typeof tenant === "string" ? tenant : undefined;

    // === Optional: persist that this tenant has granted admin consent ===
    // For example, save tenantId to DB or your tenant-configuration store so you can allow users from that tenant.
    // await saveTenantConsent(tenantId, { jti: payload.jti, grantedAt: Date.now() })
    // OR call your internal API to mark tenant as allowed.

    // Optional: prevent replay attacks by storing payload.jti (a one-time ID) in DB/cache
    // and rejecting future requests that reuse the same jti. Because the token is short-lived this is
    // not strictly required, but it's an added safety step for production.

    // Redirect to success page; include tenant for UX/diagnostics if you like
    const successUrl = tenantId ? `${SUCCESS_REDIRECT}?tenant=${encodeURIComponent(tenantId)}` : SUCCESS_REDIRECT;
    return res.redirect(successUrl);
  } catch (err: any) {
    console.error("Failed to verify admin-consent state JWT:", err?.message || err);
    // Provide minimal detail in the redirect to avoid leaking internal details
    return res.redirect(`${FAILURE_REDIRECT}?reason=${encodeURIComponent(err?.message || "invalid_state")}`);
  }
}
