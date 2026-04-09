import JSZip from "jszip";
import mammoth from "mammoth";
import type { DownloadDocumentResult } from "./downloadDocument";

/** 与 URL 扩展名 / MIME 推断一致 */
export type DocumentKind = "markdown" | "docx" | "xmind" | "unknown";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function stripQueryHash(path: string): string {
  const i = path.search(/[?#]/);
  return i === -1 ? path : path.slice(0, i);
}

/** 从地址推断文档类型（小写路径扩展名） */
export function inferKindFromUrl(url: string): DocumentKind {
  const p = stripQueryHash(url.trim()).toLowerCase();
  if (p.endsWith(".docx")) return "docx";
  if (p.endsWith(".xmind")) return "xmind";
  if (p.endsWith(".md") || p.endsWith(".markdown")) return "markdown";
  return "unknown";
}

function normalizeContentType(ct: string | null): string | null {
  if (!ct) return null;
  return ct.split(";")[0]?.trim().toLowerCase() ?? null;
}

export function inferKind(
  url: string,
  contentType: string | null,
): DocumentKind {
  const fromUrl = inferKindFromUrl(url);
  if (fromUrl !== "unknown") return fromUrl;
  const mime = normalizeContentType(contentType);
  if (mime === DOCX_MIME || mime === "application/msword") return "docx";
  return "unknown";
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** 从下载结果得到原始字节（用于 docx / xmind） */
export function bytesFromDownload(result: DownloadDocumentResult): Uint8Array {
  if (result.base64 != null) {
    return base64ToUint8Array(result.base64);
  }
  if (result.text != null) {
    return new TextEncoder().encode(result.text);
  }
  throw new Error("下载结果缺少文本与二进制数据");
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function utf8TextFromDownload(result: DownloadDocumentResult): string {
  if (result.text != null) {
    return result.text;
  }
  if (result.base64 != null) {
    const u8 = base64ToUint8Array(result.base64);
    return new TextDecoder("utf-8", { fatal: false }).decode(u8);
  }
  throw new Error("下载结果缺少文本与二进制数据");
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({
    arrayBuffer: toArrayBuffer(bytes),
  });
  return value.trim();
}

/** 从 XMind（ZIP）内 content.json 抽取主题树为可读文本 */
async function parseXmind(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const matches = zip.file(/(^|\/)content\.json$/i);
  const contentFile = matches[0] ?? null;
  if (!contentFile) {
    throw new Error(
      "未在 XMind 文件中找到 content.json（仅支持含标准 content.json 的格式）",
    );
  }
  const raw = await contentFile.async("string");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("XMind content.json 不是合法 JSON");
  }
  const lines = flattenXmindTopics(data);
  if (lines.length === 0) {
    return "(空导图)";
  }
  return lines.join("\n");
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function topicTitle(t: unknown): string | null {
  if (!isRecord(t)) return null;
  const title = t.title;
  if (typeof title === "string") return title;
  return null;
}

function collectAttachedChildren(topic: unknown): unknown[] {
  if (!isRecord(topic)) return [];
  const ch = topic.children;
  if (!isRecord(ch)) return [];
  const attached = ch.attached;
  if (Array.isArray(attached)) return attached;
  return [];
}

function flattenTopicNode(topic: unknown, depth: number, out: string[]): void {
  const title = topicTitle(topic);
  if (title != null && title.length > 0) {
    out.push(`${"  ".repeat(depth)}${title}`);
  }
  for (const child of collectAttachedChildren(topic)) {
    flattenTopicNode(child, depth + 1, out);
  }
}

function flattenSheetOrRoot(data: unknown, out: string[]): void {
  if (Array.isArray(data)) {
    for (const sheet of data) {
      if (!isRecord(sheet)) continue;
      const rt = sheet.rootTopic;
      if (rt !== undefined) flattenTopicNode(rt, 0, out);
    }
    return;
  }
  if (isRecord(data) && data.rootTopic !== undefined) {
    flattenTopicNode(data.rootTopic, 0, out);
  }
}

function flattenXmindTopics(data: unknown): string[] {
  const out: string[] = [];
  flattenSheetOrRoot(data, out);
  return out;
}

export type ParseToReviewInputOptions = {
  /** 文档来源地址（用于扩展名推断） */
  sourceUrl: string;
  /** 下载结果 */
  result: DownloadDocumentResult;
};

/**
 * 将下载结果解析为单一评审输入字符串（Markdown 原样、DOCX 转纯文本、XMind 转层级大纲）。
 */
export async function parseToReviewInput(
  options: ParseToReviewInputOptions,
): Promise<string> {
  const { sourceUrl, result } = options;
  const kind = inferKind(sourceUrl, result.contentType);

  switch (kind) {
    case "markdown":
      return utf8TextFromDownload(result).trimEnd();
    case "docx": {
      const bytes = bytesFromDownload(result);
      return await parseDocx(bytes);
    }
    case "xmind": {
      const bytes = bytesFromDownload(result);
      return await parseXmind(bytes);
    }
    default: {
      if (result.text != null) {
        return result.text.trimEnd();
      }
      throw new Error(
        "无法根据地址或类型识别文档格式，请使用 .md / .docx / .xmind 等明确扩展名",
      );
    }
  }
}
