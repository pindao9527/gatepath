/**
 * OpenAI 兼容 Chat Completions：组装评审 prompt，解析 JSON 结果；酒馆多轮流式评审。
 */

import { prepareTextsForModel } from "./reviewContentBudget";
import {
  humanizeApiErrorMessage,
  normalizeBaseUrl,
  parseJsonResponseHumanized,
} from "./reviewHttpUtils";
import { streamChatCompletionsDeltas } from "./reviewStream";
import type { ModelExtractedRole } from "./tavernDynamicRoles";
import { TAVERN_V2E_MAX_MIDDLE_ROLES } from "./tavernDynamicRoles";
import type { TavernRoleConfig } from "./tavernRoleTypes";

export type { TavernRoleConfig } from "./tavernRoleTypes";

export interface ReviewResult {
  /** 0–100 */
  score: number;
  /** 可执行的修改建议（多条） */
  suggestions: string[];
}

const SYSTEM_PROMPT = `你是资深需求与测试评审专家。用户将提供「需求文档」与「测试文档」的纯文本（可能仅其一有内容）。
请综合评审：覆盖度、一致性、可测性、风险与遗漏，并给出可执行的修改建议。

你必须只输出一个 JSON 对象，不要 Markdown 代码围栏，不要其它说明文字。JSON 必须符合以下 TypeScript 接口：
{
  "score": number,  // 0 到 100 的整数，表示整体评审得分
  "suggestions": string[]  // 至少一条字符串建议，简明可执行
}`;

function buildUserContent(
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

export function buildReviewMessages(
  requirement: string | null,
  test: string | null,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserContent(requirement, test) },
  ];
}

function extractJsonFromAssistantText(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m;
  const m = trimmed.match(fence);
  if (m) return m[1].trim();
  return trimmed;
}

export function parseReviewResultJson(raw: string): ReviewResult {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型返回的 JSON 不是对象。");
  }
  const obj = parsed as Record<string, unknown>;
  const scoreRaw = obj.score;
  const suggestionsRaw = obj.suggestions;

  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
      ? Math.round(scoreRaw)
      : typeof scoreRaw === "string" && scoreRaw.trim() !== ""
        ? Math.round(Number(scoreRaw))
        : NaN;

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("score 必须是 0–100 之间的数。");
  }

  if (!Array.isArray(suggestionsRaw)) {
    throw new Error("suggestions 必须是字符串数组。");
  }
  const suggestions = suggestionsRaw.map((s, i) => {
    if (typeof s !== "string" || !s.trim()) {
      throw new Error(`suggestions[${i}] 必须是非空字符串。`);
    }
    return s.trim();
  });

  if (suggestions.length === 0) {
    throw new Error("suggestions 至少包含一条建议。");
  }

  return { score, suggestions };
}

/** 从助手全文解析评审结果（含 ```json 围栏剥离） */
export function parseReviewResultFromAssistantText(text: string): ReviewResult {
  return parseReviewResultJson(extractJsonFromAssistantText(text));
}

/** 酒馆 v2-B：写入后序轮次的单条前序发言（已按传递规则截断） */
export interface TavernPriorAssistantOutput {
  roleId: string;
  speaker: string;
  text: string;
}

/** 酒馆 v2-B：某一角色轮次请求前的「轮次间传递」快照（可 JSON 序列化便于调试） */
export interface TavernRoundTransferEntry {
  roleId: string;
  /** 本轮请求中作为「前序」带入的助手输出 */
  priorAssistantOutputs: TavernPriorAssistantOutput[];
  /** 本轮请求前插入的参与者插话（若有） */
  interjectionBeforeRound: string | null;
}

export interface TavernTransferInfo {
  rounds: TavernRoundTransferEntry[];
}

/** 评审完成：结构化分数 + 送交模型前的截断说明 */
export interface DocumentReviewOutcome {
  result: ReviewResult;
  /** 因长度预算截断正文时产生的提示（可为空数组） */
  truncationWarnings: string[];
  /** 酒馆模式 v2-B：各轮独立会话时的轮次间传递记录（仅酒馆流程填充） */
  tavernTransfer?: TavernTransferInfo;
}

/** 单条前序助手发言写入后序轮次时的长度上限（避免前序过长挤占正文预算） */
export const TAVERN_PRIOR_ASSISTANT_MAX_CHARS = 32_000;

/**
 * 将前序某轮的助手全文截断为可带入后序请求的引用文本。
 */
export function truncatePriorAssistantTextForTransfer(text: string): string {
  const max = TAVERN_PRIOR_ASSISTANT_MAX_CHARS;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（前序发言过长已截断供后续轮次引用，原约 ${text.length.toLocaleString()} 字）`;
}

function formatPriorRoundsUserContent(
  priors: TavernPriorAssistantOutput[],
): string {
  const header =
    "【前序角色发言（本轮为独立对话线程；以下为前几轮全文供对照，已按需截断）】";
  const blocks = priors.map(
    (p) => `### ${p.speaker}\n${p.text}`,
  );
  return [header, ...blocks].join("\n\n");
}

function buildTavernRoundMessages(options: {
  docUserContent: string;
  userNote: string | null;
  priorOutputs: TavernPriorAssistantOutput[];
  interjectionBeforeRound: string | null;
  turnUserPrompt: string;
}): { role: "system" | "user" | "assistant"; content: string }[] {
  const { docUserContent, userNote, priorOutputs, interjectionBeforeRound, turnUserPrompt } =
    options;
  const messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[] = [{ role: "system", content: TAVERN_SYSTEM_PROMPT }];

  messages.push({ role: "user", content: docUserContent });
  if (userNote) {
    messages.push({
      role: "user",
      content: `【参与者补充说明】\n${userNote}`,
    });
  }
  if (priorOutputs.length > 0) {
    messages.push({
      role: "user",
      content: formatPriorRoundsUserContent(priorOutputs),
    });
  }
  if (interjectionBeforeRound) {
    messages.push({
      role: "user",
      content: `【参与者插话】\n${interjectionBeforeRound}`,
    });
  }
  messages.push({ role: "user", content: turnUserPrompt });
  return messages;
}

export interface ChatCompletionsRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  /** 为 false 时不传 response_format（兼容不支持 JSON 模式的接口） */
  useJsonObjectFormat?: boolean;
}

export interface ChatCompletionsResponse {
  choices?: {
    message?: { content?: string | null; role?: string };
    finish_reason?: string;
  }[];
  error?: { message?: string; type?: string; code?: string };
}

/**
 * POST {baseUrl}/chat/completions（baseUrl 通常以 /v1 结尾）
 */
export async function fetchChatCompletions(
  req: ChatCompletionsRequest,
): Promise<string> {
  const url = `${normalizeBaseUrl(req.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: 0.3,
  };
  if (req.useJsonObjectFormat !== false) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  const rawBody = await res.text();
  const data = parseJsonResponseHumanized<ChatCompletionsResponse>(
    rawBody,
    res.status,
  );

  if (!res.ok) {
    const raw =
      data.error?.message ??
      `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    throw new Error(humanizeApiErrorMessage(raw));
  }

  const content = data.choices?.[0]?.message?.content;
  if (content == null || typeof content !== "string") {
    throw new Error("响应中缺少 assistant 文本内容。");
  }
  return content;
}

/**
 * 运行评审：请求模型并解析为 ReviewResult；若 JSON 模式不可用会自动重试一次。
 * 送交前会按 {@link prepareTextsForModel} 做合并长度截断，并在 outcome 中返回说明。
 */
export async function runDocumentReview(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  requirementText: string | null;
  testText: string | null;
  signal?: AbortSignal;
}): Promise<DocumentReviewOutcome> {
  const prepared = prepareTextsForModel(
    options.requirementText,
    options.testText,
  );

  const messages = buildReviewMessages(
    prepared.requirementText,
    prepared.testText,
  );

  let text: string;
  try {
    text = await fetchChatCompletions({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      signal: options.signal,
      useJsonObjectFormat: true,
    });
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    const retryWithoutJson = /response_format|json_object|json mode/i.test(
      msg,
    );
    if (!retryWithoutJson) {
      const wrapped =
        first instanceof Error
          ? first
          : new Error(humanizeApiErrorMessage(String(first)));
      throw wrapped;
    }
    text = await fetchChatCompletions({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      signal: options.signal,
      useJsonObjectFormat: false,
    });
  }

  const jsonStr = extractJsonFromAssistantText(text);

  let result: ReviewResult;
  try {
    result = parseReviewResultJson(jsonStr);
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `模型返回的 JSON 不符合约定：${e.message}`
        : "模型返回的 JSON 不符合约定。",
    );
  }

  return {
    result,
    truncationWarnings: prepared.warnings,
  };
}

const TAVERN_SYSTEM_PROMPT = `你正在参与「需求与测试文档」多角色评审酒馆。
每一轮请求都是**独立对话线程**（无多轮 assistant 记忆）；请仅依据当条用户消息里的「需求/测试正文」「前序角色发言」等区块作答，避免与未给出的上文串戏。
按用户提示以指定身份发言。非「综合主持」轮须**分节输出**（用户消息会给出小节标题与最低句数/字数）；用完整中文句子展开，避免一句话敷衍或仅列无说明的关键词。
除「综合主持」最后一轮外，不要输出 JSON。若出现「前序角色发言」区块，须结合其中结论对照评审。全文仅基于用户给出的需求与测试正文（可能已截断）及前序区块中的引用。`;

/** v2-C：首轮（产品）最低展开度，与 TAVERN_ROLES[pm] 文案一致 */
export const TAVERN_V2C_PM_MIN_SENTENCES = 4;
export const TAVERN_V2C_PM_MIN_CHARS = 180;

/** v2-C：测试轮最低展开度，与 TAVERN_ROLES[qa] 文案一致 */
export const TAVERN_V2C_QA_MIN_SENTENCES = 5;
export const TAVERN_V2C_QA_MIN_CHARS = 220;

export const TAVERN_ROLES: TavernRoleConfig[] = [
  {
    id: "pm",
    speaker: "产品经理",
    shortLabel: "产品",
    avatarClass: "bg-[#396cd8]",
    turnUserPrompt: `请「产品经理」发言。输出须含以下三段，每段使用 Markdown 三级标题（勿合并为一段）：
### 现象
从业务目标与用户场景出发，概括你关注到的重点、缺口或异常。
### 依据
结合【需求文档】【测试文档】正文（可能已截断）说明判断依据，可点到具体表述或范围。
### 建议与风险
给出可跟进的需求侧建议与主要风险（可含优先级提示）。

**展开度**：全文至少 ${TAVERN_V2C_PM_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_PM_MIN_CHARS} 字；禁止仅用一句话、或仅列提纲式短语而无展开说明。`,
    jsonOutput: false,
  },
  {
    id: "qa",
    speaker: "测试负责人",
    shortLabel: "测试",
    avatarClass: "bg-emerald-600 dark:bg-emerald-700",
    turnUserPrompt: `请「测试负责人」发言。你必须**对照**上方【前序角色发言】中「产品经理」的结论，并分节输出（使用 Markdown 二级标题，**三节缺一不可**）：
## 与前序一致点
列出你与产品经理在范围、优先级或风险判断上的共识（每条用完整句子）。
## 分歧或待核实点
列出意见不一致、或需与产研/业务对齐的疑点（说明分歧因由）。
## 补充点（测试视角）
从覆盖度、可测性、遗漏与测试设计提出补充（可与上两节交叉引用）。

**展开度**：全文至少 ${TAVERN_V2C_QA_MIN_SENTENCES} 句完整中文，且总字数不少于 ${TAVERN_V2C_QA_MIN_CHARS} 字；每节须有可独立阅读的段落正文，禁止仅列关键词。`,
    jsonOutput: false,
  },
  {
    id: "host",
    speaker: "综合主持",
    shortLabel: "汇总",
    avatarClass: "bg-violet-600 dark:bg-violet-700",
    turnUserPrompt: `请「综合主持」做最终裁定：综合【需求文档】【测试文档】正文（可能已截断）、以及「前序角色发言」中**各中间角色**的结构化发言（共识、分歧与补充），使 score 与 suggestions 能反映上述结论。
只输出一个 JSON 对象，不要其它文字与 Markdown 代码围栏。JSON 必须符合：
{"score": number, "suggestions": string[]}
其中 score 为 0–100 的整数，suggestions 为至少一条可执行建议。`,
    jsonOutput: true,
  },
];

/** 默认酒馆中间角色（产品 + 测试），不含主持 */
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

const ROLE_EXTRACT_DOC_MAX_CHARS = 12_000;

const ROLE_EXTRACT_SYSTEM = `你是评审流程设计师。根据用户给出的「需求/测试」摘要，建议若干**中间**评审角色（不要包含最终汇总主持的职位；主持由系统固定追加）。
只输出一个 JSON 对象，不要 Markdown 代码围栏与其它说明文字。
JSON 必须符合：{"roles":[{"id":"snake_case_id","speaker":"完整称呼","shortLabel":"2-8字简称","turnPromptHint":"该视角关注点，可为空字符串"}]}
约束：roles 数组长度 0 到 ${String(TAVERN_V2E_MAX_MIDDLE_ROLES)}；id 用英文小写与下划线、在数组内唯一；speaker、shortLabel 为非空字符串。`;

function buildRoleExtractionUserContent(
  requirement: string | null,
  test: string | null,
  useTestDocument: boolean,
): string {
  const req =
    requirement != null && requirement.length > 0
      ? requirement
      : "（未提供需求文档）";
  const tst =
    test != null && test.length > 0 ? test : "（未提供测试文档）";
  const parts = [`【需求文档节选】\n${req}`];
  if (useTestDocument) {
    parts.push(`【测试文档节选】\n${tst}`);
  } else {
    parts.push("（本次推断未附带测试文档正文；如需可仅依据需求侧理解角色。）");
  }
  const full = parts.join("\n\n");
  if (full.length <= ROLE_EXTRACT_DOC_MAX_CHARS) return full;
  return `${full.slice(0, ROLE_EXTRACT_DOC_MAX_CHARS)}\n…（节选已截断）`;
}

function parseModelExtractedRoles(raw: string): ModelExtractedRole[] {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 顶层不是对象。");
  }
  const rolesRaw = (parsed as Record<string, unknown>).roles;
  if (!Array.isArray(rolesRaw)) {
    throw new Error("缺少 roles 数组。");
  }
  const out: ModelExtractedRole[] = [];
  const seenId = new Set<string>();
  for (let i = 0; i < rolesRaw.length; i++) {
    const item = rolesRaw[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`roles[${i}] 不是对象。`);
    }
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const speaker = typeof o.speaker === "string" ? o.speaker.trim() : "";
    const shortLabel =
      typeof o.shortLabel === "string" ? o.shortLabel.trim() : "";
    const turnPromptHint =
      typeof o.turnPromptHint === "string" ? o.turnPromptHint.trim() : "";
    if (!id || !speaker || !shortLabel) {
      throw new Error(`roles[${i}] 的 id/speaker/shortLabel 须为非空字符串。`);
    }
    if (seenId.has(id)) {
      throw new Error(`重复的 id：${id}`);
    }
    seenId.add(id);
    out.push({
      id: id.slice(0, 64),
      speaker: speaker.slice(0, 64),
      shortLabel: shortLabel.slice(0, 12),
      turnPromptHint: turnPromptHint.length > 0 ? turnPromptHint.slice(0, 500) : undefined,
    });
    if (out.length >= TAVERN_V2E_MAX_MIDDLE_ROLES) break;
  }
  return out;
}

/**
 * v2-E：首轮模型抽取建议中间角色（不含主持）。失败时由调用方仅使用规则或默认列表。
 */
export async function extractTavernRolesWithModel(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  requirementText: string | null;
  testText: string | null;
  /** E5：是否把测试文档纳入推断（默认 false = 仅需求侧） */
  useTestDocumentForInference: boolean;
  signal?: AbortSignal;
}): Promise<ModelExtractedRole[]> {
  const userContent = buildRoleExtractionUserContent(
    options.requirementText,
    options.testText,
    options.useTestDocumentForInference,
  );
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: ROLE_EXTRACT_SYSTEM },
    { role: "user", content: userContent },
  ];
  let text: string;
  try {
    text = await fetchChatCompletions({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      signal: options.signal,
      useJsonObjectFormat: true,
    });
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    const retryWithoutJson = /response_format|json_object|json mode/i.test(
      msg,
    );
    if (!retryWithoutJson) throw first;
    text = await fetchChatCompletions({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      signal: options.signal,
      useJsonObjectFormat: false,
    });
  }
  const jsonStr = extractJsonFromAssistantText(text);
  return parseModelExtractedRoles(jsonStr);
}

/** 某一角色发言结束、下一角色尚未开始时，用于可选的中途插话 */
export interface BetweenRoundsContext {
  /** 刚结束发言的角色 */
  completedRole: TavernRoleConfig;
  /** 即将开始发言的角色 */
  nextRole: TavernRoleConfig;
}

export interface TavernReviewCallbacks {
  /** 新一轮助手回复开始（用于插入气泡与头像） */
  onRoundStart: (role: TavernRoleConfig) => void;
  /** 流式增量 */
  onDelta: (chunk: string) => void;
  /** 该轮结束；非 JSON 轮为全文，JSON 轮在解析前也会收到全文 */
  onRoundComplete: (role: TavernRoleConfig, fullText: string) => void;
  /**
   * 在非末轮助手输出完成后调用：若返回非空字符串，会作为一条 user 消息插入上下文，再进入下一轮。
   * 未提供则连续跑完所有轮（无中途暂停）。
   */
  promptUserInterjection?: (
    ctx: BetweenRoundsContext,
  ) => Promise<string | null>;
}

/**
 * 酒馆模式：多角色串行流式发言，末轮解析为 score + suggestions。
 * 若网关不支持流式 json_object，会自动重试末轮为非 JSON 模式再解析。
 */
export async function runTavernDocumentReview(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  requirementText: string | null;
  testText: string | null;
  /** 进入角色轮次前可选的补充说明 */
  userNote?: string | null;
  signal?: AbortSignal;
  callbacks: TavernReviewCallbacks;
  /**
   * v2-E：完整角色链（末轮须为 jsonOutput 主持）。不传则使用内置 {@link TAVERN_ROLES}。
   */
  tavernRoles?: TavernRoleConfig[] | undefined;
}): Promise<DocumentReviewOutcome> {
  const prepared = prepareTextsForModel(
    options.requirementText,
    options.testText,
  );

  const docUserContent = buildUserContent(
    prepared.requirementText,
    prepared.testText,
  );

  const note = options.userNote?.trim() ?? null;

  const { callbacks, signal } = options;
  const chain =
    options.tavernRoles != null && options.tavernRoles.length > 0
      ? options.tavernRoles
      : TAVERN_ROLES;
  const lastRole = chain[chain.length - 1];
  if (!lastRole?.jsonOutput) {
    throw new Error("酒馆角色链末轮须为综合主持（JSON 输出）。");
  }

  let lastJsonText = "";

  const priorOutputs: TavernPriorAssistantOutput[] = [];
  let interjectionBeforeThisRound: string | null = null;
  const transferRounds: TavernRoundTransferEntry[] = [];

  for (let i = 0; i < chain.length; i++) {
    const role = chain[i]!;

    transferRounds.push({
      roleId: role.id,
      priorAssistantOutputs: priorOutputs.map((p) => ({
        roleId: p.roleId,
        speaker: p.speaker,
        text: p.text,
      })),
      interjectionBeforeRound: interjectionBeforeThisRound,
    });

    const messages = buildTavernRoundMessages({
      docUserContent,
      userNote: note,
      priorOutputs,
      interjectionBeforeRound: interjectionBeforeThisRound,
      turnUserPrompt: role.turnUserPrompt,
    });

    interjectionBeforeThisRound = null;

    callbacks.onRoundStart(role);

    let full = "";
    const useJson = role.jsonOutput === true;

    const runStream = async (jsonFormat: boolean) => {
      full = "";
      for await (const delta of streamChatCompletionsDeltas({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        model: options.model,
        messages,
        signal,
        temperature: 0.3,
        useJsonObjectFormat: jsonFormat ? true : undefined,
      })) {
        full += delta;
        callbacks.onDelta(delta);
      }
    };

    try {
      if (useJson) {
        try {
          await runStream(true);
        } catch (first) {
          const msg = first instanceof Error ? first.message : String(first);
          const retryWithoutJson = /response_format|json_object|json mode/i.test(
            msg,
          );
          if (!retryWithoutJson) throw first;
          await runStream(false);
        }
        lastJsonText = full;
      } else {
        await runStream(false);
      }
    } catch (e) {
      throw e instanceof Error
        ? e
        : new Error(humanizeApiErrorMessage(String(e)));
    }

    callbacks.onRoundComplete(role, full);

    if (!useJson) {
      priorOutputs.push({
        roleId: role.id,
        speaker: role.speaker,
        text: truncatePriorAssistantTextForTransfer(full),
      });
    }

    const hasNextRound = i < chain.length - 1;
    if (hasNextRound && callbacks.promptUserInterjection) {
      const nextRole = chain[i + 1]!;
      const inserted = await callbacks.promptUserInterjection({
        completedRole: role,
        nextRole,
      });
      const line = inserted?.trim();
      interjectionBeforeThisRound = line && line.length > 0 ? line : null;
    }

    if (useJson) {
      let result: ReviewResult;
      try {
        result = parseReviewResultFromAssistantText(lastJsonText);
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? `模型返回的 JSON 不符合约定：${e.message}`
            : "模型返回的 JSON 不符合约定。",
        );
      }
      const chainNote =
        chain.length >= 7
          ? [
              `酒馆模式本轮共 ${chain.length} 次模型请求（含主持汇总），请关注耗时与费用。`,
            ]
          : [];
      return {
        result,
        truncationWarnings: [...prepared.warnings, ...chainNote],
        tavernTransfer: { rounds: transferRounds },
      };
    }
  }

  throw new Error("酒馆流程未产生综合主持的 JSON 结果。");
}
