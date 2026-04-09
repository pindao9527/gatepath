/**
 * OpenAI 兼容 Chat Completions：组装评审 prompt，解析 JSON 结果；酒馆多轮流式评审。
 */

import { prepareTextsForModel } from "./reviewContentBudget";
import { humanizeApiErrorMessage, normalizeBaseUrl } from "./reviewHttpUtils";
import { streamChatCompletionsDeltas } from "./reviewStream";

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

/** 评审完成：结构化分数 + 送交模型前的截断说明 */
export interface DocumentReviewOutcome {
  result: ReviewResult;
  /** 因长度预算截断正文时产生的提示（可为空数组） */
  truncationWarnings: string[];
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

  const data = (await res.json()) as ChatCompletionsResponse;

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

/** 酒馆模式：单轮角色配置（串行多轮对话 + 末轮 JSON） */
export interface TavernRoleConfig {
  id: string;
  speaker: string;
  shortLabel: string;
  /** 头像圆底色（UnoCSS 类名） */
  avatarClass: string;
  /** 该轮开始前追加的 user 提示 */
  turnUserPrompt: string;
  /** 为 true 时使用 json_object 流式输出并解析为 ReviewResult */
  jsonOutput: boolean;
}

const TAVERN_SYSTEM_PROMPT = `你正在参与「需求与测试文档」多角色评审酒馆。
规则：按用户提示依次以指定身份发言；前几轮使用简洁中文，可用 Markdown 列表；除「综合主持」最后一轮外，不要输出 JSON。
全文仅基于用户给出的需求与测试正文（可能已截断）。`;

export const TAVERN_ROLES: TavernRoleConfig[] = [
  {
    id: "pm",
    speaker: "产品经理",
    shortLabel: "产品",
    avatarClass: "bg-[#396cd8]",
    turnUserPrompt:
      "请「产品经理」发言：从业务目标、需求完整性与需求侧风险做简评（纯文本，2–5 条要点即可）。",
    jsonOutput: false,
  },
  {
    id: "qa",
    speaker: "测试负责人",
    shortLabel: "测试",
    avatarClass: "bg-emerald-600 dark:bg-emerald-700",
    turnUserPrompt:
      "请「测试负责人」发言：从覆盖度、可测性、遗漏与测试设计做简评（纯文本，2–5 条要点即可）。",
    jsonOutput: false,
  },
  {
    id: "host",
    speaker: "综合主持",
    shortLabel: "汇总",
    avatarClass: "bg-violet-600 dark:bg-violet-700",
    turnUserPrompt: `请「综合主持」做最终裁定：只输出一个 JSON 对象，不要其它文字与 Markdown 代码围栏。JSON 必须符合：
{"score": number, "suggestions": string[]}
其中 score 为 0–100 的整数，suggestions 为至少一条可执行建议。`,
    jsonOutput: true,
  },
];

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
}): Promise<DocumentReviewOutcome> {
  const prepared = prepareTextsForModel(
    options.requirementText,
    options.testText,
  );

  const docUserContent = buildUserContent(
    prepared.requirementText,
    prepared.testText,
  );

  const messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[] = [{ role: "system", content: TAVERN_SYSTEM_PROMPT }];

  messages.push({ role: "user", content: docUserContent });

  const note = options.userNote?.trim();
  if (note) {
    messages.push({
      role: "user",
      content: `【参与者补充说明】\n${note}`,
    });
  }

  const { callbacks, signal } = options;
  let lastJsonText = "";

  for (let i = 0; i < TAVERN_ROLES.length; i++) {
    const role = TAVERN_ROLES[i]!;
    messages.push({ role: "user", content: role.turnUserPrompt });
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
    messages.push({ role: "assistant", content: full });

    const hasNextRound = i < TAVERN_ROLES.length - 1;
    if (hasNextRound && callbacks.promptUserInterjection) {
      const nextRole = TAVERN_ROLES[i + 1]!;
      const inserted = await callbacks.promptUserInterjection({
        completedRole: role,
        nextRole,
      });
      const line = inserted?.trim();
      if (line) {
        messages.push({
          role: "user",
          content: `【参与者插话】\n${line}`,
        });
      }
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
      return {
        result,
        truncationWarnings: prepared.warnings,
      };
    }
  }

  throw new Error("酒馆流程未产生综合主持的 JSON 结果。");
}
