<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed } from "vue";

const props = defineProps<{
  /** 原始 Markdown 全文（含流式增量） */
  text: string;
  /** 是否仍在接收流式 token（为 false 时标记解析完结，减少半成品节点） */
  streaming: boolean;
  /** 与气泡绑定的唯一 id，用于样式隔离与内部缓存键 */
  bubbleKey: string;
}>();

const isFinal = computed(() => !props.streaming);
</script>

<template>
  <div
    class="tavern-md text-[0.9375rem] leading-relaxed text-gp-ink [&_a]:text-gp-accent [&_a]:underline-offset-2"
    :data-tavern-bubble="bubbleKey"
  >
    <MarkdownRender
      :custom-id="`tavern-${bubbleKey}`"
      :content="text"
      :final="isFinal"
      :render-code-blocks-as-pre="true"
      :typewriter="streaming"
      class="tavern-md-render"
    />
  </div>
</template>
