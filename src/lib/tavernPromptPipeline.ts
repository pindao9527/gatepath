/**
 * 酒馆轮次：system 与各 user 块装配（独立线程 + handoff 语义）。
 */

/** 单条前序助手发言写入后序轮次时的长度上限（避免前序过长挤占正文预算） */
export const TAVERN_PRIOR_ASSISTANT_MAX_CHARS = 32_000;

/** 酒馆模式共用 system（每轮独立会话，无 assistant 记忆） */
export const TAVERN_SYSTEM_PROMPT = `你正在参与面向**教育行业**的「需求与测试文档」多角色评审酒馆（如课标、课堂、学业评价、家校与校园信息化等语境）。
每一轮请求都是**独立对话线程**（无多轮 assistant 记忆）；请仅依据当条用户消息里的「需求/测试正文」「前序角色发言」等区块作答，避免与未给出的上文串戏。
按用户提示以指定身份发言。非「综合主持」轮须**分节输出**（用户消息会给出小节标题与最低句数/字数）；用完整中文句子展开，避免一句话敷衍或仅列无说明的关键词。
除「综合主持」最后一轮外，不要输出 JSON。若出现「前序角色发言」区块，须结合其中结论对照评审。全文仅基于用户给出的需求与测试正文（可能已截断）及前序区块中的引用。`;

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

export function buildTavernRoundMessages(options: {
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
