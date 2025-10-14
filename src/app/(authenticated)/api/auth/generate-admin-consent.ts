// src/app/(authenticated)/api/auth/generate-admin-consent/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateAdminConsentUrl } from "@/features/auth-page/generate-admin-consent";

const DEFAULT_EXPIRES = "24h";

type Body = {
  tenantId?: string;
  expiresIn?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const tenantId = body?.tenantId;
    const expiresIn = body?.expiresIn || DEFAULT_EXPIRES;

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required (or use 'organizations')" }, { status: 400 });
    }

    const isOrganizations = tenantId === "organizations" || tenantId === "common";
    const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!isOrganizations && !guidRegex.test(tenantId)) {
      return NextResponse.json({ error: "tenantId must be 'organizations', 'common' or a tenant GUID" }, { status: 400 });
    }

    // Server-side: use your helper (reads env vars internally)
    const url = generateAdminConsentUrl({ tenantId, expiresIn });

    // Optional: check authentication here (session/cookie) and/or audit logging

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("generate-admin-consent route error:", err);
    return NextResponse.json({ error: err?.message || "server_error" }, { status: 500 });
  }
}
