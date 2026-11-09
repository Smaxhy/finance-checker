import { describe, expect, it } from "vitest";
import { consumeNdjson } from "./ndjson";

describe("consumeNdjson", () => {
  it("handles events split across network chunks", () => {
    let buffer = '{"type":"tool","label":"Looking at transactions"}\n{"type":"te';
    let res = consumeNdjson(buffer);
    expect(res.events).toEqual([{ type: "tool", label: "Looking at transactions" }]);
    buffer = res.rest + 'xt","text":"You spent €12"}\n\n{"type":"done"}\n';
    res = consumeNdjson(buffer);
    expect(res.events).toEqual([{ type: "text", text: "You spent €12" }, { type: "done" }]);
    expect(res.rest).toBe("");
  });

  it("skips malformed lines", () => {
    expect(consumeNdjson('not json\n{"nope":1}\n{"type":"done"}\n').events).toEqual([{ type: "done" }]);
  });
});
