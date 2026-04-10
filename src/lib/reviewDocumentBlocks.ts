/**
 * 评审送模前的「需求 / 测试」正文块（quick 与酒馆轮次共用）。
 */

export function buildRequirementTestUserContent(
  requirement: string | null,
  test: string | null,
): string {
  const req =
    requirement != null && requirement.length > 0
      ? requirement
      : "（未提供需求文档）";
  const tst =
    test != null && test.length > 0 ? test : "（未提供测试文档）";
  return `【需求文档】\n${req}\n\n【测试文档】\n${tst}`;
}
