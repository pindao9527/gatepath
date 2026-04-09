/**
 * OpenAI 兼容接口：Base URL 规范化与错误文案增强（供 reviewApi / reviewStream 共用）。
 */

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function humanizeApiErrorMessage(message: string): string {
  const m = message.trim();
  if (
    /context[_\s-]?length|maximum\s+context|token\s*limit|too\s+many\s+tokens|max[_\s-]?token|length\s+limit|context\s+window/i.test(
      m,
    )
  ) {
    return `模型或网关提示上下文/长度超限。可缩短文档、在预览页确认后再试，或换用更大上下文窗口的模型。详情：${m}`;
  }
  if (
    /\b413\b|payload\s+too\s+large|request\s+too\s+large|body\s+too\s+large/i.test(
      m,
    )
  ) {
    return `请求体过大被拒绝。请减小文档体积或检查网关限制。详情：${m}`;
  }
  if (
    /401|403|unauthorized|invalid\s+api\s*key|incorrect\s+api\s*key/i.test(m)
  ) {
    return `鉴权失败，请检查 Base URL、Model 与 API Key。详情：${m}`;
  }
  if (/429|rate\s*limit|too\s+many\s+requests/i.test(m)) {
    return `请求过于频繁或额度不足，请稍后重试。详情：${m}`;
  }
  return m;
}
