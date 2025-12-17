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
    const hasAgentsClient = Boolean(anyProject.agents);
    const hasAgentsGet = hasAgentsClient && typeof anyProject.agents.get === "function";

    const configuredName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();
    const configuredId = (process.env.AZURE_AGENT_ID || "").trim();

    // Candidate agent payloads to try
    const formsToTry: any[] = [];
    if (configuredId.length > 0) {
      formsToTry.push(configuredId); // raw short id: "agent-gpt-5-mini:2"
      formsToTry.push({ type: "agent_reference", id: configuredId });
      const m = configuredId.match(/^([^:]+):(\d+)$/);
      if (m) formsToTry.push({ type: "agent_reference", name: m[1] });
    }
    if (configuredName.length > 0) {
      formsToTry.push({ type: "agent_reference", name: configuredName });
    }
    // Deduplicate
    const seen = new Set<string>();
    const candidatePayloads = formsToTry.filter((p) => {
      const k = typeof p === "string" ? p : JSON.stringify(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Get OpenAI client via Project
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

    const attempts: any[] = [];
    let conversationId: string | null = null;

    try {
      // ===== Attempt Pattern A: Create conversation first (Foundry sample flow) =====
      try {
        const conv = await openAIClient.conversations.create({
          items: [{ type: "message", role: "user", content: "diagnostics: please respond" }],
        });
        conversationId = String(conv?.id ?? "");
      } catch (e: any) {
        attempts.push({
          step: "conversations.create",
          ok: false,
          error: { message: e?.message ?? String(e) },
        });
        // We will continue with Pattern B (direct responses without conversation)
      }

      // If conversation created, try responses.create for each agent payload
      if (conversationId) {
        for (const agentPayload of candidatePayloads) {
          try {
            const resp = await openAIClient.responses.create(
              { conversation: conversationId },
              { body: { agent: agentPayload } }
            );
            attempts.push({
              step: "responses.create (with conversation)",
              agentPayload,
              ok: true,
              conversation: conversationId,
              output_text: (resp as any)?.output_text ?? null,
            });
            // Stop on first success
            break;
          } catch (e: any) {
            attempts.push({
              step: "responses.create (with conversation)",
              agentPayload,
              ok: false,
              error: { message: e?.message ?? String(e) },
            });
          }
        }
      }

      // ===== Attempt Pattern B: Direct responses.create with input (no conversation) =====
      if (!attempts.some((a: any) => a.ok)) {
        for (const agentPayload of candidatePayloads) {
          try {
            const resp = await openAIClient.responses.create(
              {},
              { body: { agent: agentPayload, input: "diagnostics: please respond" } }
            );
            attempts.push({
              step: "responses.create (no conversation) with input",
              agentPayload,
              ok: true,
              conversation: (resp as any)?.conversation ?? (resp as any)?.conversation_id ?? null,
              output_text: (resp as any)?.output_text ?? null,
            });
            break; // stop on first success
          } catch (e: any) {
            attempts.push({
              step: "responses.create (no conversation) with input",
              agentPayload,
              ok: false,
              error: { message: e?.message ?? String(e) },
            });
          }
        }
      }

      // ===== Attempt Pattern C: Direct responses.stream (SSE) with input (no conversation) =====
      if (!attempts.some((a: any) => a.ok)) {
        for (const agentPayload of candidatePayloads) {
          try {
            const stream = await openAIClient.responses.stream(
              {},
              { body: { agent: agentPayload, input: "diagnostics: please respond" } }
            );
            let gotText = "";
            for await (const event of stream) {
              if ((event as any).type === "response.output_text.delta") {
                gotText += (event as any).delta || "";
              }
            }
            attempts.push({
              step: "responses.stream (no conversation) with input",
              agentPayload,
              ok: gotText.length > 0,
              output_text: gotText || null,
            });
            if (gotText.length > 0) break;
          } catch (e: any) {
            attempts.push({
              step: "responses.stream (no conversation) with input",
              agentPayload,
              ok: false,
              error: { message: e?.message ?? String(e) },
            });
          }
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
      conversationId,
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
