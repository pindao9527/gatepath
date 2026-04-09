<script setup lang="ts">
import { onMounted } from "vue";
import { useSettings } from "../composables/useSettings";

const {
  baseUrl,
  apiKey,
  model,
  useKeyringForApiKey,
  loaded,
  loadError,
  saving,
  load,
  save,
} = useSettings();

onMounted(() => {
  void load();
});
</script>

<template>
  <div
    class="mx-auto max-w-2xl w-full px-4 py-8 text-left font-sans text-[#0f0f0f] dark:text-[#f6f6f6]"
  >
    <h1 class="text-xl font-semibold tracking-tight mb-1">API 配置</h1>
    <p class="text-sm text-[#666] dark:text-[#aaa] mb-8">
      Base URL 与 Model 保存在本应用数据目录；API Key 可选写入系统钥匙串（macOS
      钥匙串等），关闭后不会在磁盘保存密钥。
    </p>

    <p
      v-if="loadError"
      class="mb-4 text-sm text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ loadError }}
    </p>

    <div v-if="!loaded" class="text-sm text-[#666] dark:text-[#aaa]">
      正在加载设置…
    </div>

    <div v-else class="space-y-6">
      <div>
        <label
          for="base-url"
          class="block text-sm font-medium mb-2 text-[#333] dark:text-[#ccc]"
          >Base URL</label
        >
        <input
          id="base-url"
          v-model="baseUrl"
          type="url"
          autocomplete="off"
          placeholder="https://api.openai.com/v1"
          class="w-full rounded-lg border border-[#e0e0e0] dark:border-[#444] px-3 py-2.5 text-sm bg-white dark:bg-[#1a1a1a] outline-none focus:border-[#396cd8] transition-colors"
        />
      </div>

      <div class="flex items-start gap-3">
        <input
          id="use-keyring"
          v-model="useKeyringForApiKey"
          type="checkbox"
          class="mt-1 rounded border-[#e0e0e0] dark:border-[#444]"
        />
        <label for="use-keyring" class="text-sm text-[#333] dark:text-[#ccc]">
          将 API Key 存入系统钥匙串
        </label>
      </div>

      <div>
        <label
          for="api-key"
          class="block text-sm font-medium mb-2 text-[#333] dark:text-[#ccc]"
          >API Key</label
        >
        <input
          id="api-key"
          v-model="apiKey"
          type="password"
          autocomplete="off"
          :placeholder="
            useKeyringForApiKey ? 'sk-…' : '仅本次运行有效，关闭应用后需重新填写'
          "
          class="w-full rounded-lg border border-[#e0e0e0] dark:border-[#444] px-3 py-2.5 text-sm bg-white dark:bg-[#1a1a1a] outline-none focus:border-[#396cd8] transition-colors font-mono"
        />
        <p
          v-if="!useKeyringForApiKey"
          class="mt-1.5 text-xs text-[#888] dark:text-[#777]"
        >
          未启用钥匙串时不会在磁盘保存密钥；可仅在当前会话填写供后续评审使用。
        </p>
      </div>

      <div>
        <label
          for="model"
          class="block text-sm font-medium mb-2 text-[#333] dark:text-[#ccc]"
          >Model</label
        >
        <input
          id="model"
          v-model="model"
          type="text"
          autocomplete="off"
          placeholder="gpt-4o-mini"
          class="w-full rounded-lg border border-[#e0e0e0] dark:border-[#444] px-3 py-2.5 text-sm bg-white dark:bg-[#1a1a1a] outline-none focus:border-[#396cd8] transition-colors"
        />
      </div>

      <div class="pt-2">
        <button
          type="button"
          class="rounded-lg bg-[#396cd8] text-white text-sm font-medium px-4 py-2.5 hover:bg-[#2f5ac4] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="saving"
          @click="save()"
        >
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </div>
    </div>
  </div>
</template>
