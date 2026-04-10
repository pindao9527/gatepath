import { describe, expect, it } from "vitest";
import {
  inferRuleHitsFromText,
  mergeMiddleRolesFromSources,
  rebuildMiddleRolesPrompts,
  validateMiddleRoleCount,
} from "./tavernDynamicRoles";
import { getDefaultTavernMiddleRoles } from "./tavernRoleCatalog";

describe("inferRuleHitsFromText", () => {
  it("matches compliance keywords", () => {
    const hits = inferRuleHitsFromText("本需求含合规与隐私条款", null, false);
    expect(hits.some((h) => h.id === "legal")).toBe(true);
  });

  it("respects useTestDocument=false", () => {
    const hits = inferRuleHitsFromText(null, "合规审计", false);
    expect(hits.length).toBe(0);
  });

  it("includes test when enabled", () => {
    const hits = inferRuleHitsFromText(null, "合规审计", true);
    expect(hits.some((h) => h.id === "legal")).toBe(true);
  });
});

describe("mergeMiddleRolesFromSources", () => {
  it("falls back to default when empty", () => {
    const fb = getDefaultTavernMiddleRoles();
    const merged = mergeMiddleRolesFromSources({
      ruleHits: [],
      modelRoles: null,
      fallbackMiddle: fb,
    });
    expect(merged.length).toBe(fb.length);
    expect(merged[0]?.id).toBe("teaching_research");
  });
});

describe("validateMiddleRoleCount", () => {
  it("rejects over max", () => {
    const v = validateMiddleRoleCount(11);
    expect(v.ok).toBe(false);
  });
});

describe("rebuildMiddleRolesPrompts", () => {
  it("first role uses first-middle template", () => {
    const base = getDefaultTavernMiddleRoles();
    const rebuilt = rebuildMiddleRolesPrompts(base.map((r) => ({ ...r })));
    expect(rebuilt[0]?.turnUserPrompt).toContain("### 教学目标与关注点");
    expect(rebuilt[1]?.turnUserPrompt).toContain("## 与前序一致点");
  });
});
