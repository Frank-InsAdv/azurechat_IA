
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

  // Ensure downstream code that *expects* OPENAI_API_VERSION sees a value.
  if (!process.env.OPENAI_API_VERSION || process.env.OPENAI_API_VERSION.trim().length === 0) {
    process.env.OPENAI_API_VERSION = v;
  }
  return v;
}

/**
 * Temporarily mask any OpenAI API key env vars (set to undefined) so the Projects factory
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

  // Mask by assigning undefined (valid per NodeJS.ProcessEnv: string | undefined)
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
 * This avoids throwing at module import during CI builds.
 */
function createProjectClient(): AIProjectClient {
  // Accept either variable name (some docs use *_ENDPOINT_STRING)
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
 * - Uses Managed Identity via AI Projects.
 * - Avoids the "apiKey and azureADTokenProvider are mutually exclusive" error
 *   by temporarily masking any API key env vars during client creation.
 */
export async function getOpenAIClient() {
  // Ensure version visible to the factories
  resolveApiVersion();

  const projectClient = createProjectClient();
  const anyClient = projectClient as any;

  // Temporarily mask key envs while instantiating OpenAI client (MI-only),
  // then restore so other parts of the app (e.g., /api/chat) remain unaffected.
  const restore = temporarilyMaskOpenAIKeyEnv();
  try {
    if (typeof anyClient.getAzureOpenAIClient === "function") {
      // Avoid passing options that could reintroduce conflicts
      return await anyClient.getAzureOpenAIClient();
    }
    if (typeof anyClient.getOpenAIClient === "function") {
      return await anyClient.getOpenAIClient();
    }
    throw new Error(
      "Neither getAzureOpenAIClient() nor getOpenAIClient() exists on AIProjectClient. " +
        "Check the @azure/ai-projects package version."
    );
  } finally {
    restore();
  }
}

// ------- Conversation helpers (unchanged) -------

export async function createConversation(openAIClient: any, initialUserText?: string) {
  const conversation = await openAIClient.conversations.create({
    items: initialUserText
      ? [{ type: "message", role: "user,", content: initialUserText }]
      : [],
  });
  return conversation.id as string;
}

export async function appendUserMessage(
  openAIClient: any,
  conversationId: string,
  userText: string
) {
  if (!userText) return;
  const conv = await openAIClient.conversations.get(conversationId);
  const items = conv.items ?? [];
  items.push({ type: "message", role: "user", content: userText });
  await openAIClient.conversations.update(conversationId, { items });
}

export async function ensureConversation(
  openAIClient: any,
  conversationId?: string,
  userText?: string
) {
  if (!conversationId) {
    return await createConversation(openAIClient, userText);
  }
  await appendUserMessage(openAIClient, conversationId, userText ?? "");
  return conversationId;
}

/**
 * Stream the Agent response (SSE-style).
 * Sends `delta` chunks via the provided callback.
 */
export async function streamAgentResponse(
  openAIClient: any,
  conversationId: string,
  onDelta: (text: string) => void
) {
  const agentName = process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini";
  const agentId = process.env.AZURE_AGENT_ID; // optional pin, e.g. "agent-gpt-5-mini:2"

  const agentRef =
    agentId && agentId.length > 0
      ? { id: agentId, type: "agent_reference" }
      : { name: agentName, type: "agent_reference" };

  const stream = await openAIClient.responses.stream(
    { conversation: conversationId },
    { body: { agent: agentRef } }
  );

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      onDelta(event.delta);
    } else if (event.type === "response.error") {
      throw new Error(event.error?.message ?? "Agent response error");
    }
    // ignore other event types; extend later for tools if needed
  }
}
``
