// src/features/common/services/agent-client.server.ts
"use server";
import "server-only";

import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

// --- Environment ---
const endpoint = process.env.AZURE_AIPROJECT_ENDPOINT;
if (!endpoint) {
  throw new Error("Missing AZURE_AIPROJECT_ENDPOINT environment variable.");
}

const agentName = process.env.AZURE_AGENT_NAME || "agent-gpt-5-mini";

/**
 * Single AI Project client (server-side only).
 * Auth: Managed Identity via DefaultAzureCredential (preferred).
 * If you later want to use a project API key in Dev, you can swap the credential constructor.
 */
export const projectClient = new AIProjectClient(endpoint, new DefaultAzureCredential());

/**
 * Optional helper: check agent exists and return metadata.
 * Uses the agent NAME so latest published version is selected.
 */
export async function getAgent() {
  return await projectClient.agents.get(agentName);
}

/** Get the OpenAI client bound to your Foundry Project. */
export async function getOpenAIClient() {
  return await projectClient.getOpenAIClient();
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
 * Call `onDelta` with incremental text chunks; forward these to the client in your API route.
 */
export async function streamAgentResponse(
  openAIClient: any,
  conversationId: string,
  onDelta: (text: string) => void
) {
  // Optional early check that the agent exists
  await getAgent();

  const stream = await openAIClient.responses.stream(
    { conversation: conversationId },
    { body: { agent: { name: agentName, type: "agent_reference" } } }
  );

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        onDelta(event.delta);
        break;

      case "response.error":
        throw new Error(event.error?.message ?? "Agent response error");

      case "response.completed":
        // Done
        break;

      default:
        // Extend handling here if you later need tool call events, etc.
        break;
    }
  }
}
