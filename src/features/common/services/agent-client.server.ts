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
  // Mask by assigning empty strings (compile-safe across env typings)
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

/**
 * Resolve the Agent reference (prefer ID, then try name via agents.get, else name fallback).
 * Best: set AZURE_AGENT_ID to the **full ARM Agent Resource ID** from the Foundry portal.
 */
async function resolveAgentRef(): Promise<{ type: "agent_reference"; id?: string; name?: string }> {
  const envId = (process.env.AZURE_AGENT_ID || "").trim();
  const envName = (process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini").trim();

  // If caller configured an ID, use it (accept both versioned IDs e.g. "agent-gpt-5-mini:2"
  // and full ARM resource IDs e.g. "/subscriptions/.../agents/agent-gpt-5-mini")
  if (envId.length > 0) {
    try { console.log("[agent-chat] using agent by id:", envId); } catch {}
    return { type: "agent_reference", id: envId };
  }

  // Otherwise, attempt a dynamic lookup by name if the runtime supports agents.get(name)
  try { console.log("[agent-chat] resolving agent by name via agents.get:", envName); } catch {}
  try {
    const projectClient = createProjectClient();
    const anyProject = projectClient as any;

    if (anyProject.agents && typeof anyProject.agents.get === "function") {
      const retrieved = await anyProject.agents.get(envName);
      const retrievedId = String(retrieved?.id ?? "").trim();
      const latestId = String(retrieved?.versions?.latest?.id ?? "").trim();
      const chosenId = latestId || retrievedId; // prefer explicit version if surfaced

      if (chosenId.length > 0) {
        try { console.log("[agent-chat] resolved agent id:", chosenId); } catch {}
        return { type: "agent_reference", id: chosenId };
      }
      // If no id surfaced, fall back to name
      return { type: "agent_reference", name: envName };
    }
  } catch (e: any) {
    try {
      console.warn(
        "[agent-chat] agents.get(name) failed or not supported; falling back to name. Error:",
        e?.message || e
      );
    } catch {}
  }

  // Final fallback: name reference
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
  const agentRef = await resolveAgentRef();

  // Log the ref we’re about to use (visible in App Service Log stream)
  try { console.log("[agent-chat] agentRef:", agentRef); } catch {}

  const requestArgs: any = {};
  if (params.conversationId) requestArgs.conversation = params.conversationId;

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
      // Log raw error from Foundry (structure varies by tenant/version)
      try { console.error("[agent-chat] response.error:", event.error); } catch {}
      const hint =
        /resource not found/i.test(msg)
          ? `Agent not found for ref ${JSON.stringify(agentRef)}. Ensure the Web App's Managed Identity has 'Azure AI User' on the Project and use a resolvable Agent ID (prefer full ARM resource ID).`
