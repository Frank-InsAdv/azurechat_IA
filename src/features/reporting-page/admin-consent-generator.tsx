"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export default function AdminConsentGenerator() {
  const [tenantId, setTenantId] = useState("");
  const [consentUrl, setConsentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

const handleGenerate = async () => {
  setError(null);
  setConsentUrl("");
  const tid = tenantId?.trim();
  if (!tid) {
    setError("Please enter a tenant ID (GUID) or 'organizations'.");
    return;
  }

  setLoading(true);
  try {
    const resp = await fetch("/api/admin/generate-admin-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tid, expiresIn: "24h" }),
    });

    // Read body once as text
    const raw = await resp.text();

    // Try parse JSON
    let data: any;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      // Not JSON — show raw text for debugging
      throw new Error(`Server returned non-JSON response (status ${resp.status}): ${raw}`);
    }

    if (!resp.ok) {
      // Server returned JSON with an error field
      throw new Error(data?.error || `Server error (status ${resp.status}): ${JSON.stringify(data)}`);
    }

    // Success
    setConsentUrl(data.url);
  } catch (err: any) {
    console.error("generate-admin-consent error:", err);
    setError(err?.message || "Failed to generate URL");
  } finally {
    setLoading(false);
  }
};



  const handleCopy = async () => {
    if (!consentUrl) return;
    try {
      await navigator.clipboard.writeText(consentUrl);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-6 p-4 border rounded-md bg-muted">
      <h2 className="text-lg font-semibold mb-2">Generate Admin Consent URL</h2>
      <div className="flex flex-col md:flex-row gap-2 mb-2">
        <Input
          placeholder="Tenant ID (GUID) or 'organizations'"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : "Generate URL"}
        </Button>
      </div>

      {error && <div className="text-destructive mb-2">{error}</div>}

      {consentUrl && (
        <div className="flex gap-2 items-center">
          <Input
            className="flex-1"
            value={consentUrl}
            readOnly
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button onClick={handleCopy}>Copy</Button>
        </div>
      )}
    </div>
  );
}
