<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import {
  downloadDocument,
  downloadResultFromFile,
  type DownloadDocumentResult,
} from "../../lib/downloadDocument";
import { parseToReviewInput } from "../../lib/parsePipeline";
import {
  SESSION_REQUIREMENT_REVIEW_INPUT,
  SESSION_TEST_REVIEW_INPUT,
} from "../../lib/reviewSession";

const router = useRouter();

/** 需求文档地址（HTTP(S) 或后续本地路径） */
const requirementUrl = ref("");
/** 测试文档地址 */
const testUrl = ref("");

/** 下载 + 解析准备（任务 4）同一流程 */
const processing = ref(false);
/** 准备评审时的阶段（任务 6：细化加载态） */
type PrepareStage =
  | "idle"
  | "downloading-req"
  | "downloading-test"
  | "parsing";
const prepareStage = ref<PrepareStage>("idle");
const downloadError = ref<string | null>(null);

const prepareStatusLine = computed(() => {
  switch (prepareStage.value) {
    case "downloading-req":
      return "正在拉取需求文档…";
    case "downloading-test":
      return "正在拉取测试文档…";
    case "parsing":
      return "正在解析格式并写入预览缓存…";
    default:
      return "";
  }
});
/** 每次「准备评审」或「取消」递增；用于丢弃取消后的异步结果 */
let runSession = 0;
/** 浏览器预览时用于中断 fetch；桌面端无法中断 Rust 请求，仅靠 runSession 丢弃结果 */
let fetchAbort: AbortController | null = null;

/** 浏览器预览：用户通过「选择文件」选中的内容（桌面端用路径走 download_document，不需要此项） */
const requirementPickerResult = ref<DownloadDocumentResult | null>(null);
const testPickerResult = ref<DownloadDocumentResult | null>(null);

const requirementFileInput = ref<HTMLInputElement | null>(null);
const testFileInput = ref<HTMLInputElement | null>(null);

const DIALOG_FILTERS: { name: string; extensions: string[] }[] = [
  { name: "评审文档", extensions: ["md", "markdown", "docx", "xmind"] },
  { name: "所有文件", extensions: ["*"] },
];

const requirementDownload = ref<DownloadDocumentResult | null>(null);
const testDownload = ref<DownloadDocumentResult | null>(null);

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function onRequirementUrlInput() {
  requirementPickerResult.value = null;
}

function onTestUrlInput() {
  testPickerResult.value = null;
}

async function pickRequirementLocal() {
  downloadError.value = null;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      title: "选择需求文档",
      filters: DIALOG_FILTERS,
    });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (typeof path === "string" && path) {
      requirementUrl.value = path;
      requirementPickerResult.value = null;
    }
    return;
  }
  requirementFileInput.value?.click();
}

async function pickTestLocal() {
  downloadError.value = null;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      title: "选择测试文档",
      filters: DIALOG_FILTERS,
    });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (typeof path === "string" && path) {
      testUrl.value = path;
      testPickerResult.value = null;
    }
    return;
  }
  testFileInput.value?.click();
}

async function onRequirementFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    requirementPickerResult.value = await downloadResultFromFile(file);
    requirementUrl.value = file.name;
    downloadError.value = null;
  } catch (e) {
    requirementPickerResult.value = null;
    downloadError.value =
      e instanceof Error ? e.message : String(e ?? "读取文件失败");
  }
}

async function onTestFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    testPickerResult.value = await downloadResultFromFile(file);
    testUrl.value = file.name;
    downloadError.value = null;
  } catch (e) {
    testPickerResult.value = null;
    downloadError.value =
      e instanceof Error ? e.message : String(e ?? "读取文件失败");
  }
}

/** 任务 4：按扩展名解析为评审输入字符串；写入 session 后进入解析预览 */
async function runParsePipeline() {
  const req = requirementUrl.value.trim();
  const tst = testUrl.value.trim();

  if (req && requirementDownload.value) {
    let text: string;
    try {
      text = await parseToReviewInput({
        sourceUrl: req,
        result: requirementDownload.value,
      });
    } catch (e) {
      const base = e instanceof Error ? e.message : String(e ?? "未知错误");
      throw new Error(`解析需求文档失败：${base}`);
    }
    try {
      sessionStorage.setItem(SESSION_REQUIREMENT_REVIEW_INPUT, text);
    } catch {
      throw new Error("无法写入评审缓存（sessionStorage 不可用）");
    }
  } else {
    try {
      sessionStorage.removeItem(SESSION_REQUIREMENT_REVIEW_INPUT);
    } catch {
      /* ignore */
    }
  }

  if (tst && testDownload.value) {
    let text: string;
    try {
      text = await parseToReviewInput({
        sourceUrl: tst,
        result: testDownload.value,
      });
    } catch (e) {
      const base = e instanceof Error ? e.message : String(e ?? "未知错误");
      throw new Error(`解析测试文档失败：${base}`);
    }
    try {
      sessionStorage.setItem(SESSION_TEST_REVIEW_INPUT, text);
    } catch {
      throw new Error("无法写入评审缓存（sessionStorage 不可用）");
    }
  } else {
    try {
      sessionStorage.removeItem(SESSION_TEST_REVIEW_INPUT);
    } catch {
      /* ignore */
    }
  }

  await router.push({ name: "review-preview" });
}

function onCancelPrepare() {
  runSession += 1;
  fetchAbort?.abort();
  fetchAbort = null;
  processing.value = false;
  prepareStage.value = "idle";
  downloadError.value = null;
}

async function onStartPrepareReview() {
  const req = requirementUrl.value.trim();
  const tst = testUrl.value.trim();
  if (!req && !tst) {
    downloadError.value = "请至少填写需求文档或测试文档其中一个地址。";
    return;
  }

  const id = ++runSession;
  fetchAbort = new AbortController();
  const signal = fetchAbort.signal;

  downloadError.value = null;
  requirementDownload.value = null;
  testDownload.value = null;
  processing.value = true;
  prepareStage.value = "idle";
  try {
    if (req) {
      prepareStage.value = "downloading-req";
      const r =
        requirementPickerResult.value ??
        (await downloadDocument(req, { signal }));
      if (id !== runSession) return;
      requirementDownload.value = r;
    }
    if (tst) {
      prepareStage.value = "downloading-test";
      const r =
        testPickerResult.value ?? (await downloadDocument(tst, { signal }));
      if (id !== runSession) return;
      testDownload.value = r;
    }
    if (id !== runSession) return;
    prepareStage.value = "parsing";
    await runParsePipeline();
  } catch (e) {
    if (id !== runSession) return;
    if (isAbortError(e)) {
      downloadError.value = null;
      return;
    }
    downloadError.value =
      e instanceof Error ? e.message : String(e ?? "准备评审失败");
  } finally {
    fetchAbort = null;
    if (id === runSession) {
      processing.value = false;
      prepareStage.value = "idle";
    }
  }
}
</script>

<template>
  <div
    class="mx-auto max-w-2xl w-full px-4 py-8 text-left font-sans text-[#0f0f0f] dark:text-[#f6f6f6]"
  >
    <h1 class="text-xl font-semibold tracking-tight mb-1">文档入口</h1>
    <p class="text-sm text-[#666] dark:text-[#aaa] mb-8">
      填写地址后点击「准备评审」：拉取文档并解析为评审用文本（按扩展名：
      <code class="text-xs px-1 rounded bg-[#eee] dark:bg-[#333]">.md</code>、
      <code class="text-xs px-1 rounded bg-[#eee] dark:bg-[#333]">.docx</code>、
      <code class="text-xs px-1 rounded bg-[#eee] dark:bg-[#333]">.xmind</code>
      等），随后进入解析预览；多角色模型评审见后续步骤。桌面端由应用内请求拉取（避免跨域）；支持
      <code class="text-xs px-1 rounded bg-[#eee] dark:bg-[#333]">http(s)</code>、
      <code class="text-xs px-1 rounded bg-[#eee] dark:bg-[#333]">file://</code>
      与可读本地路径。
    </p>

    <div class="space-y-6">
      <div>
        <label
          for="req-url"
          class="block text-sm font-medium mb-2 text-[#333] dark:text-[#ccc]"
          >需求文档地址</label
        >
        <div class="flex gap-2 items-stretch">
          <input
            id="req-url"
            v-model="requirementUrl"
            type="text"
            autocomplete="off"
            placeholder="https://...、file:///... 或本地绝对路径"
            class="flex-1 min-w-0 rounded-lg border border-[#e0e0e0] dark:border-[#444] px-3 py-2.5 text-sm bg-white dark:bg-[#1a1a1a] outline-none focus:border-[#396cd8] transition-colors"
            @input="onRequirementUrlInput"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#222] text-[#333] dark:text-[#e8e8e8] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] transition-colors"
            title="选择本地文件（桌面端为系统对话框）"
            @click="pickRequirementLocal"
          >
            选择文件
          </button>
        </div>
        <input
          ref="requirementFileInput"
          type="file"
          class="hidden"
          accept=".md,.markdown,.docx,.xmind"
          @change="onRequirementFileChange"
        />
      </div>

      <div>
        <label
          for="test-url"
          class="block text-sm font-medium mb-2 text-[#333] dark:text-[#ccc]"
          >测试文档地址</label
        >
        <div class="flex gap-2 items-stretch">
          <input
            id="test-url"
            v-model="testUrl"
            type="text"
            autocomplete="off"
            placeholder="https://...、file:///... 或本地路径"
            class="flex-1 min-w-0 rounded-lg border border-[#e0e0e0] dark:border-[#444] px-3 py-2.5 text-sm bg-white dark:bg-[#1a1a1a] outline-none focus:border-[#396cd8] transition-colors"
            @input="onTestUrlInput"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#222] text-[#333] dark:text-[#e8e8e8] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] transition-colors"
            title="选择本地文件（桌面端为系统对话框）"
            @click="pickTestLocal"
          >
            选择文件
          </button>
        </div>
        <input
          ref="testFileInput"
          type="file"
          class="hidden"
          accept=".md,.markdown,.docx,.xmind"
          @change="onTestFileChange"
        />
      </div>

      <p
        v-if="downloadError"
        class="text-sm text-red-600 dark:text-red-400"
        role="alert"
      >
        {{ downloadError }}
      </p>

      <div class="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          :disabled="processing"
          class="rounded-lg px-5 py-2.5 text-sm font-medium cursor-pointer bg-[#396cd8] text-white hover:bg-[#2d56b3] active:bg-[#264a99] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          @click="onStartPrepareReview"
        >
          {{ processing ? "准备中…" : "准备评审" }}
        </button>
        <button
          v-if="processing"
          type="button"
          class="rounded-lg px-5 py-2.5 text-sm font-medium cursor-pointer border border-red-500/80 bg-white text-red-600 hover:bg-red-50 dark:bg-[#2a2a2a] dark:text-red-400 dark:border-red-400/80 dark:hover:bg-red-950/40"
          @click="onCancelPrepare"
        >
          取消
        </button>
      </div>
      <p
        v-if="processing && prepareStatusLine"
        class="text-sm text-[#666] dark:text-[#aaa] pt-1"
        role="status"
        aria-live="polite"
      >
        {{ prepareStatusLine }}
      </p>
    </div>
  </div>
</template>
