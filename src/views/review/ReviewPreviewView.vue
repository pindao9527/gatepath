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
  <div
    class="mx-auto max-w-2xl w-full px-4 py-8 text-left font-sans text-[#0f0f0f] dark:text-[#f6f6f6]"
  >
    <h1 class="text-xl font-semibold tracking-tight mb-1">解析预览</h1>
    <p class="text-sm text-[#666] dark:text-[#aaa] mb-6">
      以下为解析后的评审输入摘要（全文在下一步）。确认无误后可进入评审。若两侧全文合计超过约
      {{ MAX_COMBINED_REVIEW_CHARS.toLocaleString() }}
      字，评审步骤会自动按比例截断后再请求模型。
    </p>

    <template v-if="hasAny">
      <div class="space-y-8">
        <section v-if="requirementText != null && requirementText.length > 0">
          <h2 class="text-sm font-semibold text-[#333] dark:text-[#ccc]">
            需求文档（评审输入）
          </h2>
          <p
            v-if="requirementStats"
            class="text-xs text-[#666] dark:text-[#999] mb-2 tabular-nums"
          >
            共 {{ requirementStats.chars }} 字符 · UTF-8 约
            {{ requirementStats.utf8Bytes }} 字节
            <span
              v-if="requirementText.length > PREVIEW_MAX"
              class="text-amber-800 dark:text-amber-200/90"
            >
              · 此处仅预览前 {{ PREVIEW_MAX }} 字符
            </span>
          </p>
          <pre
            class="max-h-[min(50vh,24rem)] overflow-auto rounded-lg border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#1a1a1a] p-3 text-xs whitespace-pre-wrap break-words text-[#333] dark:text-[#ddd]"
            >{{ previewBody(requirementText) }}</pre
          >
        </section>
        <section v-if="testText != null && testText.length > 0">
          <h2 class="text-sm font-semibold text-[#333] dark:text-[#ccc]">
            测试文档（评审输入）
          </h2>
          <p
            v-if="testStats"
            class="text-xs text-[#666] dark:text-[#999] mb-2 tabular-nums"
          >
            共 {{ testStats.chars }} 字符 · UTF-8 约
            {{ testStats.utf8Bytes }} 字节
            <span
              v-if="testText.length > PREVIEW_MAX"
              class="text-amber-800 dark:text-amber-200/90"
            >
              · 此处仅预览前 {{ PREVIEW_MAX }} 字符
            </span>
          </p>
          <pre
            class="max-h-[min(50vh,24rem)] overflow-auto rounded-lg border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#1a1a1a] p-3 text-xs whitespace-pre-wrap break-words text-[#333] dark:text-[#ddd]"
            >{{ previewBody(testText) }}</pre
          >
        </section>
      </div>

      <div class="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-lg px-5 py-2.5 text-sm font-medium border border-[#e0e0e0] dark:border-[#444] bg-white dark:bg-[#222] text-[#333] dark:text-[#e8e8e8] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] transition-colors"
          @click="goBack"
        >
          ← 返回修改
        </button>
        <button
          type="button"
          class="rounded-lg px-5 py-2.5 text-sm font-medium cursor-pointer bg-[#396cd8] text-white hover:bg-[#2d56b3] active:bg-[#264a99] transition-colors"
          @click="goReview"
        >
          进入评审
        </button>
      </div>
    </template>
  </div>
</template>
