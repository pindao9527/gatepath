<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { MAX_COMBINED_REVIEW_CHARS } from "../../lib/reviewContentBudget";
import {
  SESSION_REQUIREMENT_REVIEW_INPUT,
  SESSION_TEST_REVIEW_INPUT,
} from "../../lib/reviewSession";

const router = useRouter();

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

onMounted(() => {
  refreshFromSession();
  if (!hasAny.value) {
    router.replace({ name: "review-input" });
  }
});

const PREVIEW_MAX = 1200;

function previewBody(text: string): string {
  const t = text.trim();
  if (t.length <= PREVIEW_MAX) return t;
  return `${t.slice(0, PREVIEW_MAX)}…`;
}

/** UTF-16 码元长度（与 JS .length 一致）；中文一般一字一长度 */
function textStats(text: string): { chars: number; utf8Bytes: number } {
  return {
    chars: text.length,
    utf8Bytes: new TextEncoder().encode(text).length,
  };
}

const requirementStats = computed(() =>
  requirementText.value != null ? textStats(requirementText.value) : null,
);
const testStats = computed(() =>
  testText.value != null ? textStats(testText.value) : null,
);

function goBack() {
  router.push({ name: "review-input" });
}

function goReview() {
  router.push({ name: "review-workbench" });
}
</script>

<template>
  <div class="gp-page-wrap">
    <div
      class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 mb-6"
    >
      <nav class="gp-workflow-crumb mb-0" aria-label="流程位置">
        <span class="text-gp-faint">录入</span>
        <span class="text-gp-faint" aria-hidden="true">/</span>
        <span class="text-gp-accent font-medium">预览</span>
        <span class="text-gp-faint" aria-hidden="true">/</span>
        <span class="text-gp-faint">评审</span>
      </nav>
      <div
        v-if="hasAny"
        class="flex flex-wrap items-center gap-3 shrink-0"
      >
        <button
          type="button"
          class="gp-btn-secondary px-4 py-2.5 text-sm"
          @click="goBack"
        >
          返回修改
        </button>
        <button
          type="button"
          class="gp-btn-primary px-4 py-2.5 text-sm cursor-pointer"
          @click="goReview"
        >
          进入评审
        </button>
      </div>
    </div>

    <header class="gp-page-head">
      <p class="gp-kicker">02 · 预览</p>
      <h1 class="gp-title mb-3">解析预览</h1>
      <p class="gp-lead">
        以下为解析后的评审输入摘要（全文在下一步）。确认无误后可进入评审。若两侧全文合计超过约
        <span class="font-mono tabular-nums text-gp-ink">{{
          MAX_COMBINED_REVIEW_CHARS.toLocaleString()
        }}</span>
        字，评审步骤会自动按比例截断后再请求模型。
      </p>
    </header>

    <template v-if="hasAny">
      <div
        class="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8 xl:items-start"
      >
        <section
          v-if="requirementText != null && requirementText.length > 0"
          class="gp-panel flex flex-col min-h-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 class="text-sm font-semibold tracking-tight text-gp-ink">
              需求文档（评审输入）
            </h2>
            <p
              v-if="requirementStats"
              class="text-xs text-gp-muted tabular-nums text-right"
            >
              <span class="font-mono">{{ requirementStats.chars }}</span>
              字符 · UTF-8
              <span class="font-mono">{{ requirementStats.utf8Bytes }}</span>
              字节
            </p>
          </div>
          <p
            v-if="requirementText.length > PREVIEW_MAX"
            class="gp-callout-warn text-xs mb-3"
          >
            此处仅预览前 {{ PREVIEW_MAX }} 字符；全文仍会在下一步送交模型（受截断策略约束）。
          </p>
          <pre class="gp-pre-block flex-1 min-h-0 mt-auto">{{
            previewBody(requirementText)
          }}</pre>
        </section>

        <section
          v-if="testText != null && testText.length > 0"
          class="gp-panel flex flex-col min-h-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 class="text-sm font-semibold tracking-tight text-gp-ink">
              测试文档（评审输入）
            </h2>
            <p v-if="testStats" class="text-xs text-gp-muted tabular-nums text-right">
              <span class="font-mono">{{ testStats.chars }}</span>
              字符 · UTF-8
              <span class="font-mono">{{ testStats.utf8Bytes }}</span>
              字节
            </p>
          </div>
          <p
            v-if="testText.length > PREVIEW_MAX"
            class="gp-callout-warn text-xs mb-3"
          >
            此处仅预览前 {{ PREVIEW_MAX }} 字符；全文仍会在下一步送交模型（受截断策略约束）。
          </p>
          <pre class="gp-pre-block flex-1 min-h-0 mt-auto">{{
            previewBody(testText)
          }}</pre>
        </section>
      </div>
    </template>
  </div>
</template>
