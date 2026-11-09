/**
 * Exercises the assistant loop end-to-end against a local mock of the
 * Messages streaming API: request shape, tool execution with the user's data
 * client, streamed text events and refusal handling. No network or API key.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { runAssistant, type AssistantEvent } from "./assistant";
import type { ToolContext } from "./tools";

type Captured = { headers: IncomingMessage["headers"]; body: Record<string, unknown> };
let server: Server;
let baseURL = "";
const requests: Captured[] = [];
let scenario: "tool-then-answer" | "refusal" = "tool-then-answer";

function sse(events: Record<string, unknown>[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}
const start = (id: string) => ({
  type: "message_start",
  message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
});
const end = (stop_reason: string) => [
  { type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 12 } },
  { type: "message_stop" },
];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const msgs = body.messages as { role: string; content: unknown }[];
      const hasToolResult = msgs.some((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "tool_result"));
      if (scenario === "refusal") {
        res.end(sse([start("msg_r"), ...end("refusal")]));
      } else if (!hasToolResult) {
        res.end(
          sse([
            start("msg_1"),
            { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "spending_summary", input: {} } },
            { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"from":"2026-11-01","to":"2026-11-09"}' } },
            { type: "content_block_stop", index: 0 },
            ...end("tool_use"),
          ]),
        );
      } else {
        res.end(
          sse([
            start("msg_2"),
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "You spent **€1,748.63** " } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "from 1 to 9 November." } },
            { type: "content_block_stop", index: 0 },
            ...end("end_turn"),
          ]),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Minimal stand-in for the user-scoped Supabase client used by spending_summary. */
function fakeSupabase() {
  const result = { data: [], count: 13, error: null };
  const chain: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(result) : () => chain),
  });
  return {
    rpc: async () => ({
      data: [{ period: "2026-11-01", spent: "1748.63", income: "0", refunds: "0", tx_count: 13 }],
      error: null,
    }),
    from: () => chain,
  } as unknown as ToolContext["supabase"];
}

describe("runAssistant", () => {
  it("runs a tool against the user's data and streams the grounded answer", async () => {
    scenario = "tool-then-answer";
    requests.length = 0;
    const events: AssistantEvent[] = [];
    await runAssistant({
      client: new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 }),
      ctx: { supabase: fakeSupabase(), userId: "u1", currency: "EUR", today: new Date(2026, 10, 9, 12) },
      history: [{ role: "user", content: "How much did I spend this month?" }],
      emit: (e) => events.push(e),
    });

    expect(events).toContainEqual({ type: "tool", name: "spending_summary", label: "Totalling your spending" });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("You spent **€1,748.63** from 1 to 9 November.");
    expect(requests).toHaveLength(2);

    const first = requests[0];
    expect(first.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium" }, stream: true });
    expect(first.body).not.toHaveProperty("thread");
    expect(JSON.stringify(first.body.system)).toContain("Answer ONLY from tool results");
    expect(JSON.stringify(first.body.system)).toContain("2026-11-09");
    const tools = first.body.tools as { name: string; eager_input_streaming?: boolean }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["spending_summary", "list_subscriptions", "upcoming", "search_emails"]));
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);

    // The second turn carries the tool result computed from the (fake) user data.
    const second = JSON.stringify(requests[1].body.messages);
    expect(second).toContain("tool_result");
    expect(second).toContain('\\"spent\\":1748.63');
    expect(second).toContain('\\"includes_demo_data\\":true');
  });

  it("reports a refusal instead of an answer", async () => {
    scenario = "refusal";
    const events: AssistantEvent[] = [];
    await runAssistant({
      client: new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 }),
      ctx: { supabase: fakeSupabase(), userId: "u1", currency: "EUR", today: new Date(2026, 10, 9) },
      history: [{ role: "user", content: "hello" }],
      emit: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "notice", text: "The assistant declined to answer this request." }]);
  });
});
