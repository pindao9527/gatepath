import { invoke, isTauri } from "@tauri-apps/api/core";

/** 与 Rust `DownloadDocumentResult`（camelCase）一致 */
export interface DownloadDocumentResult {
  byteLength: number;
  contentType: string | null;
  text: string | null;
  base64: string | null;
}

export type DownloadDocumentOptions = {
  /** 浏览器 fetch 可中断；Tauri 侧在命令返回后由调用方用会话号丢弃结果 */
  signal?: AbortSignal;
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("操作已取消", "AbortError");
  }
}

/**
 * 统一下载：桌面端走 Tauri 命令（无 CORS）；浏览器仅开发预览时对 HTTP(S) 使用 fetch。
 */
export async function downloadDocument(
  url: string,
  options?: DownloadDocumentOptions,
): Promise<DownloadDocumentResult> {
  const signal = options?.signal;
  const u = url.trim();
  if (!u) {
    throw new Error("请输入地址");
  }

  throwIfAborted(signal);

  if (isTauri()) {
    const result = await invoke<DownloadDocumentResult>("download_document", {
      url: u,
    });
    throwIfAborted(signal);
    return result;
  }

  if (!/^https?:\/\//i.test(u)) {
    throw new Error(
      "浏览器预览仅支持 http(s) 链接；本地文件与完整下载能力请使用桌面应用（pnpm tauri dev）。",
    );
  }

  const res = await fetch(u, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type");
  const mime = contentType
    ? contentType.split(";")[0]?.trim() ?? null
    : null;
  throwIfAborted(signal);
  const buf = new Uint8Array(await res.arrayBuffer());
  throwIfAborted(signal);
  return bytesToDownloadResult(buf, mime);
}

const MAX_BYTES = 32 * 1024 * 1024;

function bytesToDownloadResult(
  buf: Uint8Array,
  contentType: string | null,
): DownloadDocumentResult {
  const byteLength = buf.byteLength;
  if (byteLength > MAX_BYTES) {
    throw new Error(`内容过大（${byteLength} 字节），上限 ${MAX_BYTES} 字节`);
  }
  let text: string | null = null;
  let base64: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    base64 = btoa(bin);
  }
  return {
    byteLength,
    contentType,
    text,
    base64,
  };
}

/** 浏览器环境：由用户选择的本地文件构造与统一下载一致的结果（供解析管线使用）。 */
export async function downloadResultFromFile(
  file: File,
): Promise<DownloadDocumentResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const mime = file.type
    ? file.type.split(";")[0]?.trim().toLowerCase() ?? null
    : null;
  return bytesToDownloadResult(buf, mime);
}
