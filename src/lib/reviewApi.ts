/**
 * 评审编排：快速单轮、酒馆串行轮次（轮次 handoff + 独立请求），HTTP 与解析见子模块。
 */

export type { TavernRoleConfig } from "./tavernRoleTypes";

export type { ReviewResult } from "./reviewResultParse";
export {
  extractJsonFromAssistantText,
  parseReviewResultFromAssistantText,
  parseReviewResultJson,
} from "./reviewResultParse";

export { buildReviewMessages } from "./reviewQuickPrompt";

export {
  buildTavernRoleChain,
  getDefaultTavernMiddleRoles,
  getTavernHostRole,
  TAVERN_ROLES,
  TAVERN_V2C_PM_MIN_CHARS,
  TAVERN_V2C_PM_MIN_SENTENCES,
  TAVERN_V2C_QA_MIN_CHARS,
  TAVERN_V2C_QA_MIN_SENTENCES,
} from "./tavernRoleCatalog";

export type {
  TavernPriorAssistantOutput,
  TavernRoundTransferEntry,
  TavernTransferInfo,
} from "./tavernPromptPipeline";
export {
  buildTavernRoundMessages,
  TAVERN_PRIOR_ASSISTANT_MAX_CHARS,
  TAVERN_SYSTEM_PROMPT,
  truncatePriorAssistantTextForTransfer,
} from "./tavernPromptPipeline";

export type { ChatCompletionsRequest, ChatCompletionsResponse } from "./reviewChatClient";
export { fetchChatCompletions } from "./reviewChatClient";

export { extractTavernRolesWithModel } from "./reviewRoleExtraction";

import { prepareTextsForModel } from "./reviewContentBudget";
import { fetchChatCompletions } from "./reviewChatClient";
import { buildRequirementTestUserContent } from "./reviewDocumentBlocks";
import { humanizeApiErrorMessage } from "./reviewHttpUtils";
import { buildReviewMessages } from "./reviewQuickPrompt";
import {
  extractJsonFromAssistantText,
  parseReviewResultFromAssistantText,
  parseReviewResultJson,
} from "./reviewResultParse";
import { streamChatCompletionsDeltas } from "./reviewStream";
import type { TavernRoleConfig } from "./tavernRoleTypes";
import { TAVERN_ROLES } from "./tavernRoleCatalog";
import {
  buildTavernRoundMessages,
  truncatePriorAssistantTextForTransfer,
  type TavernPriorAssistantOutput,
  type TavernRoundTransferEntry,
  type TavernTransferInfo,
} from "./tavernPromptPipeline";
import type { ReviewResult } from "./reviewResultParse";

/** 评审完成：结构化分数 + 送交模型前的截断说明 */
export interface DocumentReviewOutcome {
  result: ReviewResult;
  /** 因长度预算截断正文时产生的提示（可为空数组） */
  truncationWarnings: string[];
  /** 酒馆模式 v2-B：各轮独立会话时的轮次间传递记录（仅酒馆流程填充） */
  tavernTransfer?: TavernTransferInfo;
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

  const docUserContent = buildRequirementTestUserContent(
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
