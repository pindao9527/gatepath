/**
 * v2-E：动态角色 — 规则关键词推断、轮次/角色上限与提示合并（与 prepareTextsForModel 协同由调用方注入截断后正文）。
 */

import type { TavernRoleConfig } from "./tavernRoleTypes";

/** 与 reviewApi 中 TAVERN_V2C_* 保持同步（首轮 / 跟进轮的最低展开度） */
const V2C_PM_MIN_SENTENCES = 4;
const V2C_PM_MIN_CHARS = 180;
const V2C_QA_MIN_SENTENCES = 5;
const V2C_QA_MIN_CHARS = 220;

/** 中间发言轮（不含末轮「综合主持」JSON）上限 */
export const TAVERN_V2E_MAX_MIDDLE_ROLES = 10;

/** 含主持在内的总请求轮次上限（中间 + 1） */
export const TAVERN_V2E_MAX_TOTAL_ROUNDS = TAVERN_V2E_MAX_MIDDLE_ROLES + 1;

const AVATAR_CYCLE = [
  "bg-[#396cd8]",
  "bg-emerald-600 dark:bg-emerald-700",
  "bg-amber-600 dark:bg-amber-700",
  "bg-rose-600 dark:bg-rose-700",
  "bg-cyan-600 dark:bg-cyan-700",
  "bg-fuchsia-600 dark:bg-fuchsia-700",
  "bg-lime-700 dark:bg-lime-800",
  "bg-orange-600 dark:bg-orange-700",
  "bg-sky-600 dark:bg-sky-700",
  "bg-teal-600 dark:bg-teal-700",
] as const;

export interface RuleHit {
  id: string;
  speaker: string;
  shortLabel: string;
}

interface KeywordRule {
  id: string;
  speaker: string;
  shortLabel: string;
  /** 任一匹配即命中 */
  patterns: RegExp[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    id: "edu_principal",
    speaker: "校长视角",
    shortLabel: "校长",
    patterns: [/校长/i, /教育局/i, /校园/i, /家校/i],
  },
  {
    id: "legal",
    speaker: "法务合规",
    shortLabel: "法务",
    patterns: [/合规/i, /法务/i, /合同/i, /隐私/i, /GDPR/i, /个人信息/i],
  },
  {
    id: "security",
    speaker: "安全评审",
    shortLabel: "安全",
    patterns: [/安全/i, /渗透/i, /漏洞/i, /等保/i, /鉴权/i],
  },
  {
    id: "performance",
    speaker: "性能与容量",
    shortLabel: "性能",
    patterns: [/性能/i, /压测/i, /SLA/i, /并发/i, /容量/i],
  },
  {
    id: "finance",
    speaker: "财务结算",
    shortLabel: "财务",
    patterns: [/财务/i, /结算/i, /对账/i, /发票/i, /计费/i],
  },
  {
    id: "ops",
    speaker: "运维发布",
    shortLabel: "运维",
    patterns: [/运维/i, /发布/i, /回滚/i, /灰度/i, /监控/i, /告警/i],
  },
  {
    id: "ux_a11y",
    speaker: "体验与无障碍",
    shortLabel: "体验",
    patterns: [/无障碍/i, /a11y/i, /可用性/i, /易用/i],
  },
];

function pickAvatarClass(index: number): string {
  return AVATAR_CYCLE[index % AVATAR_CYCLE.length]!;
}

/** 首轮中间角色：现象 / 依据 / 建议（与 v2-C 产品轮同构，身份可替换） */
export function buildFirstMiddleTurnPrompt(options: {
  speaker: string;
  turnPromptHint?: string | null;
}): string {
  const hintBlock =
    options.turnPromptHint && options.turnPromptHint.trim().length > 0
      ? `\n\n【本视角关注点】${options.turnPromptHint.trim()}`
      : "";
  return `请「${options.speaker}」发言。输出须含以下三段，每段使用 Markdown 三级标题（勿合并为一段）：
### 现象
从业务目标与用户场景出发，概括你关注到的重点、缺口或异常。
### 依据
结合【需求文档】【测试文档】正文（可能已截断）说明判断依据，可点到具体表述或范围。
### 建议与风险
给出可跟进的需求侧建议与主要风险（可含优先级提示）。

**展开度**：全文至少 ${V2C_PM_MIN_SENTENCES} 句完整中文，且总字数不少于 ${V2C_PM_MIN_CHARS} 字；禁止仅用一句话、或仅列提纲式短语而无展开说明。${hintBlock}`;
}

/** 非首轮中间角色：对照前序（与 v2-C 测试轮同构） */
export function buildFollowMiddleTurnPrompt(options: {
  speaker: string;
  turnPromptHint?: string | null;
}): string {
  const hintBlock =
    options.turnPromptHint && options.turnPromptHint.trim().length > 0
      ? `\n\n【本视角关注点】${options.turnPromptHint.trim()}`
      : "";
  return `请「${options.speaker}」发言。你必须**对照**上方【前序角色发言】中其它角色的结论，并分节输出（使用 Markdown 二级标题，**三节缺一不可**）：
## 与前序一致点
列出你与前序各角色在范围、优先级或风险判断上的共识（每条用完整句子）。
## 分歧或待核实点
列出意见不一致、或需与产研/业务对齐的疑点（说明分歧因由）。
## 补充点（本视角）
从本角色专业视角提出覆盖度、可测性、遗漏与实施风险等补充（可与上两节交叉引用）。

**展开度**：全文至少 ${V2C_QA_MIN_SENTENCES} 句完整中文，且总字数不少于 ${V2C_QA_MIN_CHARS} 字；每节须有可独立阅读的段落正文，禁止仅列关键词。${hintBlock}`;
}

export function ruleHitToMiddleConfig(
  hit: RuleHit,
  indexInMiddle: number,
  turnPromptHint?: string | null,
): TavernRoleConfig {
  const turnUserPrompt =
    indexInMiddle === 0
      ? buildFirstMiddleTurnPrompt({
          speaker: hit.speaker,
          turnPromptHint,
        })
      : buildFollowMiddleTurnPrompt({
          speaker: hit.speaker,
          turnPromptHint,
        });
  return {
    id: hit.id,
    speaker: hit.speaker,
    shortLabel: hit.shortLabel,
    avatarClass: pickAvatarClass(indexInMiddle),
    turnUserPrompt,
    jsonOutput: false,
  };
}

/**
 * 从正文扫描关键词，返回去重后的规则命中（顺序为规则表顺序 + 首次匹配先后）。
 */
export function inferRuleHitsFromText(
  requirement: string | null,
  test: string | null,
  useTestDocument: boolean,
): RuleHit[] {
  const parts: string[] = [];
  if (requirement && requirement.length > 0) parts.push(requirement);
  if (useTestDocument && test && test.length > 0) parts.push(test);
  const blob = parts.join("\n");
  if (blob.length === 0) return [];

  const seen = new Set<string>();
  const out: RuleHit[] = [];
  for (const rule of KEYWORD_RULES) {
    if (seen.has(rule.id)) continue;
    const ok = rule.patterns.some((re) => re.test(blob));
    if (ok) {
      seen.add(rule.id);
      out.push({
        id: rule.id,
        speaker: rule.speaker,
        shortLabel: rule.shortLabel,
      });
    }
  }
  return out;
}

export interface ModelExtractedRole {
  id: string;
  speaker: string;
  shortLabel: string;
  /** 可选，并入 turn user */
  turnPromptHint?: string;
}

/**
 * 将规则与模型建议合并为中间角色配置列表（不含主持），并应用上限与去重。
 */
export function mergeMiddleRolesFromSources(options: {
  /** 规则命中（已去重 id） */
  ruleHits: RuleHit[];
  /** 模型抽取（可为空） */
  modelRoles: ModelExtractedRole[] | null;
  /** 当规则与模型均为空时，使用这一对默认中间角色（通常为产品+测试） */
  fallbackMiddle: TavernRoleConfig[];
}): TavernRoleConfig[] {
  const { ruleHits, modelRoles, fallbackMiddle } = options;
  const byId = new Map<string, TavernRoleConfig>();

  for (const hit of ruleHits) {
    if (byId.size >= TAVERN_V2E_MAX_MIDDLE_ROLES) break;
    if (byId.has(hit.id)) continue;
    const indexInMiddle = byId.size;
    const cfg = ruleHitToMiddleConfig(hit, indexInMiddle, null);
    byId.set(hit.id, cfg);
  }

  if (modelRoles) {
    for (const mr of modelRoles) {
      if (byId.size >= TAVERN_V2E_MAX_MIDDLE_ROLES) break;
      const id =
        mr.id && mr.id.trim().length > 0
          ? `model-${mr.id.trim().slice(0, 64)}`
          : `model-${byId.size}`;
      if (byId.has(id)) continue;
      const indexInMiddle = byId.size;
      const speaker =
        mr.speaker.trim().length > 0 ? mr.speaker.trim() : "特邀视角";
      const shortLabel =
        mr.shortLabel.trim().length > 0
          ? mr.shortLabel.trim().slice(0, 8)
          : speaker.slice(0, 2);
      const hint = mr.turnPromptHint?.trim() ?? null;
      const cfg: TavernRoleConfig = {
        id,
        speaker,
        shortLabel,
        avatarClass: pickAvatarClass(indexInMiddle),
        turnUserPrompt:
          indexInMiddle === 0
            ? buildFirstMiddleTurnPrompt({ speaker, turnPromptHint: hint })
            : buildFollowMiddleTurnPrompt({ speaker, turnPromptHint: hint }),
        jsonOutput: false,
      };
      byId.set(id, cfg);
    }
  }

  if (byId.size === 0) {
    return fallbackMiddle.slice(0, TAVERN_V2E_MAX_MIDDLE_ROLES);
  }

  return Array.from(byId.values());
}

/**
 * 用户编辑列表后，按顺序重建 turnUserPrompt（保证首轮/跟进模板与索引一致）。
 */
export function rebuildMiddleRolesPrompts(
  roles: TavernRoleConfig[],
): TavernRoleConfig[] {
  return roles.map((r, i) => {
    if (r.jsonOutput) return r;
    const hint = extractHintFromTurnPrompt(r.turnUserPrompt);
    return {
      ...r,
      avatarClass: pickAvatarClass(i),
      turnUserPrompt:
        i === 0
          ? buildFirstMiddleTurnPrompt({
              speaker: r.speaker,
              turnPromptHint: hint,
            })
          : buildFollowMiddleTurnPrompt({
              speaker: r.speaker,
              turnPromptHint: hint,
            }),
    };
  });
}

const HINT_RE = /【本视角关注点】([\s\S]*)$/;

function extractHintFromTurnPrompt(turnUserPrompt: string): string | null {
  const m = turnUserPrompt.match(HINT_RE);
  if (!m?.[1]) return null;
  const t = m[1].trim();
  return t.length > 0 ? t : null;
}

export function validateMiddleRoleCount(middleCount: number): {
  ok: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (middleCount > TAVERN_V2E_MAX_MIDDLE_ROLES) {
    warnings.push(
      `中间发言角色数为 ${middleCount}，已超过上限 ${TAVERN_V2E_MAX_MIDDLE_ROLES}（含主持共 ${TAVERN_V2E_MAX_TOTAL_ROUNDS} 轮）。请删减后再开始评审。`,
    );
    return { ok: false, warnings };
  }
  return { ok: true, warnings };
}
