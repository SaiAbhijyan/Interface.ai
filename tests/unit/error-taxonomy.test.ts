import { describe, it, expect } from "vitest";
import { ReplayStatusSchema } from "../../src/artifact/schema.js";

describe("error taxonomy", () => {
  it("defines the four replay statuses", () => {
    expect(ReplayStatusSchema.options).toEqual([
      "success",
      "business_outcome",
      "recoverable",
      "hard_failure",
    ]);
  });
});
