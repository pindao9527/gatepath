/**
 * OpenAI 兼容 /chat/completions 非流式请求（供快速评审、角色抽取等复用）。
 */

import {
  humanizeApiErrorMessage,
  normalizeBaseUrl,
  parseJsonResponseHumanized,
} from "./reviewHttpUtils";

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
