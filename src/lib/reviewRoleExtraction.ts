/**
 * v2-E：模型推断建议中间角色（不含主持）。
 */

import { fetchChatCompletions } from "./reviewChatClient";
import { extractJsonFromAssistantText } from "./reviewResultParse";
import { TAVERN_V2E_MAX_MIDDLE_ROLES } from "./tavernDynamicRoles";
import type { ModelExtractedRole } from "./tavernDynamicRoles";

const ROLE_EXTRACT_DOC_MAX_CHARS = 12_000;

const ROLE_EXTRACT_SYSTEM = `你是**教育行业**评审流程设计师。根据用户给出的「需求/测试」摘要，建议若干**中间**评审角色（如教研、课堂落地、学业评价、校长治理、信息化合规等；不要包含最终汇总主持的职位；主持由系统固定追加）。
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
