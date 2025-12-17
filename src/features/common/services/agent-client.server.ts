"use server";
import "server-only";

import { ManagedIdentityCredential } from "@azure/identity";
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

/** Temporarily mask OpenAI key env vars so Projects uses Managed Identity only */
function temporarilyMaskOpenAIKeyEnv(): () => void {
  const env = process.env as NodeJS.ProcessEnv;
  const original = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
    OPENAI_KEY: (env as any).OPENAI_KEY as string | undefined,
  };
  // Mask keys to ensure MI is used
  env.OPENAI_API_KEY = "";
  env.AZURE_OPENAI_API_KEY = "";
  (env as any).OPENAI_KEY = "";
  return () => {
    env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    env.AZURE_OPENAI_API_KEY = original.AZURE_OPENAI_API_KEY;
    (env as any).OPENAI_KEY = original.OPENAI_KEY;
  };
}

/** Create the AI Project client with Managed Identity (SAMI by default; UAMI if AZURE_CLIENT_ID is set) */
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

  // If you attach a User-Assigned Managed Identity, set AZURE_CLIENT_ID=<UAMI client id>
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const credential = clientId
    ? new ManagedIdentityCredential(clientId) // UAMI
    : new ManagedIdentityCredential();        // SAMI

  return new AIProjectClient(endpoint, credential);
}

/** Get the Project-bound OpenAI client (responses.* available) */
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

/** Choose the agent payload: prefer ID (short or ARM), else name form compatible with Foundry sample */
function getAgentPayload(): string | { type: "agent_reference"; name: string } {
  const id = (process.env.AZURE_AGENT_ID || "").trim();
  const name = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();

  if (id.length > 0) {
    try { console.log("[agent-chat] using agent by id:", id); } catch {}
    // Send raw string id (supports "agent-gpt-5-mini:2" or full ARM resource ID)
    return id;
  }
  try { console.log("[agent-chat] using agent by name:", name); } catch {}
  return { type: "agent_reference", name };
}

/** Stream the Agent response (SSE) via Responses API */
export async function streamAgentResponse(
  openAIClient: any,
  params: { conversationId?: string; userText: string },
  onDelta: (text: string) => void,
  onConversationId?: (id: string) => void
) {
  const agentPayload = getAgentPayload();

  const requestArgs: any = {};
  if (params.conversationId) requestArgs.conversation = params.conversationId;

  const stream = await openAIClient.responses.stream(requestArgs, {
    body: { agent: agentPayload, input: params.userText },
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
      try { console.error("[agent-chat] response.error:", event.error); } catch {}
      // Helpful hint if you still see 404s
      const hint =
        /resource not found/i.test(msg)
          ? `Agent not found for payload ${JSON.stringify(agentPayload)}. Ensure the Web App's Managed Identity has 'Azure AI User' on the **Project** scope and the agent version is Published.`
          : "";
      throw new Error(hint ? `${msg}. ${hint}` : msg);
    }
  }
}
