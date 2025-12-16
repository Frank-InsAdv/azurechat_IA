import "server-only";

import {
  getOpenAIClient,
  streamAgentResponse,
} from "@/features/common/services/agent-client.server";

/**
 * POST /api/agent-chat
 * Body: { message: string; conversationId?: string }
 * Stream: text/event-stream
 * Events:
 *  - data: {"conversationId": "<id>"} (sent once when known)
 *  - data: {"delta": "<text chunk>"} (sent many times)
 *  - data: {"error": "<message>"} (only on error)
 */
export async function POST(req: Request) {
  try {
    const { message, conversationId } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({
          error: "Body must include a non-empty 'message' string.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const openAIClient = await getOpenAIClient();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamAgentResponse(
            openAIClient,
            { conversationId, userText: message },
            // onDelta
            (delta) => {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ delta })}\n\n`
                )
              );
            },
            // onConversationId
            (convId) => {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ conversationId: convId })}\n\n`
                )
              );
            }
          );
        } catch (err: any) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: err?.message ?? "Agent response error",
              })}\n\n`
            )
          );
        } finally {
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
    return new Response(
      JSON.stringify({ error: err?.message ?? "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
``
