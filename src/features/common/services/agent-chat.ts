// Client-side helper for streaming Agent responses from /api/agent-chat via SSE.

export type AgentStreamEvent =
  | { delta: string }
  | { conversationId: string }
  | { error: string };

export type SendViaAgentOptions = {
  /** Existing conversation to continue (if any) */
  conversationId?: string;
  /** Called for each text delta chunk */
  onDelta?: (text: string) => void;
  /** Called once the stream finishes (success or error) */
  onComplete?: () => void;
  /** Provide an AbortSignal to cancel the request */
  signal?: AbortSignal;
};

/**
 * Sends a message through the Agent route and streams back incremental text.
 * Returns the conversationId (new or existing) for subsequent turns.
 */
export async function sendViaAgent(
  message: string,
  opts: SendViaAgentOptions = {}
): Promise<{ conversationId?: string }> {
  const { conversationId, onDelta, onComplete, signal } = opts;

  const resp = await fetch("/api/agent-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId }),
    signal
  });

  // If the route responded with JSON error (non-SSE), throw it
  if (!resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson.error || `HTTP ${resp.status}`);
  }

  // Ensure we have a stream
  const body = resp.body;
  if (!body) throw new Error("No response stream from /api/agent-chat");

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalConversationId: string | undefined = conversationId;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split SSE events on double newline
      const events = buffer.split("\n\n");
      buffer = events.pop() || ""; // keep any partial event

      for (const rawEvent of events) {
        // Only process lines that start with "data:"
        const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;

        const payload = dataLine.replace(/^data:\s*/, "");
        let obj: AgentStreamEvent;
        try {
          obj = JSON.parse(payload);
        } catch {
          // If the payload isn't JSON, skip safely
          continue;
        }

        if ("delta" in obj) {
          onDelta?.(obj.delta);
        } else if ("conversationId" in obj) {
          finalConversationId = obj.conversationId;
        } else if ("error" in obj) {
          throw new Error(obj.error);
        }
      }
    }
  } finally {
    onComplete?.();
    try {
      reader.releaseLock();
    } catch {
      /* no-op */
    }
  }

  return { conversationId: finalConversationId };
}

/**
 * Utility to create a cancellable request using AbortController.
 * Example:
 *
 * const { controller, promise } = sendViaAgentCancellable("Hello", { onDelta });
 * // later: controller.abort();
 */
export function sendViaAgentCancellable(
  message: string,
  opts: Omit<SendViaAgentOptions, "signal"> = {}
): { controller: AbortController; promise: Promise<{ conversationId?: string }> } {
  const controller = new AbortController();
  const promise = sendViaAgent(message, { ...opts, signal: controller.signal });
  return { controller, promise };
}
