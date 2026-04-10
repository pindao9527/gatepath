/**
 * 快速单轮评审：system + 用户文档块。
 */

import { buildRequirementTestUserContent } from "./reviewDocumentBlocks";

const QUICK_REVIEW_SYSTEM_PROMPT = `你是资深教育信息化与教学业务评审专家。用户将提供「需求文档」与「测试文档」的纯文本（可能仅其一有内容）；内容通常面向学校、师生或教育产品场景。
请综合评审：教学目标与课标衔接、教学流程可落地性、学业评价与可测性、家校与数据合规、风险与遗漏，并给出可执行的修改建议。

你必须只输出一个 JSON 对象，不要 Markdown 代码围栏，不要其它说明文字。JSON 必须符合以下 TypeScript 接口：
{
  "score": number,  // 0 到 100 的整数，表示整体评审得分
  "suggestions": string[]  // 至少一条字符串建议，简明可执行
}`;

export function buildReviewMessages(
  requirement: string | null,
  test: string | null,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: QUICK_REVIEW_SYSTEM_PROMPT },
    { role: "user", content: buildRequirementTestUserContent(requirement, test) },
  ];
}
