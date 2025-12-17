import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

export async function GET() {
  try {
    const endpoint =
      process.env.AZURE_AIPROJECT_ENDPOINT ||
      process.env.AZURE_AI_PROJECT_ENDPOINT_STRING;

    if (!endpoint || endpoint.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Missing AZURE_AIPROJECT_ENDPOINT (or AZURE_AI_PROJECT_ENDPOINT_STRING).",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const projectClient = new AIProjectClient(
      endpoint,
      new DefaultAzureCredential()
    );

    const agents: Array<{
      id: string;
      name: string;
      latest?: { id: string; name: string };
    }> = [];

    const anyProject = projectClient as any;
    if (anyProject.agents && typeof anyProject.agents.list === "function") {
      for await (const agent of anyProject.agents.list()) {
        agents.push({
          id: String(agent?.id ?? ""),
          name: String(agent?.name ?? ""),
          latest: {
            id: String(agent?.versions?.latest?.id ?? ""),
            name: String(agent?.versions?.latest?.name ?? ""),
          },
        });
      }
    } else {
      return new Response(
        JSON.stringify({
          error:
            "agents.list() is not available on this @azure/ai-projects version.",
          endpoint,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        endpoint,
        configured: {
          AZURE_AGENT_ID: process.env.AZURE_AGENT_ID || "",
          AZURE_AGENT_NAME: process.env.AZURE_AGENT_NAME || "",
        },
        agents,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message ?? String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
