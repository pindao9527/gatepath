import { describe, expect, it } from "vitest";
import {
  MAX_COMBINED_REVIEW_CHARS,
  prepareTextsForModel,
} from "./reviewContentBudget";

describe("prepareTextsForModel", () => {
  it("极端比例下双侧均有正文时较短一侧至少保留 1 字（不截成空串）", () => {
    const requirement = "R";
    const test = "T".repeat(MAX_COMBINED_REVIEW_CHARS + 50_000);
    const out = prepareTextsForModel(requirement, test);
    expect(out.requirementText).toBe("R");
    expect(out.testText).not.toBeNull();
    expect(out.testText!.length).toBe(MAX_COMBINED_REVIEW_CHARS - 1);
    expect(out.warnings.length).toBe(1);
  });

  it("对称：测试侧极短、需求侧超长时测试侧至少保留 1 字", () => {
    const requirement = "R".repeat(MAX_COMBINED_REVIEW_CHARS + 50_000);
    const test = "T";
    const out = prepareTextsForModel(requirement, test);
    expect(out.testText).toBe("T");
    expect(out.requirementText).not.toBeNull();
    expect(out.requirementText!.length).toBe(MAX_COMBINED_REVIEW_CHARS - 1);
    expect(out.warnings.length).toBe(1);
  });

  it("合计未超上限时不截断、无警告", () => {
    const out = prepareTextsForModel("需求", "测试");
    expect(out.requirementText).toBe("需求");
    expect(out.testText).toBe("测试");
    expect(out.warnings).toEqual([]);
  });
});
