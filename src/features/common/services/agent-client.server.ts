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

/** Temporarily mask OpenAI key env vars so Projects uses Managed Identity only */
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

/** Resolve by name only (aligns with Foundry sample & Playground) */
function getAgentName(): string {
  const name = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();
  try { console.log("[agent-chat] using agent by name:", name); } catch {}
  return name;
}

/** Stream the Agent response (SSE) via Responses API with inline user text */
export async function streamAgentResponse(
  openAIClient: any,
  params: { conversationId?: string; userText: string },
  onDelta: (text: string) => void,
  onConversationId?: (id: string) => void
) {
  const agentName = getAgentName();

  const requestArgs: any = {};
  if (params.conversationId) requestArgs.conversation = params.conversationId;

  const agentPayload = { type: "agent_reference", name: agentName };

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
      // If you still see 404 here, it’s IAM/scope—not payload—because Playground works.
      const hint =
        /resource not found/i.test(msg)
          ? `Agent not found by name '${agentName}'. Ensure the Web App's Managed Identity has 'Azure AI User' on the **Project** scope and restart the app.`
          : "";
      throw new Error(hint ? `${msg}. ${hint}` : msg);
    }
  }
}
``
