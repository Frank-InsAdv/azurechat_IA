
"use server";
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

/**
 * Temporarily mask any OpenAI API key env vars so the Projects factory uses
 * Managed Identity only; restore afterwards.
 */
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

/** Create the AI Project client */
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

/** Get the Project-bound OpenAI client (responses.* available; conversations.* may not be) */
export async function getOpenAIClient() {
  resolveApiVersion();
  const restore = temporarilyMaskOpenAIKeyEnv();
  try {
    const projectClient = createProjectClient();
    const anyClient = projectClient as any;

    if (typeof anyClient.getOpenAIClient === "function") {
      return await anyClient.getOpenAIClient();
    }
    if (typeof anyClient.getAzureOpenAIClient === "function") {
      return await anyClient.getAzureOpenAIClient();
    }
    throw new Error(
      "Neither getOpenAIClient() nor getAzureOpenAIClient() exists on AIProjectClient. " +
        "Check the @azure/ai-projects package version."
    );
  } finally {
    restore();
  }
}

type AgentReference = { type: "agent_reference"; id?: string; name?: string };

function getConfiguredAgentRef(): AgentReference {
  const envId = (process.env.AZURE_AGENT_ID || "").trim();
  const envName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();
  if (envId.length > 0) {
    try { console.log("[agent-chat] using agent by id:", envId); } catch {}
    return { type: "agent_reference", id: envId };
  }
  try { console.log("[agent-chat] using agent by name:", envName); } catch {}
  return { type: "agent_reference", name: envName };
}

/** Stream the Agent response (SSE) via Responses API with inline user text */
export async function streamAgentResponse(
  openAIClient: any,
  params: { conversationId?: string; userText: string },
  onDelta: (text: string) => void,
  onConversationId?: (id: string) => void
) {
  const agentRef = getConfiguredAgentRef();

  // Log the ref we’re about to use (visible in App Service Log stream)
  try { console.log("[agent-chat] agentRef:", agentRef); } catch {}

  const requestArgs: any = {};
  if (params.conversationId) requestArgs.conversation = params.conversationId;

  /**
   * Payload strategy:
   *  - If we have an id (e.g., "agent-gpt-5-mini:2"), try raw string first.
   *  - Then try object form with id.
   *  - If only name is present, use object { type, name }.
   */
  const hasId = !!agentRef.id && agentRef.id.length > 0;
  const agentForms: any[] = hasId
    ? [
        agentRef.id,                                // raw string id (preferred)
        { type: "agent_reference", id: agentRef.id } // object reference with id
      ]
    : [{ type: "agent_reference", name: agentRef.name }];

  let emittedConversationId = false;
  let lastErrorMessage = "";

  for (const agentPayload of agentForms) {
    try {
      try { console.log("[agent-chat] trying agent payload form:", agentPayload); } catch {}
      const stream = await openAIClient.responses.stream(requestArgs, {
        body: { agent: agentPayload, input: params.userText },
      });

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
          lastErrorMessage = msg;
          try { console.error("[agent-chat] response.error:", event.error); } catch {}

          if (/resource not found/i.test(msg)) {
            try { console.warn("[agent-chat] 404 for payload form; will try next, if any."); } catch {}
            break; // try next form
          }
          throw new Error(msg);
        }
      }

      if (emittedConversationId) return;
    } catch (err: any) {
      const msg = err?.message || String(err);
      lastErrorMessage = msg;
      if (/resource not found/i.test(msg)) {
        try { console.warn("[agent-chat] 404 while starting stream; trying next form if any."); } catch {}
        continue; // next form
      }
      throw err;
    }
  }

  const hint =
    `Agent not found for ref ${JSON.stringify(agentRef)}. ` +
    `Ensure the Web App's Managed Identity has **Azure AI User** on the **Project** scope: ` +
    `${process.env.AZURE_EXISTING_AIPROJECT_RESOURCE_ID || "<project resource id>"}.`;
  throw new Error(lastErrorMessage ? `${lastErrorMessage}. ${hint}` : hint);
}
``
