import { describe, expect, it } from "vitest";
import {
  TAVERN_PRIOR_ASSISTANT_MAX_CHARS,
  TAVERN_ROLES,
  TAVERN_V2C_PM_MIN_CHARS,
  TAVERN_V2C_PM_MIN_SENTENCES,
  TAVERN_V2C_QA_MIN_CHARS,
  TAVERN_V2C_QA_MIN_SENTENCES,
  truncatePriorAssistantTextForTransfer,
} from "./reviewApi";

describe("truncatePriorAssistantTextForTransfer", () => {
  it("returns short text unchanged", () => {
    expect(truncatePriorAssistantTextForTransfer("abc")).toBe("abc");
  });

  it("truncates beyond max and appends notice", () => {
    const long = "x".repeat(TAVERN_PRIOR_ASSISTANT_MAX_CHARS + 42);
    const out = truncatePriorAssistantTextForTransfer(long);
    expect(out.length).toBeLessThanOrEqual(
      TAVERN_PRIOR_ASSISTANT_MAX_CHARS + 80,
    );
    expect(out.startsWith("x".repeat(TAVERN_PRIOR_ASSISTANT_MAX_CHARS))).toBe(
      true,
    );
    expect(out).toContain("已截断");
    expect(out).toContain("42");
  });
});

describe("v2-C tavern turn prompts", () => {
  it("PM role asks for 现象/依据/建议 sections and min expansion", () => {
    const pm = TAVERN_ROLES.find((r) => r.id === "pm");
    expect(pm).toBeDefined();
    expect(pm!.turnUserPrompt).toContain("### 现象");
    expect(pm!.turnUserPrompt).toContain("### 依据");
    expect(pm!.turnUserPrompt).toContain("### 建议与风险");
    expect(pm!.turnUserPrompt).toContain(String(TAVERN_V2C_PM_MIN_SENTENCES));
    expect(pm!.turnUserPrompt).toContain(String(TAVERN_V2C_PM_MIN_CHARS));
  });

  it("QA role asks for 一致/分歧/补充 vs prior", () => {
    const qa = TAVERN_ROLES.find((r) => r.id === "qa");
    expect(qa).toBeDefined();
    expect(qa!.turnUserPrompt).toContain("## 与前序一致点");
    expect(qa!.turnUserPrompt).toContain("## 分歧或待核实点");
    expect(qa!.turnUserPrompt).toContain("## 补充点（测试视角）");
    expect(qa!.turnUserPrompt).toContain(String(TAVERN_V2C_QA_MIN_SENTENCES));
    expect(qa!.turnUserPrompt).toContain(String(TAVERN_V2C_QA_MIN_CHARS));
  });
});
