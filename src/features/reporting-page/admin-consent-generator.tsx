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
    if (!tenantId.trim()) {
      setError("Please enter a tenant ID (GUID) or 'organizations'.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/auth/generate-admin-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenantId.trim(), expiresIn: "24h" }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || "Failed to generate URL");
      }
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
