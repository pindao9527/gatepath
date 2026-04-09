/**
 * OpenAI 兼容 /chat/completions 的 SSE 流式增量解析。
 */

import { humanizeApiErrorMessage, normalizeBaseUrl } from "./reviewHttpUtils";

export interface StreamChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  temperature?: number;
  /** 为 true 时传 response_format: json_object（最后一轮汇总用） */
  useJsonObjectFormat?: boolean;
}

/**
 * 逐段产出 assistant 的文本增量（delta content）。
 */
export async function* streamChatCompletionsDeltas(
  req: StreamChatRequest,
): AsyncGenerator<string, void, undefined> {
  const url = `${normalizeBaseUrl(req.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    temperature: req.temperature ?? 0.3,
  };
  if (req.useJsonObjectFormat === true) {
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

  if (!res.ok) {
    let raw = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    try {
      const data = (await res.json()) as {
        error?: { message?: string };
      };
      raw = data.error?.message ?? raw;
    } catch {
      try {
        raw = (await res.text()).trim() || raw;
      } catch {
        /* keep raw */
      }
    }
    throw new Error(humanizeApiErrorMessage(raw));
  }

  const reader = res.body?.getReader();
  if (reader == null) {
    throw new Error("响应无法以流方式读取。");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trimEnd();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trimStart();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload) as {
            choices?: {
              delta?: { content?: string | null };
            }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield delta;
          }
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0 && tail.startsWith("data:")) {
      const payload = tail.slice(5).trimStart();
      if (payload !== "[DONE]") {
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield delta;
          }
        } catch {
          /* 忽略尾包解析失败 */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
