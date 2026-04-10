import { describe, expect, it } from "vitest";
import {
  TAVERN_PRIOR_ASSISTANT_MAX_CHARS,
  TAVERN_ROLES,
  TAVERN_V2C_PM_MIN_CHARS,
  TAVERN_V2C_PM_MIN_SENTENCES,
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

describe("tavern default chain (教研·产品·家长·学生·主持)", () => {
  it("has four middle roles then host", () => {
    const middle = TAVERN_ROLES.filter((r) => !r.jsonOutput);
    expect(middle).toHaveLength(4);
    expect(middle.map((r) => r.id)).toEqual([
      "teaching_research",
      "product_manager",
      "parent_school",
      "student_delivery",
    ]);
    expect(TAVERN_ROLES.filter((r) => r.jsonOutput)).toHaveLength(1);
  });

  it("teaching_research asks for 教学目标/课标/教研 sections", () => {
    const tr = TAVERN_ROLES.find((r) => r.id === "teaching_research");
    expect(tr).toBeDefined();
    expect(tr!.turnUserPrompt).toContain("### 教学目标与范围");
    expect(tr!.turnUserPrompt).toContain(String(TAVERN_V2C_PM_MIN_SENTENCES));
    expect(tr!.turnUserPrompt).toContain(String(TAVERN_V2C_PM_MIN_CHARS));
  });

  it("product_manager contrasts with 教研", () => {
    const pm = TAVERN_ROLES.find((r) => r.id === "product_manager");
    expect(pm!.turnUserPrompt).toContain("产品经理（教育产品）");
    expect(pm!.turnUserPrompt).toContain("## 与教研一致点");
    expect(pm!.turnUserPrompt).toContain(String(TAVERN_V2C_QA_MIN_SENTENCES));
  });

  it("parent_school covers 家校与家长", () => {
    const p = TAVERN_ROLES.find((r) => r.id === "parent_school");
    expect(p!.turnUserPrompt).toContain("家长与家校协同");
    expect(p!.turnUserPrompt).toContain("家长端");
  });

  it("student_delivery covers 学生与教学落地", () => {
    const s = TAVERN_ROLES.find((r) => r.id === "student_delivery");
    expect(s!.turnUserPrompt).toContain("学生与教学落地");
    expect(s!.turnUserPrompt).toContain("学习者");
  });
});
