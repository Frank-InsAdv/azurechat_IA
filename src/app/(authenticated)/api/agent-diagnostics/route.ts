import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

/** Ensure a usable API version is visible to downstream factories */
function resolveApiVersion(): string {
  const v =
    (process.env.AZURE_OPENAI_API_VERSION?.trim() ||
      process.env.OPENAI_API_VERSION?.trim() ||
      "2024-05-01-preview");
  if (!process.env.OPENAI_API_VERSION || process.env.OPENAI_API_VERSION.trim().length === 0) {
    process.env.OPENAI_API_VERSION = v;
  }
  return v;
}

/** Temporarily mask OpenAI key env vars so Projects factory uses Managed Identity only; restore afterwards */
function temporarilyMaskOpenAIKeyEnv(): () => void {
  const env = process.env as NodeJS.ProcessEnv;
  const original = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
    OPENAI_KEY: (env as any).OPENAI_KEY as string | undefined,
  };
  env.OPENAI_API_KEY = "";
  env.AZURE_OPENAI_API_KEY = "";
  (env as any).OPENAI_KEY = "";
  return () => {
    env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    env.AZURE_OPENAI_API_KEY = original.AZURE_OPENAI_API_KEY;
    (env as any).OPENAI_KEY = original.OPENAI_KEY;
  };
}

export async function GET() {
  try {
    const endpoint =
      process.env.AZURE_AIPROJECT_ENDPOINT ||
      process.env.AZURE_AI_PROJECT_ENDPOINT_STRING ||
      "";

    if (!endpoint || endpoint.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Missing AZURE_AIPROJECT_ENDPOINT (or AZURE_AI_PROJECT_ENDPOINT_STRING).",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    resolveApiVersion();
    const restore = temporarilyMaskOpenAIKeyEnv();

    let projectClient: AIProjectClient;
    try {
      projectClient = new AIProjectClient(endpoint, new DefaultAzureCredential());
    } catch (e: any) {
      restore();
      return new Response(
        JSON.stringify({ error: `Failed to create AIProjectClient: ${e?.message ?? String(e)}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const anyProject = projectClient as any;
    let hasAgentsClient = false;
    let hasAgentsGet = false;

    try {
      hasAgentsClient = Boolean(anyProject.agents);
      hasAgentsGet = hasAgentsClient && typeof anyProject.agents.get === "function";
    } catch {}

    const configuredName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();
    const configuredId = (process.env.AZURE_AGENT_ID || "").trim();

    // Build candidate payloads to try in order
    const formsToTry: any[] = [];

    // If short id present (e.g., "agent-gpt-5-mini:2"), try raw string and object id forms
    if (configuredId.length > 0) {
      formsToTry.push(configuredId); // raw string id preferred by many tenants
      formsToTry.push({ type: "agent_reference", id: configuredId }); // object + id (some tenants)
      // If looks like "name:version", also try name form explicitly
      const m = configuredId.match(/^([^:]+):(\d+)$/);
      if (m) {
        formsToTry.push({ type: "agent_reference", name: m[1] });
      }
    }

    // Always include name form last, so we test it even when id is configured
    if (configuredName.length > 0) {
      formsToTry.push({ type: "agent_reference", name: configuredName });
    }

    // Deduplicate forms by JSON string
    const uniq = (arr: any[]) => {
      const seen = new Set<string>();
      return arr.filter((it) => {
        const key = typeof it === "string" ? it : JSON.stringify(it);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const candidatePayloads = uniq(formsToTry);
    const attempts: any[] = [];

    // Obtain the OpenAI client from the Project (works with MI when keys are masked)
    let openAIClient: any;
    try {
      if (typeof (projectClient as any).getOpenAIClient === "function") {
        openAIClient = await (projectClient as any).getOpenAIClient();
      } else if (typeof (projectClient as any).getAzureOpenAIClient === "function") {
        openAIClient = await (projectClient as any).getAzureOpenAIClient();
      } else {
        throw new Error(
          "Neither getOpenAIClient() nor getAzureOpenAIClient() exists on AIProjectClient. Check @azure/ai-projects version."
        );
      }
    } catch (e: any) {
      restore();
      return new Response(
        JSON.stringify({ error: `Failed to get OpenAI client: ${e?.message ?? String(e)}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      // Try each agent payload with a simple create() call (no SSE) to surface exact server errors
      for (const agentPayload of candidatePayloads) {
        try {
          const resp = await openAIClient.responses.create(
            {},
            { body: { agent: agentPayload, input: "diagnostics ping" } }
          );

          const conv =
            (resp as any)?.conversation ??
            (resp as any)?.conversation_id ??
            (resp as any)?.id ??
            null;

          attempts.push({
            agentPayload,
            ok: true,
            conversation: conv,
            output_text: (resp as any)?.output_text ?? null,
          });

          // If any form succeeded, stop trying further
          break;
        } catch (e: any) {
          attempts.push({
            agentPayload,
            ok: false,
            error: {
              message: e?.message ?? String(e),
            },
          });
          // continue to next payload form
        }
      }
    } finally {
      restore();
    }

    const payload = {
      endpoint,
      configured: {
        AZURE_AGENT_ID: configuredId,
        AZURE_AGENT_NAME: configuredName,
      },
      support: {
        hasAgentsClient,
        hasAgentsGet,
      },
      attempts,
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
