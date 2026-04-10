/**
 * 快速评审 JSON 与助手全文解析。
 */

export interface ReviewResult {
  /** 0–100 */
  score: number;
  /** 可执行的修改建议（多条） */
  suggestions: string[];
}

export function extractJsonFromAssistantText(text: string): string {
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
