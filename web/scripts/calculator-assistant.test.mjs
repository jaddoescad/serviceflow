import assert from "node:assert/strict";
import test from "node:test";
import { Agent, OpenAIResponsesModel, Runner, tool } from "@openai/agents";
import { z } from "zod";

// Exercise the actual Responses adapter and streaming runner without API calls
// or database writes. Usage accompanies both tool calls and the final reply.
for (const [name, details] of Object.entries({
  "numeric usage": { cached_tokens: 0, cache_write_tokens: 0 },
  "nested cache usage": {
    cached_tokens: 12,
    cache_write_tokens: 8,
    cache_write_tokens_details: { ttl_12h_tokens: 3, ttl_30m_tokens: 5 },
  },
  "empty cache breakdown": {
    cached_tokens: 0,
    cache_write_tokens: 0,
    cache_write_tokens_details: {},
  },
})) {
  test(`calculator assistant completes a streamed tool round trip with ${name}`, async () => {
    let requests = 0;
    const operations = [];
    const client = {
      responses: {
        async *create(request) {
          assert.equal(request.stream, true);
          const turn = ++requests;
          if (turn === 2) {
            assert.ok(request.input.some((item) =>
              item.type === "function_call_output" && item.call_id === "call_room",
            ));
          }
          yield {
            type: "response.completed",
            response: {
              id: `resp_${turn}`,
              status: "completed",
              output: turn === 1 ? [{
                type: "function_call",
                id: "fc_room",
                call_id: "call_room",
                name: "add_room",
                arguments: JSON.stringify({ name: "Kitchen" }),
                status: "completed",
              }] : [{
                type: "message",
                id: "msg_done",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Kitchen added.", annotations: [] }],
              }],
              usage: {
                input_tokens: 100,
                input_tokens_details: structuredClone(details),
                output_tokens: 10,
                output_tokens_details: { reasoning_tokens: 2 },
                total_tokens: 110,
              },
            },
          };
        },
      },
    };
    const agent = new Agent({
      name: "Calculator usage regression",
      model: new OpenAIResponsesModel(client, "gpt-5-mini"),
      tools: [tool({
        name: "add_room",
        description: "Add a room to the test quote.",
        parameters: z.object({ name: z.string() }),
        async execute({ name }) {
          operations.push({ type: "addRoom", name });
          return "Kitchen added.";
        },
      })],
    });
    const runner = new Runner({ tracingDisabled: true });
    const result = await runner.run(agent, "Add Kitchen", { stream: true, maxTurns: 8 });
    const events = [];
    for await (const event of result) events.push(event);
    await result.completed;

    assert.equal(result.finalOutput, "Kitchen added.");
    assert.deepEqual(operations, [{ type: "addRoom", name: "Kitchen" }]);
    assert.equal(requests, 2);
    assert.ok(events.some((event) =>
      event.type === "run_item_stream_event" && event.name === "tool_called",
    ));
    assert.equal(result.state.usage.totalTokens, 220);
    assert.equal(result.state.usage.requestUsageEntries.length, 2);
    for (const entry of result.state.usage.requestUsageEntries) {
      assert.deepEqual(entry.inputTokensDetails, details);
    }
  });
}
