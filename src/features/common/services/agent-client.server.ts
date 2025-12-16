"use server";
import "server-only";

import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

// --- Environment ---
const endpoint = process.env.AZURE_AIPROJECT_ENDPOINT;
if (!endpoint) throw new Error("Missing AZURE_AIPROJECT_ENDPOINT");

const agentName = process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini";
// Optional: pin a specific version, e.g., "agent-gpt-5-mini:2"
const agentId = process.env.AZURE_AGENT_ID;

// Single server-side client (Managed Identity)
export const projectClient = new AIProjectClient(endpoint, new DefaultAzureCredential());

/**
 * Get the OpenAI client bound to your Foundry Project.
 * - SDK 1.0.x: projectClient.getAzureOpenAIClient()
 * - SDK 2.x preview: projectClient.getOpenAIClient()
 */
export async function getOpenAIClient() {
  const anyClient = projectClient as any;

  if (typeof anyClient.getAzureOpenAIClient === "function") {
    return await anyClient.getAzureOpenAIClient();
  }
  if (typeof anyClient.getOpenAIClient === "function") {
    return await anyClient.getOpenAIClient();
  }
  throw new Error(
    "Neither getAzureOpenAIClient() nor getOpenAIClient() exists on AIProjectClient. " +
    "Check the @azure/ai-projects version."
  );
}

/** Create a new conversation, optionally seeded with a user message. */
export async function createConversation(openAIClient: any, initialUserText?: string) {
  const conversation = await openAIClient.conversations.create({
    items: initialUserText
      ? [{ type: "message", role: "user", content: initialUserText }]
      : []
  });
  return conversation.id as string;
}

/** Append a user message to an existing conversation. */
export async function appendUserMessage(openAIClient: any, conversationId: string, userText: string) {
  if (!userText) return;
  const conv = await openAIClient.conversations.get(conversationId);
  const items = conv.items ?? [];
  items.push({ type: "message", role: "user", content: userText });
  await openAIClient.conversations.update(conversationId, { items });
}

/** Create or reuse a conversation and add the user message appropriately. */
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
 * Forward `delta` chunks to the client via your API route.
 */
export async function streamAgentResponse(
  openAIClient: any,
  conversationId: string,
  onDelta: (text: string) => void
) {
  // Build the agent reference: by id (if provided) or by name (latest version)
  const agentRef =
    agentId && agentId.length > 0
      ? { id: agentId, type: "agent_reference" }
      : { name: agentName, type: "agent_reference" };

  const stream = await openAIClient.responses.stream(
    { conversation: conversationId },
    { body: { agent: agentRef } }
  );

  // Stream OpenAI Responses API events; consume text deltas
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      onDelta(event.delta);
    } else if (event.type === "response.error") {
      throw new Error(event.error?.message ?? "Agent response error");
    }
    // (Optional) extend handling for tool-call events later if needed
  }
}
