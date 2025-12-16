// src/app/(authenticated)/api/agent-chat/route.ts
import "server-only";

import {
  getOpenAIClient,
  ensureConversation,
  streamAgentResponse,
} from "@/features/common/services/agent-client.server";

/**
 * POST /api/agent-chat
 * Body: { message: string; conversationId?: string }
 * Stream: text/event-stream
 * Events:
 *  - data: {"conversationId": "<id>"} (sent once at start)
 *  - data: {"delta": "<text chunk>"} (sent many times)
 *  - data: {"error": "<message>"} (only on error)
 */
export async function POST(req: Request) {
  try {
    const { message, conversationId } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Body must include a non-empty 'message' string." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the OpenAI client bound to your Foundry Project (Managed Identity)
    const openAIClient = await getOpenAIClient();

    // Create or reuse the conversation and append the user message
    const convId = await ensureConversation(openAIClient, conversationId, message);

    // SSE stream to the client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send conversationId first so the UI can persist it
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ conversationId: convId })}\n\n`)
        );

        try {
          // Stream agent deltas
          await streamAgentResponse(openAIClient, convId, (delta) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          });
        } catch (err: any) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: err?.message ?? "Agent response error" })}\n\n`
            )
          );
        } finally {
          // Close the SSE stream
          controller.close();
        }
      },
      cancel() {
        // Client aborted; nothing special to do
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: any) {
    // Invalid JSON or unexpected server error
    return new Response(
      JSON.stringify({ error: err?.message ?? "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
