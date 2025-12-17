"use server";
import "server-only";

import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

/**
 * Returns a usable OpenAI API version.
 * Prefers AZURE_OPENAI_API_VERSION, then OPENAI_API_VERSION, then a safe default.
 * Also writes OPENAI_API_VERSION to process.env for downstream factories that expect it.
 */
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

/**
 * Temporarily mask any OpenAI API key env vars (set to empty string) so the Projects factory
 * uses Managed Identity only; then restore them right after the client is created.
 * NOTE: This does NOT delete your App Settings. It's an in-process, temporary mask.
 */
function temporarilyMaskOpenAIKeyEnv(): () => void {
  const env = process.env as NodeJS.ProcessEnv;

  const original = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
    OPENAI_KEY: (env as any).OPENAI_KEY as string | undefined, // legacy alias
  };

  // Mask by assigning empty strings (type-safe across builds)
  env.OPENAI_API_KEY = "";
  env.AZURE_OPENAI_API_KEY = "";
  (env as any).OPENAI_KEY = "";

  // Return restore function
  return () => {
    env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    env.AZURE_OPENAI_API_KEY = original.AZURE_OPENAI_API_KEY;
    (env as any).OPENAI_KEY = original.OPENAI_KEY;
  };
}

/**
 * Lazily create an AIProjectClient using runtime env.
 */
function createProjectClient(): AIProjectClient {
  const endpoint =
    process.env.AZURE_AIPROJECT_ENDPOINT ||
    process.env.AZURE_AI_PROJECT_ENDPOINT_STRING;

  if (!endpoint || endpoint.trim().length === 0) {
    throw new Error(
      "Missing AZURE_AIPROJECT_ENDPOINT (or AZURE_AI_PROJECT_ENDPOINT_STRING). " +
        "Set it in your Azure Web App application settings."
    );
  }
  return new AIProjectClient(endpoint, new DefaultAzureCredential());
}

/**
 * Get the OpenAI client bound to your Foundry Project.
 * ✅ Prefer the Projects client (`getOpenAIClient`) which exposes `responses.*`.
 * ⬇️ Fallback to Azure client only if Projects client is not available.
 * Mask key envs during instantiation to avoid the mutually-exclusive auth error,
 * then restore so your standard `/api/chat` remains unaffected.
 */
export async function getOpenAIClient() {
  resolveApiVersion();

  const restore = temporarilyMaskOpenAIKeyEnv();
  try {
    const projectClient = createProjectClient();
    const anyClient = projectClient as any;

    if (typeof anyClient.getOpenAIClient === "function") {
      return await anyClient.getOpenAIClient(); // Projects-bound; has `.responses`
    }
    if (typeof anyClient.getAzureOpenAIClient === "function") {
      return await anyClient.getAzureOpenAIClient(); // Azure OpenAI; `.responses` available, no `.conversations`
    }
    throw new Error(
      "Neither getOpenAIClient() nor getAzureOpenAIClient() exists on AIProjectClient. " +
        "Check the @azure/ai-projects package version."
    );
  } finally {
    restore();
  }
}

/**
 * Resolve the Agent reference to use:
 * - If AZURE_AGENT_ID is set, use it directly.
 * - Else, if AZURE_AGENT_NAME is set, try to resolve name -> id by listing agents.
 * - Else, throw a helpful error.
 */
async function resolveAgentRef(): Promise<{ type: "agent_reference"; id?: string; name?: string }> {
  const envId = (process.env.AZURE_AGENT_ID || "").trim();
  const envName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();

  if (envId.length > 0) {
    try { console.log("[agent-chat] using agent by id:", envId); } catch {}
    return { type: "agent_reference", id: envId };
  }

  // Try to resolve via listing (handles SDKs without .agents.get(name))
  try { console.log("[agent-chat] resolving agent by name:", envName); } catch {}

  try {
    const projectClient = createProjectClient();
    const anyProject = projectClient as any;

    if (anyProject.agents && typeof anyProject.agents.list === "function") {
      // Iterate the list and match by name (either root name or latest version name)
      // NOTE: types are 'any' to avoid compile errors across SDK variants.
      for await (const agent of anyProject.agents.list()) {
        const aName = (agent?.name ?? "").trim();
        const latestName = (agent?.versions?.latest?.name ?? "").trim();
        const aId = String(agent?.id ?? "").trim();
        const latestId = String(agent?.versions?.latest?.id ?? "").trim();

        if (aName === envName || latestName === envName) {
          const chosenId = latestId || aId;
          if (chosenId.length > 0) {
            try { console.log("[agent-chat] resolved agent id:", chosenId); } catch {}
            return { type: "agent_reference", id: chosenId };
          }
          // If no id surfaced, fall back to name reference.
          break;
        }
      }
    }
  } catch (e: any) {
    try { console.warn("[agent-chat] agents.list() failed; falling back to name. Error:", e?.message || e); } catch {}
  }

  // Fallback: use name reference
  return { type: "agent_reference", name: envName };
}

/**
 * Stream the Agent response (SSE-style) using the Responses API.
 * - If `conversationId` is provided, the API continues that thread.
 * - Otherwise, the API will start a new conversation and the stream will
 *   include events that allow us to discover its id (we emit via `onConversationId`).
 */
export async function streamAgentResponse(
  openAIClient: any,
  params: {
    conversationId?: string;
    userText: string;
  },
  onDelta: (text: string) => void,
  onConversationId?: (id: string) => void
) {
  const agentRef = await resolveAgentRef();

  // Build request using Responses API with inline user text.
  const requestArgs: any = {};
  if (params.conversationId) {
    requestArgs.conversation = params.conversationId;
  }

  const stream = await openAIClient.responses.stream(requestArgs, {
    body: { agent: agentRef, input: params.userText },
  });

  let emittedConversationId = false;

  for await (const event of stream) {
    const responseObj: any = (event as any).response;
    const convIdCandidate =
      responseObj?.conversation ??
      responseObj?.conversation_id ??
      responseObj?.id;

    if (!emittedConversationId && typeof convIdCandidate === "string") {
      onConversationId?.(convIdCandidate);
      emittedConversationId = true;
    }

    if (event.type === "response.output_text.delta") {
      onDelta(event.delta);
    } else if (event.type === "response.error") {
      const msg = event.error?.message ?? "Agent response error";
      // Add hint if Foundry returns 404 for the agent reference.
      const hint =
        /resource not found/i.test(msg)
          ? `Agent not found. Check AZURE_AGENT_ID (${process.env.AZURE_AGENT_ID || "unset"}) or AZURE_AGENT_NAME (${process.env.AZURE_AGENT_NAME || "unset"}).`
          : "";
      throw new Error(hint ? `${msg}. ${hint}` : msg);
    }
    // Ignore other event types; extend later for tools if needed.
  }
}
``
