<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useSettings } from "../../composables/useSettings";
import {
  SESSION_REQUIREMENT_REVIEW_INPUT,
  SESSION_TEST_REVIEW_INPUT,
} from "../../lib/reviewSession";
import { MAX_COMBINED_REVIEW_CHARS } from "../../lib/reviewContentBudget";
import {
  TAVERN_ROLES,
  runDocumentReview,
  runTavernDocumentReview,
  type BetweenRoundsContext,
  type ReviewResult,
} from "../../lib/reviewApi";

const router = useRouter();
const {
  baseUrl,
  apiKey,
  model,
  loaded: settingsLoaded,
  load: loadSettings,
} = useSettings();

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const requirementText = ref<string | null>(null);
const testText = ref<string | null>(null);

function refreshFromSession() {
  requirementText.value = readStored(SESSION_REQUIREMENT_REVIEW_INPUT);
  testText.value = readStored(SESSION_TEST_REVIEW_INPUT);
}

const hasAny = computed(
  () =>
    (requirementText.value != null && requirementText.value.length > 0) ||
    (testText.value != null && testText.value.length > 0),
);

const configReady = computed(() => {
  const bu = baseUrl.value.trim();
  const m = model.value.trim();
  const k = apiKey.value.trim();
  return bu.length > 0 && m.length > 0 && k.length > 0;
});

const reviewing = ref(false);
const reviewError = ref<string | null>(null);
const reviewResult = ref<ReviewResult | null>(null);
/** 最近一次送交模型前因长度预算产生的提示 */
const truncationWarnings = ref<string[]>([]);
let abort: AbortController | null = null;

type ReviewMode = "quick" | "tavern";
const reviewMode = ref<ReviewMode>("tavern");
/** 酒馆模式：进入角色轮次前的可选补充 */
const tavernUserNote = ref("");
/** 酒馆：在相邻两轮角色之间暂停，允许插话后再继续 */
const tavernBetweenRounds = ref(false);

interface TavernChatItem {
  id: string;
  kind?: "assistant" | "user";
  speaker: string;
  shortLabel: string;
  avatarClass: string;
  content: string;
  streaming: boolean;
}

interface InterjectionGateState {
  ctx: BetweenRoundsContext;
  finish: (text: string | null) => void;
}

const interjectionGate = ref<InterjectionGateState | null>(null);
const interjectionDraft = ref("");

const tavernMessages = ref<TavernChatItem[]>([]);
const tavernRoundIndex = ref(0);
const tavernRoundTotal = TAVERN_ROLES.length;
const tavernListEl = ref<HTMLElement | null>(null);

function scrollTavernToBottom() {
  void nextTick(() => {
    const el = tavernListEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

const tavernStatusLine = computed(() => {
  if (!reviewing.value || reviewMode.value !== "tavern") return "";
  if (interjectionGate.value) {
    const nextName = interjectionGate.value.ctx.nextRole.speaker;
    return `酒馆：可插话或跳过 → 下一位「${nextName}」`;
  }
  if (tavernRoundIndex.value <= 0) return "酒馆：准备首轮…";
  return `酒馆：第 ${tavernRoundIndex.value} / ${tavernRoundTotal} 轮流式输出中…`;
});

onMounted(async () => {
  refreshFromSession();
  const ok =
    (requirementText.value != null && requirementText.value.length > 0) ||
    (testText.value != null && testText.value.length > 0);
  if (!ok) {
    router.replace({ name: "review-input" });
    return;
  }
  await loadSettings();
});

onBeforeUnmount(() => {
  abort?.abort();
});

const combinedChars = computed(() => {
  const a = requirementText.value?.length ?? 0;
  const b = testText.value?.length ?? 0;
  return a + b;
});

const mayExceedModelBudget = computed(
  () => combinedChars.value > MAX_COMBINED_REVIEW_CHARS,
);

function goBack() {
  router.push({ name: "review-preview" });
}

async function startReview() {
  reviewError.value = null;
  truncationWarnings.value = [];
  tavernMessages.value = [];
  tavernRoundIndex.value = 0;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  reviewing.value = true;
  try {
    if (reviewMode.value === "quick") {
      const outcome = await runDocumentReview({
        baseUrl: baseUrl.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
        requirementText: requirementText.value,
        testText: testText.value,
        signal,
      });
      reviewResult.value = outcome.result;
      truncationWarnings.value = outcome.truncationWarnings;
    } else {
      const outcome = await runTavernDocumentReview({
        baseUrl: baseUrl.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
        requirementText: requirementText.value,
        testText: testText.value,
        userNote: tavernUserNote.value.trim() || null,
        signal,
        callbacks: {
          onRoundStart: (role) => {
            tavernRoundIndex.value =
              TAVERN_ROLES.findIndex((r) => r.id === role.id) + 1;
            tavernMessages.value.push({
              id: `${Date.now()}-${role.id}-${Math.random().toString(36).slice(2)}`,
              kind: "assistant",
              speaker: role.speaker,
              shortLabel: role.shortLabel,
              avatarClass: role.avatarClass,
              content: "",
              streaming: true,
            });
            scrollTavernToBottom();
          },
          onDelta: (chunk) => {
            const list = tavernMessages.value;
            const last = list[list.length - 1];
            if (last) last.content += chunk;
            scrollTavernToBottom();
          },
          onRoundComplete: (_role, fullText) => {
            const list = tavernMessages.value;
            const last = list[list.length - 1];
            if (last) {
              last.content = fullText;
              last.streaming = false;
            }
            scrollTavernToBottom();
          },
          promptUserInterjection: tavernBetweenRounds.value
            ? (ctx) =>
                new Promise<string | null>((resolve, reject) => {
                  const onAbort = () => {
                    signal.removeEventListener("abort", onAbort);
                    interjectionGate.value = null;
                    interjectionDraft.value = "";
                    reject(new DOMException("Aborted", "AbortError"));
                  };
                  signal.addEventListener("abort", onAbort);
                  interjectionDraft.value = "";
                  interjectionGate.value = {
                    ctx,
                    finish: (text) => {
                      signal.removeEventListener("abort", onAbort);
                      interjectionGate.value = null;
                      const trimmed = text?.trim() ?? "";
                      if (trimmed.length > 0) {
                        tavernMessages.value.push({
                          id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                          kind: "user",
                          speaker: "你",
                          shortLabel: "我",
                          avatarClass:
                            "bg-zinc-500 dark:bg-zinc-600",
                          content: trimmed,
                          streaming: false,
                        });
                        scrollTavernToBottom();
                      }
                      interjectionDraft.value = "";
                      resolve(trimmed.length > 0 ? trimmed : null);
                    },
                  };
                  scrollTavernToBottom();
                })
            : undefined,
        },
      });
      reviewResult.value = outcome.result;
      truncationWarnings.value = outcome.truncationWarnings;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (e instanceof Error && e.name === "AbortError") return;
    reviewError.value =
      e instanceof Error ? e.message : "评审请求失败，请稍后重试。";
  } finally {
    reviewing.value = false;
  }
}

function cancelReview() {
  abort?.abort();
}

function skipInterjection() {
  interjectionGate.value?.finish(null);
}

function submitInterjection() {
  interjectionGate.value?.finish(interjectionDraft.value);
}
</script>

<template>
  <div
    class="mx-auto max-w-2xl w-full px-4 py-8 text-left font-sans text-[#0f0f0f] dark:text-[#f6f6f6]"
  >
    <h1 class="text-xl font-semibold tracking-tight mb-1">评审</h1>
    <p class="text-sm text-[#666] dark:text-[#aaa] mb-6">
      解析正文已在上一步「解析预览」中核对。本页发起模型评审：可选<strong class="font-medium text-[#333] dark:text-[#ccc]">快速评审</strong>（单次 JSON）或<strong class="font-medium text-[#333] dark:text-[#ccc]">酒馆模式</strong>（多角色串行、SSE
      流式、末轮汇总得分与建议）。
    </p>

    <p
      v-if="!settingsLoaded"
      class="text-sm text-[#666] dark:text-[#aaa] mb-4"
    >
      正在加载配置…
    </p>

    <div
      v-else-if="!configReady"
      class="mb-6 text-sm rounded-lg border border-amber-200 dark:border-amber-900/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100/95 px-3 py-2"
      role="status"
    >
      请先在
      <RouterLink
        to="/settings"
        class="text-[#396cd8] dark:text-[#6b9eff] underline underline-offset-2"
        >设置</RouterLink
      >
      填写 Base URL、Model 与 API Key（桌面端可将 Key 存入系统钥匙串）。
    </div>

    <div
      v-else
      class="mb-6 space-y-4"
    >
      <fieldset
        class="flex flex-wrap gap-4 border-0 p-0 m-0"
        :disabled="reviewing"
      >
        <legend class="sr-only">评审模式</legend>
        <label
          class="inline-flex items-center gap-2 text-sm cursor-pointer select-none"
        >
          <input
            v-model="reviewMode"
            type="radio"
            value="quick"
            class="accent-[#396cd8]"
          />
          快速评审
        </label>
        <label
          class="inline-flex items-center gap-2 text-sm cursor-pointer select-none"
        >
          <input
            v-model="reviewMode"
            type="radio"
            value="tavern"
            class="accent-[#396cd8]"
          />
          酒馆模式（流式 · 多角色）
        </label>
      </fieldset>

      <div v-if="reviewMode === 'tavern'" class="space-y-3">
        <label
          class="flex items-start gap-2 text-sm text-[#333] dark:text-[#ccc] cursor-pointer select-none"
        >
          <input
            v-model="tavernBetweenRounds"
            type="checkbox"
            class="mt-0.5 accent-[#396cd8] shrink-0"
            :disabled="reviewing"
          />
          <span
            >回合间允许插话（每轮角色说完后可输入再进入下一轮；不勾选则连续流式跑完）</span
          >
        </label>
        <div class="space-y-2">
          <label
            for="tavern-note"
            class="block text-xs font-medium text-[#555] dark:text-[#aaa]"
            >参与者补充（可选，插入在角色发言前）</label
          >
          <textarea
            id="tavern-note"
            v-model="tavernUserNote"
            rows="2"
            :disabled="reviewing"
            placeholder="例如：请重点关注登录与权限相关用例…"
            class="w-full rounded-lg border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#1a1a1a] text-sm px-3 py-2 text-[#0f0f0f] dark:text-[#f6f6f6] placeholder:text-[#999] focus:outline-none focus:ring-2 focus:ring-[#396cd8]/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-lg bg-[#396cd8] text-white text-sm font-medium px-4 py-2.5 hover:bg-[#2f5ac4] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="reviewing || !hasAny"
          @click="startReview"
        >
          {{ reviewResult ? "重新评审" : "开始评审" }}
        </button>
        <button
          v-if="reviewing"
          type="button"
          class="rounded-lg border border-[#e0e0e0] dark:border-[#444] text-sm px-4 py-2.5 bg-white dark:bg-[#1a1a1a] hover:bg-[#f5f5f5] dark:hover:bg-[#252525]"
          @click="cancelReview"
        >
          取消
        </button>
        <span
          v-if="reviewing && reviewMode === 'quick'"
          class="text-sm text-[#666] dark:text-[#aaa]"
          >正在请求模型并等待 JSON 结果…</span
        >
        <span
          v-else-if="reviewing && reviewMode === 'tavern'"
          class="text-sm text-[#666] dark:text-[#aaa]"
          >{{ tavernStatusLine }}</span
        >
      </div>
    </div>

    <div
      v-if="
        reviewMode === 'tavern' &&
        (tavernMessages.length > 0 || interjectionGate)
      "
      ref="tavernListEl"
      class="mb-8 rounded-xl border border-[#e0e0e0] dark:border-[#444] bg-[#fafafa] dark:bg-[#141414] max-h-[min(60vh,28rem)] overflow-y-auto flex flex-col"
      role="log"
      aria-live="polite"
    >
      <ul class="p-3 space-y-4 flex-1 min-h-0">
        <li
          v-for="m in tavernMessages"
          :key="m.id"
          class="flex gap-3 items-start"
          :class="m.kind === 'user' ? 'flex-row-reverse' : ''"
        >
          <div
            class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-sm"
            :class="m.avatarClass"
            :aria-label="m.speaker"
          >
            {{ m.shortLabel.slice(0, 1) }}
          </div>
          <div
            class="min-w-0 space-y-1"
            :class="m.kind === 'user' ? 'text-right flex-1' : 'flex-1'"
          >
            <div
              class="flex items-baseline gap-2 flex-wrap"
              :class="m.kind === 'user' ? 'justify-end' : ''"
            >
              <span class="text-sm font-medium text-[#222] dark:text-[#e0e0e0]">{{
                m.speaker
              }}</span>
              <span
                v-if="m.streaming"
                class="text-xs text-[#888] dark:text-[#777] tabular-nums"
                >输出中…</span
              >
            </div>
            <div
              class="rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap break-words inline-block max-w-full text-left"
              :class="
                m.kind === 'user'
                  ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800/80 text-[#222] dark:text-[#e8e8e8]'
                  : 'border-[#e8e8e8] dark:border-[#3a3a3a] bg-white dark:bg-[#1a1a1a] text-[#333] dark:text-[#ddd]'
              "
            >
              {{ m.content }}
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="interjectionGate"
        class="shrink-0 border-t border-[#e0e0e0] dark:border-[#444] p-3 bg-[#f0f4ff] dark:bg-[#1e2435] space-y-2"
      >
        <p class="text-xs font-medium text-[#333] dark:text-[#ccc]">
          下一位：{{ interjectionGate.ctx.nextRole.speaker }} — 可选插话（会写入对话上下文）
        </p>
        <textarea
          v-model="interjectionDraft"
          rows="2"
          placeholder="输入补充意见，或留空后点「跳过」…"
          class="w-full rounded-lg border border-[#c8d4f0] dark:border-[#3d4a66] bg-white dark:bg-[#1a1a1a] text-sm px-3 py-2 text-[#0f0f0f] dark:text-[#f6f6f6] placeholder:text-[#999] focus:outline-none focus:ring-2 focus:ring-[#396cd8]/40"
        />
        <div class="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            class="rounded-lg border border-[#e0e0e0] dark:border-[#555] text-sm px-3 py-1.5 bg-white dark:bg-[#252525] hover:bg-[#f5f5f5] dark:hover:bg-[#333]"
            @click="skipInterjection"
          >
            跳过，直接继续
          </button>
          <button
            type="button"
            class="rounded-lg bg-[#396cd8] text-white text-sm font-medium px-3 py-1.5 hover:bg-[#2f5ac4]"
            @click="submitInterjection"
          >
            插入并继续
          </button>
        </div>
      </div>
    </div>

    <p
      v-if="mayExceedModelBudget && configReady && hasAny && !reviewing"
      class="mb-4 text-sm rounded-lg border border-amber-200 dark:border-amber-900/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100/95 px-3 py-2"
      role="status"
    >
      两侧解析正文合计约 {{ combinedChars.toLocaleString() }} 字，超过单次送交建议上限（约
      {{ MAX_COMBINED_REVIEW_CHARS.toLocaleString() }} 字）。点击「开始评审」时会按比例截断后再请求模型。
    </p>

    <div
      v-if="truncationWarnings.length > 0"
      class="mb-4 space-y-2"
      role="status"
    >
      <p
        v-for="(w, i) in truncationWarnings"
        :key="i"
        class="text-sm rounded-lg border border-sky-200 dark:border-sky-900/80 bg-sky-50 dark:bg-sky-950/35 text-sky-950 dark:text-sky-100/95 px-3 py-2"
      >
        {{ w }}
      </p>
    </div>

    <p
      v-if="reviewError"
      class="mb-4 text-sm text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ reviewError }}
    </p>

    <div
      v-if="reviewResult"
      class="mb-8 rounded-lg border border-[#e0e0e0] dark:border-[#444] bg-[#fafafa] dark:bg-[#141414] p-4 space-y-3"
    >
      <div class="flex items-baseline gap-3 flex-wrap">
        <span class="text-sm font-medium text-[#333] dark:text-[#ccc]"
          >综合得分</span
        >
        <span
          class="text-3xl font-semibold tabular-nums text-[#0f0f0f] dark:text-[#f6f6f6]"
          >{{ reviewResult.score }}</span
        >
        <span class="text-sm text-[#666] dark:text-[#999]">/ 100</span>
      </div>
      <div>
        <h3 class="text-sm font-medium text-[#333] dark:text-[#ccc] mb-2">
          修改建议
        </h3>
        <ol
          class="list-decimal pl-5 space-y-2 text-sm text-[#333] dark:text-[#ddd]"
        >
          <li v-for="(s, i) in reviewResult.suggestions" :key="i">
            {{ s }}
          </li>
        </ol>
      </div>
    </div>

    <p
      v-if="!hasAny"
      class="text-sm text-amber-800 dark:text-amber-200/90 rounded-lg border border-amber-200 dark:border-amber-900/80 bg-amber-50 dark:bg-amber-950/40 px-3 py-2"
    >
      暂无解析内容。请从文档入口完成「准备评审」。
    </p>
    <p
      v-else
      class="text-xs text-[#888] dark:text-[#777] mb-6"
    >
      本页不重复展示解析正文；需看摘要或全文请用下方「返回解析预览」。
    </p>

    <p class="mt-8">
      <button
        type="button"
        class="text-sm text-[#396cd8] hover:underline dark:text-[#6b9eff] bg-transparent border-0 cursor-pointer p-0 font-inherit"
        @click="goBack"
      >
        ← 返回解析预览
      </button>
    </p>
  </div>
</template>
