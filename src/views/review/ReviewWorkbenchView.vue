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
  buildTavernRoleChain,
  extractTavernRolesWithModel,
  getDefaultTavernMiddleRoles,
  runDocumentReview,
  runTavernDocumentReview,
  type BetweenRoundsContext,
  type ReviewResult,
  type TavernRoleConfig,
} from "../../lib/reviewApi";
import { prepareTextsForModel } from "../../lib/reviewContentBudget";
import {
  inferRuleHitsFromText,
  mergeMiddleRolesFromSources,
  rebuildMiddleRolesPrompts,
  TAVERN_V2E_MAX_MIDDLE_ROLES,
  TAVERN_V2E_MAX_TOTAL_ROUNDS,
  validateMiddleRoleCount,
} from "../../lib/tavernDynamicRoles";
import TavernChatMarkdown from "../../components/TavernChatMarkdown.vue";

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
/** 已有评审结果时，为 false 则隐藏模式/酒馆等选项；点「重新评审」置 true 再展开 */
const revealReviewOptions = ref(false);

const showReviewConfigPanel = computed(() => {
  if (reviewing.value) return false;
  if (!reviewResult.value) return true;
  return revealReviewOptions.value;
});
/** 最近一次送交模型前因长度预算产生的提示 */
const truncationWarnings = ref<string[]>([]);
let abort: AbortController | null = null;

type ReviewMode = "quick" | "tavern";
const reviewMode = ref<ReviewMode>("tavern");
/** 酒馆模式：进入角色轮次前的可选补充 */
const tavernUserNote = ref("");
/** 酒馆：在相邻两轮角色之间暂停，允许插话后再继续 */
const tavernBetweenRounds = ref(false);

/** v2-E：中间角色（不含主持），可编辑 */
function cloneDefaultMiddleRoles(): TavernRoleConfig[] {
  return rebuildMiddleRolesPrompts(
    getDefaultTavernMiddleRoles().map((r) => ({ ...r })),
  );
}

const tavernMiddleRoles = ref<TavernRoleConfig[]>(cloneDefaultMiddleRoles());
/** 本轮评审实际角色链（含主持），用于轮次序号 */
const activeTavernChain = ref<TavernRoleConfig[]>([]);
/** E5：智能推断时是否纳入测试文档 */
const tavernInferUseTest = ref(false);
/** E1：智能推断时是否额外调用模型抽取（一次额外 API） */
const tavernInferUseModel = ref(false);
const roleSuggestBusy = ref(false);
const roleSuggestError = ref<string | null>(null);

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
const tavernRoundTotal = computed(
  () =>
    activeTavernChain.value.length > 0
      ? activeTavernChain.value.length
      : buildTavernRoleChain(tavernMiddleRoles.value).length,
);
const tavernListEl = ref<HTMLElement | null>(null);

const tavernChainSummary = computed(() => {
  const mid = tavernMiddleRoles.value.map((r) => r.speaker).join(" → ");
  return mid ? `${mid} → 综合主持` : "综合主持";
});

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
    return `想补充一句？下一位是「${nextName}」——可插话，或跳过直接继续`;
  }
  if (tavernRoundIndex.value <= 0) return "对话准备中…";
  return `第 ${tavernRoundIndex.value} / ${tavernRoundTotal.value} 位角色正在回复…`;
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

function openReviewOptionsForRetry() {
  revealReviewOptions.value = true;
}

async function startReview() {
  reviewError.value = null;
  truncationWarnings.value = [];
  tavernMessages.value = [];
  tavernRoundIndex.value = 0;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  if (reviewMode.value === "tavern") {
    const roleBudget = validateMiddleRoleCount(tavernMiddleRoles.value.length);
    if (!roleBudget.ok) {
      reviewError.value = roleBudget.warnings.join(" ");
      return;
    }
  }
  revealReviewOptions.value = false;
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
      const chain = buildTavernRoleChain(tavernMiddleRoles.value);
      activeTavernChain.value = chain;
      const outcome = await runTavernDocumentReview({
        baseUrl: baseUrl.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
        requirementText: requirementText.value,
        testText: testText.value,
        userNote: tavernUserNote.value.trim() || null,
        signal,
        tavernRoles: chain,
        callbacks: {
          onRoundStart: (role) => {
            const idx = activeTavernChain.value.findIndex(
              (r) => r.id === role.id,
            );
            tavernRoundIndex.value = idx >= 0 ? idx + 1 : 1;
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
    activeTavernChain.value = [];
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

function moveMiddleRole(index: number, delta: number) {
  const arr = tavernMiddleRoles.value;
  const j = index + delta;
  if (j < 0 || j >= arr.length) return;
  const next = [...arr];
  const t = next[index]!;
  next[index] = next[j]!;
  next[j] = t;
  tavernMiddleRoles.value = rebuildMiddleRolesPrompts(next);
}

function removeMiddleRole(index: number) {
  const next = tavernMiddleRoles.value.filter((_, i) => i !== index);
  if (next.length === 0) return;
  tavernMiddleRoles.value = rebuildMiddleRolesPrompts(next);
}

function addMiddleRole() {
  if (tavernMiddleRoles.value.length >= TAVERN_V2E_MAX_MIDDLE_ROLES) return;
  const next = [
    ...tavernMiddleRoles.value,
    {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      speaker: "新角色",
      shortLabel: "新",
      avatarClass: "bg-zinc-500 dark:bg-zinc-600",
      turnUserPrompt: "",
      jsonOutput: false,
    },
  ];
  tavernMiddleRoles.value = rebuildMiddleRolesPrompts(next);
}

function updateMiddleSpeaker(index: number, speaker: string) {
  const next = tavernMiddleRoles.value.map((r, i) =>
    i === index ? { ...r, speaker } : r,
  );
  tavernMiddleRoles.value = rebuildMiddleRolesPrompts(next);
}

function updateMiddleShortLabel(index: number, shortLabel: string) {
  const next = tavernMiddleRoles.value.map((r, i) =>
    i === index ? { ...r, shortLabel } : r,
  );
  tavernMiddleRoles.value = rebuildMiddleRolesPrompts(next);
}

async function suggestTavernRoles() {
  roleSuggestError.value = null;
  if (!configReady.value) {
    roleSuggestError.value = "请先完成 API 配置。";
    return;
  }
  roleSuggestBusy.value = true;
  try {
    const prepared = prepareTextsForModel(
      requirementText.value,
      testText.value,
    );
    const ruleHits = inferRuleHitsFromText(
      requirementText.value,
      testText.value,
      tavernInferUseTest.value,
    );
    let modelRoles = null;
    if (tavernInferUseModel.value) {
      modelRoles = await extractTavernRolesWithModel({
        baseUrl: baseUrl.value.trim(),
        apiKey: apiKey.value.trim(),
        model: model.value.trim(),
        requirementText: prepared.requirementText,
        testText: prepared.testText,
        useTestDocumentForInference: tavernInferUseTest.value,
      });
    }
    const merged = mergeMiddleRolesFromSources({
      ruleHits,
      modelRoles,
      fallbackMiddle: getDefaultTavernMiddleRoles().map((r) => ({ ...r })),
    });
    tavernMiddleRoles.value = rebuildMiddleRolesPrompts(merged);
  } catch (e) {
    roleSuggestError.value =
      e instanceof Error ? e.message : "角色推断失败。";
  } finally {
    roleSuggestBusy.value = false;
  }
}

function resetTavernRolesToDefault() {
  tavernMiddleRoles.value = cloneDefaultMiddleRoles();
  roleSuggestError.value = null;
}
</script>

<template>
  <div class="gp-page-wrap gp-page-wrap-wide">
    <div
      class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 mb-6"
    >
      <nav class="gp-workflow-crumb mb-0" aria-label="流程位置">
        <span class="text-gp-faint">录入</span>
        <span class="text-gp-faint" aria-hidden="true">/</span>
        <span class="text-gp-faint">预览</span>
        <span class="text-gp-faint" aria-hidden="true">/</span>
        <span class="text-gp-accent font-medium">评审</span>
      </nav>
      <div class="gp-action-bar shrink-0">
        <button
          type="button"
          class="gp-btn-secondary px-4 py-2.5 text-sm font-medium"
          @click="goBack"
        >
          返回解析预览
        </button>
      </div>
    </div>

    <header class="gp-page-head">
      <p class="gp-kicker">03 · 评审</p>
      <h1 class="gp-title mb-3">评审</h1>
      <p class="gp-lead">
        解析正文已在上一步「解析预览」中核对。本页发起模型评审：可选<strong
          class="font-medium text-gp-ink"
          >快速评审</strong
        >（单次 JSON）或<strong class="font-medium text-gp-ink">酒馆模式</strong
        >（多角色串行、SSE
        流式；中间角色可自定义或智能建议（首轮分「现象 / 依据 / 建议」，后续轮对照前序；末轮固定「综合主持」JSON 汇总）。
      </p>
    </header>

    <div
      v-if="!settingsLoaded"
      class="gp-panel-quiet mb-6 space-y-3 max-w-md"
      aria-busy="true"
      aria-live="polite"
    >
      <div class="h-3 w-32 gp-skeleton-bar" />
      <div class="h-10 w-full gp-skeleton-bar" />
      <p class="text-xs text-gp-faint font-mono">正在加载配置…</p>
    </div>

    <div
      v-else-if="!configReady"
      class="gp-callout-warn mb-6"
      role="status"
    >
      请先在
      <RouterLink
        to="/settings"
        class="text-gp-accent underline underline-offset-2 font-medium"
        >设置</RouterLink
      >
      填写 Base URL、Model 与 API Key（桌面端可将 Key 存入系统钥匙串）。
    </div>

    <div
      v-else
      class="mb-8 space-y-6"
    >
      <div v-if="showReviewConfigPanel" class="gp-panel space-y-6">
      <fieldset
        class="flex flex-wrap gap-6 border-0 p-0 m-0 pb-1 border-b border-gp-border/50"
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
            class="accent-gp-accent"
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
            class="accent-gp-accent"
          />
          酒馆模式（流式 · 多角色）
        </label>
      </fieldset>

      <div v-if="reviewMode === 'tavern'" class="space-y-3">
        <label
          class="flex items-start gap-2 text-sm text-gp-ink cursor-pointer select-none"
        >
          <input
            v-model="tavernBetweenRounds"
            type="checkbox"
            class="mt-0.5 accent-gp-accent shrink-0"
            :disabled="reviewing"
          />
          <span
            >回合间允许插话（每轮角色说完后可输入再进入下一轮；不勾选则连续流式跑完）</span
          >
        </label>
        <div class="space-y-2">
          <label
            for="tavern-note"
            class="block text-xs font-medium text-gp-muted mb-1.5"
            >参与者补充（可选，插入在角色发言前）</label
          >
          <textarea
            id="tavern-note"
            v-model="tavernUserNote"
            rows="2"
            :disabled="reviewing"
            placeholder="例如：请重点关注登录与权限相关用例…"
            class="gp-input w-full text-sm py-2 disabled:opacity-50"
          />
        </div>

        <div class="gp-panel-quiet space-y-3">
          <div class="space-y-1">
            <p class="text-sm font-semibold text-gp-ink">
              中间角色（开始前确认）
            </p>
            <p class="text-xs text-gp-muted leading-relaxed">
              发言顺序即列表顺序；末轮固定为「综合主持」输出得分与建议 JSON。中间角色上限
              {{ TAVERN_V2E_MAX_MIDDLE_ROLES }} 个，合计最多
              {{ TAVERN_V2E_MAX_TOTAL_ROUNDS }} 轮请求（含主持）。正文长度仍受
              「准备评审」截断策略约束。
            </p>
            <p
              class="text-xs text-gp-accent font-semibold"
              aria-live="polite"
            >
              {{ tavernChainSummary }}
            </p>
          </div>

          <ul class="space-y-2">
            <li
              v-for="(role, index) in tavernMiddleRoles"
              :key="role.id"
              class="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-gp-border bg-gp-surface"
            >
              <label class="flex-1 min-w-[8rem] space-y-0.5">
                <span class="text-[11px] font-medium tracking-wide text-gp-faint"
                  >称呼</span
                >
                <input
                  :value="role.speaker"
                  type="text"
                  :disabled="reviewing"
                  class="w-full rounded-md border border-gp-border bg-gp-surface text-sm px-2 py-1.5 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gp-accent"
                  @change="
                    updateMiddleSpeaker(
                      index,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <label class="w-20 space-y-0.5">
                <span class="text-[11px] font-medium tracking-wide text-gp-faint"
                  >简称</span
                >
                <input
                  :value="role.shortLabel"
                  type="text"
                  maxlength="8"
                  :disabled="reviewing"
                  class="w-full rounded-md border border-gp-border bg-gp-surface text-sm px-2 py-1.5 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gp-accent"
                  @change="
                    updateMiddleShortLabel(
                      index,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <div class="flex gap-1 shrink-0">
                <button
                  type="button"
                  class="rounded-md border border-gp-border bg-gp-surface text-xs px-2 py-1.5 transition-colors hover:bg-gp-canvas disabled:opacity-40 gp-focus"
                  :disabled="reviewing || index === 0"
                  title="上移"
                  @click="moveMiddleRole(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="rounded-md border border-gp-border bg-gp-surface text-xs px-2 py-1.5 transition-colors hover:bg-gp-canvas disabled:opacity-40 gp-focus"
                  :disabled="
                    reviewing || index >= tavernMiddleRoles.length - 1
                  "
                  title="下移"
                  @click="moveMiddleRole(index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="rounded-md border border-red-300/80 dark:border-red-900/90 text-xs px-2 py-1.5 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 gp-focus"
                  :disabled="reviewing || tavernMiddleRoles.length <= 1"
                  title="删除"
                  @click="removeMiddleRole(index)"
                >
                  删
                </button>
              </div>
            </li>
          </ul>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="gp-btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
              :disabled="
                reviewing ||
                tavernMiddleRoles.length >= TAVERN_V2E_MAX_MIDDLE_ROLES
              "
              @click="addMiddleRole"
            >
              添加角色
            </button>
            <button
              type="button"
              class="gp-btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
              :disabled="reviewing"
              @click="resetTavernRolesToDefault"
            >
              恢复默认（教研·产品·家长·学生）
            </button>
          </div>

          <div
            class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-4 text-xs text-gp-muted"
          >
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                v-model="tavernInferUseTest"
                type="checkbox"
                class="accent-gp-accent shrink-0"
                :disabled="reviewing || roleSuggestBusy"
              />
              智能推断时纳入测试文档（默认仅需求侧，降低复杂度）
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                v-model="tavernInferUseModel"
                type="checkbox"
                class="accent-gp-accent shrink-0"
                :disabled="reviewing || roleSuggestBusy"
              />
              同时请求模型抽取角色（额外一次 API）
            </label>
          </div>

          <div class="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              class="gp-btn rounded-lg bg-gp-ink text-gp-canvas dark:bg-gp-surface dark:text-gp-ink text-sm font-medium px-3 py-1.5 shadow-sm hover:opacity-95 active:scale-[0.98] disabled:opacity-50 gp-focus"
              :disabled="reviewing || roleSuggestBusy || !configReady"
              @click="suggestTavernRoles"
            >
              {{ roleSuggestBusy ? "推断中…" : "根据文档智能建议角色" }}
            </button>
          </div>
          <p
            v-if="roleSuggestError"
            class="gp-inline-error text-xs"
            role="alert"
          >
            {{ roleSuggestError }}
          </p>
        </div>
      </div>
      </div>

      <div class="gp-action-bar">
        <template
          v-if="!showReviewConfigPanel && reviewResult && !reviewing"
        >
          <button
            type="button"
            class="gp-btn-primary px-4 py-2.5 text-sm"
            @click="openReviewOptionsForRetry"
          >
            重新评审
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="gp-btn-primary px-4 py-2.5 text-sm"
            :disabled="reviewing || !hasAny"
            @click="startReview"
          >
            开始评审
          </button>
          <button
            v-if="reviewing"
            type="button"
            class="gp-btn-secondary text-sm px-4 py-2.5"
            @click="cancelReview"
          >
            取消
          </button>
          <span
            v-if="reviewing && reviewMode === 'quick'"
            class="text-sm text-gp-muted"
            >正在请求模型并等待 JSON 结果…</span
          >
          <span
            v-else-if="reviewing && reviewMode === 'tavern'"
            class="text-sm text-gp-muted"
            >{{ tavernStatusLine }}</span
          >
        </template>
      </div>
    </div>

    <div
      v-if="
        reviewMode === 'tavern' &&
        (tavernMessages.length > 0 || interjectionGate)
      "
      ref="tavernListEl"
      class="gp-panel mb-8 max-h-[min(60dvh,30rem)] overflow-y-auto flex flex-col !p-0 rounded-2xl"
      role="log"
      aria-live="polite"
    >
      <div
        class="shrink-0 px-4 pt-3 pb-1 border-b border-gp-border/60 bg-gp-canvas-2/50"
      >
        <p class="text-xs font-medium text-gp-muted">角色对话</p>
        <p class="text-[11px] text-gp-faint mt-0.5">
          以下为多角色按序回复；支持标题、列表与代码块等 Markdown 展示。
        </p>
      </div>
      <ul class="p-4 md:p-5 space-y-5 flex-1 min-h-0">
        <li
          v-for="m in tavernMessages"
          :key="m.id"
          class="flex gap-3 items-end"
          :class="m.kind === 'user' ? 'flex-row-reverse' : ''"
        >
          <div
            class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shadow-sm ring-2 ring-white/20"
            :class="m.avatarClass"
            :aria-label="m.speaker"
          >
            {{ m.shortLabel.slice(0, 1) }}
          </div>
          <div
            class="min-w-0 space-y-1.5 max-w-[min(100%,42rem)]"
            :class="m.kind === 'user' ? 'text-right flex flex-col items-end' : ''"
          >
            <div
              class="flex items-baseline gap-2 flex-wrap"
              :class="m.kind === 'user' ? 'justify-end' : ''"
            >
              <span class="text-sm font-semibold text-gp-ink">{{
                m.speaker
              }}</span>
              <span
                v-if="m.streaming"
                class="text-xs text-gp-faint tabular-nums"
                >正在输入…</span
              >
            </div>
            <div
              class="rounded-2xl px-3.5 py-2.5 text-left shadow-sm break-words w-full"
              :class="
                m.kind === 'user'
                  ? 'bg-gp-accent-dim border border-gp-border/90 rounded-br-md'
                  : 'bg-gp-elevated border border-gp-border/80 rounded-bl-md'
              "
            >
              <p
                v-if="m.streaming && !m.content"
                class="text-sm text-gp-faint m-0"
              >
                …
              </p>
              <TavernChatMarkdown
                v-else
                :bubble-key="m.id"
                :text="m.content"
                :streaming="m.streaming"
              />
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="interjectionGate"
        class="shrink-0 border-t border-gp-border p-3 bg-gp-accent-dim space-y-2"
      >
        <p class="text-xs font-medium text-gp-ink">
          接着轮到「{{ interjectionGate.ctx.nextRole.speaker }}」——想说两句可以现在写（会作为你的发言接进对话里）
        </p>
        <textarea
          v-model="interjectionDraft"
          rows="2"
          placeholder="随便补一句，比如补充背景或约束；不需要就点跳过"
          class="gp-input w-full text-sm py-2"
        />
        <div class="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            class="gp-btn-secondary text-sm px-3 py-1.5"
            @click="skipInterjection"
          >
            跳过，直接继续
          </button>
          <button
            type="button"
            class="gp-btn-primary text-sm px-3 py-1.5"
            @click="submitInterjection"
          >
            插入并继续
          </button>
        </div>
      </div>
    </div>

    <p
      v-if="mayExceedModelBudget && configReady && hasAny && !reviewing"
      class="gp-callout-warn mb-4"
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
        class="gp-callout-info"
      >
        {{ w }}
      </p>
    </div>

    <p v-if="reviewError" class="gp-inline-error mb-4" role="alert">
      {{ reviewError }}
    </p>

    <div v-if="reviewResult" class="gp-panel mb-8 space-y-4">
      <div class="flex items-baseline gap-3 flex-wrap">
        <span class="text-sm font-semibold text-gp-muted"
          >综合得分</span
        >
        <span
          class="text-3xl font-semibold tabular-nums text-gp-ink tracking-tight font-mono"
          >{{ reviewResult.score }}</span
        >
        <span class="text-sm text-gp-faint">/ 100</span>
      </div>
      <div>
        <h3 class="text-sm font-semibold text-gp-ink mb-2">
          修改建议
        </h3>
        <ol
          class="list-decimal pl-5 space-y-2 text-sm text-gp-ink leading-relaxed"
        >
          <li v-for="(s, i) in reviewResult.suggestions" :key="i">
            {{ s }}
          </li>
        </ol>
      </div>
    </div>

    <p v-if="!hasAny" class="gp-callout-warn mb-4">
      暂无解析内容。请从文档入口完成「准备评审」。
    </p>
    <p v-else class="text-xs text-gp-faint mb-6 max-w-[65ch]">
      本页不重复展示解析正文；需看摘要或全文请点页顶「返回解析预览」。
    </p>
  </div>
</template>
