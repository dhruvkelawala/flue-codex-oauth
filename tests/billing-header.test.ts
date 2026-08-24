import { describe, expect, it } from "vitest";
import { buildBillingHeader, ensureBillingHeader } from "../src/billing-header.ts";

describe("billing header", () => {
  it("is deterministic from first user text", () => {
    expect(
      buildBillingHeader([{ role: "user", content: "hello from flue and claude" }], {
        version: "2.1.96",
      }),
    ).toBe(
      "x-anthropic-billing-header: cc_version=2.1.96.222; cc_entrypoint=flue; cch=533e6;",
    );
  });

  it("extracts structured text and preserves payload fields", () => {
    const payload = {
      system: [{ type: "text", text: "system" }],
      messages: [
        { role: "user", content: [{ type: "image" }, { type: "text", text: "hello" }] },
      ],
      tools: [{ name: "x" }],
    };

    const next = ensureBillingHeader(payload);

    expect((next.system as unknown[])).toHaveLength(2);
    expect(next.messages).toBe(payload.messages);
    expect(next.tools).toBe(payload.tools);
  });

  it("preserves a string-valued system prompt", () => {
    const next = ensureBillingHeader({ system: "important instructions", messages: [] });

    expect(next.system).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^x-anthropic-billing-header:/) }),
      { type: "text", text: "important instructions" },
    ]);
  });

  it("preserves an existing billing block byte-for-byte", () => {
    const block = { type: "text", text: "x-anthropic-billing-header: existing" };
    const payload = { system: [block], messages: [] };

    const next = ensureBillingHeader(payload);

    expect(next).toBe(payload);
    expect((next.system as unknown[])[0]).toBe(block);
  });
});
