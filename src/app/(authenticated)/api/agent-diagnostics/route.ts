import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

export async function GET() {
  try {
    const endpoint =
      process.env.AZURE_AIPROJECT_ENDPOINT ||
      process.env.AZURE_AI_PROJECT_ENDPOINT_STRING;

    if (!endpoint || endpoint.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Missing AZURE_AIPROJECT_ENDPOINT (or AZURE_AI_PROJECT_ENDPOINT_STRING).",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const projectClient = new AIProjectClient(
      endpoint,
      new DefaultAzureCredential()
    );
    const anyProject = projectClient as any;

    const configuredName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();
    const configuredId = (process.env.AZURE_AGENT_ID || "").trim();

    // Try agents.get(name) dynamically even if typings don’t include it
    let resolved: any = null;
    let getSupported = false;
    try {
      if (anyProject.agents && typeof anyProject.agents.get === "function") {
        getSupported = true;
        resolved = await anyProject.agents.get(configuredName);
      }
    } catch (e: any) {
      // Swallow and report below
      resolved = { error: e?.message ?? String(e) };
    }

    const payload = {
      endpoint,
      configured: {
        AZURE_AGENT_ID: configuredId,
        AZURE_AGENT_NAME: configuredName,
      },
      support: {
        hasAgentsClient: Boolean(anyProject.agents),
        hasAgentsGet: getSupported,
      },
      resolvedViaGet: resolved
        ? {
            id: String(resolved?.id ?? ""),
            name: String(resolved?.name ?? ""),
            latest: {
              id: String(resolved?.versions?.latest?.id ?? ""),
              name: String(resolved?.versions?.latest?.name ?? ""),
            },
            raw: resolved,
          }
        : null,
    };

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
``
