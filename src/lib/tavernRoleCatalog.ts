/**
 * 内置酒馆角色目录与链式组装（单一数据源）。
 * 默认链：教研课标 → 产品经理 → 家长与家校 → 学生与教学落地 → 综合主持。
 */

import type { TavernRoleConfig } from "./tavernRoleTypes";

/** v2-C：首轮中间角色（教研模板）最低展开度 */
export const TAVERN_V2C_PM_MIN_SENTENCES = 4;
export const TAVERN_V2C_PM_MIN_CHARS = 180;

/** v2-C：第 2–4 轮中间角色（跟进对照模板）最低展开度 */
export const TAVERN_V2C_QA_MIN_SENTENCES = 5;
export const TAVERN_V2C_QA_MIN_CHARS = 220;

export const TAVERN_ROLES: TavernRoleConfig[] = [
  {
    id: "teaching_research",
    speaker: "教研与课标",
    shortLabel: "教研",
    avatarClass: "bg-[#396cd8]",
    turnUserPrompt: `请「教研与课标」视角发言。输出须含以下三段，每段使用 Markdown 三级标题（勿合并为一段）：
### 教学目标与范围
从课程标准/核心素养、学段特点或产品宣称的学习目标出发，概括你关注的重点、缺口或与课标、校本方案的衔接问题。
### 课标与正文依据
结合【需求文档】【测试文档】正文（可能已截断）说明判断依据，可点到知识点、单元结构或认知梯度。
### 教研侧建议与风险
给出可跟进的课程与教学内容侧建议及教研风险（可含优先级提示）。

**展开度**：全文至少 ${TAVERN_V2C_PM_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_PM_MIN_CHARS} 字；禁止仅用一句话、或仅列提纲式短语而无展开说明。`,
    jsonOutput: false,
  },
  {
    id: "product_manager",
    speaker: "产品经理（教育产品）",
    shortLabel: "产品",
    avatarClass: "bg-emerald-600 dark:bg-emerald-700",
    turnUserPrompt: `请「产品经理（教育产品）」视角发言。你必须**对照**上方【前序角色发言】（含教研与课标），并分节输出（使用 Markdown 二级标题，**三节缺一不可**）：
## 与教研一致点
列出你在目标、范围或风险上与教研判断的共识（每条用完整句子）。
## 分歧或待核实点（路线/资源/排期）
列出与教研或业务不一致处，或需立项、排期、资源拍板的疑点（说明因由）。
## 补充点（需求优先级与版本策略）
从需求池、里程碑、合规与商业化约束、与课标/政策窗口的匹配等角度提出补充（可与上两节交叉引用）。

**展开度**：全文至少 ${TAVERN_V2C_QA_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_QA_MIN_CHARS} 字；每节须有可独立阅读的段落正文，禁止仅列关键词。`,
    jsonOutput: false,
  },
  {
    id: "parent_school",
    speaker: "家长与家校协同",
    shortLabel: "家长",
    avatarClass: "bg-amber-600 dark:bg-amber-700",
    turnUserPrompt: `请「家长与家校协同」视角发言。你必须**对照**上方【前序角色发言】中教研、产品等前序结论，并分节输出（使用 Markdown 二级标题，**三节缺一不可**）：
## 与前序一致点
列出你在家校目标、沟通机制或风险判断上与前序角色的共识（每条用完整句子）。
## 分歧或待核实点
列出与家长知情权、参与方式或学校治理不一致的疑点（说明因由）。
## 补充点（家校沟通与合规）
从通知触达、家长会/家访、收费与退费说明、未成年人与个人信息保护、家长端体验等角度提出补充（可与上两节交叉引用）。

**展开度**：全文至少 ${TAVERN_V2C_QA_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_QA_MIN_CHARS} 字；每节须有可独立阅读的段落正文，禁止仅列关键词。`,
    jsonOutput: false,
  },
  {
    id: "student_delivery",
    speaker: "学生与教学落地",
    shortLabel: "学生",
    avatarClass: "bg-rose-600 dark:bg-rose-700",
    turnUserPrompt: `请「学生与教学落地」视角发言。你必须**对照**上方【前序角色发言】中教研、产品、家长等前序结论，并分节输出（使用 Markdown 二级标题，**三节缺一不可**）：
## 与前序一致点
列出你在学习者体验、课堂落地或评价方式上与前序角色的共识（每条用完整句子）。
## 分歧或待核实点
列出与学生端流程、学业评价口径或课堂实施不一致的疑点（说明因由）。
## 补充点（学习者体验与学业评价）
从学生/学习者动线、课堂与作业、测验与量规、可测性与数据口径、无障碍与公平等角度提出补充（可与上两节交叉引用）。

**展开度**：全文至少 ${TAVERN_V2C_QA_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_QA_MIN_CHARS} 字；每节须有可独立阅读的段落正文，禁止仅列关键词。`,
    jsonOutput: false,
  },
  {
    id: "host",
    speaker: "综合主持",
    shortLabel: "汇总",
    avatarClass: "bg-violet-600 dark:bg-violet-700",
    turnUserPrompt: `请「综合主持」做最终裁定：综合【需求文档】【测试文档】正文（可能已截断）、以及「前序角色发言」中**各中间角色**关于教研、产品、家长与学生/教学落地的结构化发言（共识、分歧与补充），使 score 与 suggestions 能反映上述结论，并体现教育场景下对师生家长与产品方可执行性。
只输出一个 JSON 对象，不要其它文字与 Markdown 代码围栏。JSON 必须符合：
{"score": number, "suggestions": string[]}
其中 score 为 0–100 的整数，suggestions 为至少一条可执行建议。`,
    jsonOutput: true,
  },
];

/** 默认酒馆中间角色（教研 + 产品 + 家长 + 学生/落地），不含主持 */
export function getDefaultTavernMiddleRoles(): TavernRoleConfig[] {
  return TAVERN_ROLES.filter((r) => !r.jsonOutput);
}

/** 末轮综合主持（JSON），与动态中间角色拼接时使用 */
export function getTavernHostRole(): TavernRoleConfig {
  const host = TAVERN_ROLES.find((r) => r.jsonOutput);
  if (!host) {
    throw new Error("酒馆配置缺少主持角色。");
  }
  return host;
}

/** 中间角色列表 + 主持，组成完整串行链 */
export function buildTavernRoleChain(
  middleRoles: TavernRoleConfig[],
): TavernRoleConfig[] {
  const host = getTavernHostRole();
  return [...middleRoles, host];
}
