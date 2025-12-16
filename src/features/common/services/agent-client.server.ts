"use server";
import "server-only";

import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

/**
 * Lazily create an AIProjectClient using runtime env.
 * This avoids throwing at module import during CI builds.
 */
function createProjectClient(): AIProjectClient {
  // Accept either variable name (some docs use *_ENDPOINT_STRING)
  const endpoint =
    process.env.AZURE_AIPROJECT_ENDPOINT ||
    process.env.AZURE_AI_PROJECT_ENDPOINT_STRING;

  if (!endpoint) {
    throw new Error(
      "Missing AZURE_AIPROJECT_ENDPOINT (or AZURE_AI_PROJECT_ENDPOINT_STRING). " +
        "Set it in your Azure Web App application settings."
    );
  }
  return new AIProjectClient(endpoint, new DefaultAzureCredential());
}

/**
 * Get the OpenAI client bound to your Foundry Project.
 * - SDK 1.0.x: getAzureOpenAIClient()
 * - SDK 2.x preview: getOpenAIClient()
 */
export async function getOpenAIClient() {
  const projectClient = createProjectClient();
  const anyClient = projectClient as any;

  if (typeof anyClient.getAzureOpenAIClient === "function") {
    return await anyClient.getAzureOpenAIClient();
  }
  if (typeof anyClient.getOpenAIClient === "function") {
    return await anyClient.getOpenAIClient();
  }
  throw new Error(
    "Neither getAzureOpenAIClient() nor getOpenAIClient() exists on AIProjectClient. " +
      "Check the @azure/ai-projects package version."
  );
}

// ------- Conversation helpers (unchanged) -------

export async function createConversation(openAIClient: any, initialUserText?: string) {
  const conversation = await openAIClient.conversations.create({
    items: initialUserText
      ? [{ type: "message", role: "user", content: initialUserText }]
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
