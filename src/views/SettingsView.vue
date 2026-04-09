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
  <div class="gp-page-wrap">
    <header class="gp-page-head">
      <p class="gp-kicker">系统</p>
      <h1 class="gp-title mb-3">API 配置</h1>
      <p class="gp-lead">
        Base URL 与 Model 保存在本应用数据目录；API Key 可选写入系统钥匙串（macOS
        钥匙串等），关闭后不会在磁盘保存密钥。
      </p>
    </header>

    <p v-if="loadError" class="gp-inline-error mb-6" role="alert">
      {{ loadError }}
    </p>

    <div
      v-if="!loaded"
      class="gp-panel-quiet space-y-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div class="h-3 w-28 gp-skeleton-bar" />
      <div class="h-10 w-full gp-skeleton-bar" />
      <div class="h-3 w-36 gp-skeleton-bar" />
      <div class="h-10 w-full gp-skeleton-bar" />
      <p class="text-xs text-gp-faint font-mono">正在加载设置…</p>
    </div>

    <div v-else class="gp-panel space-y-8">
      <div class="space-y-2">
        <label for="base-url" class="gp-label">Base URL</label>
        <input
          id="base-url"
          v-model="baseUrl"
          type="url"
          autocomplete="off"
          placeholder="https://api.openai.com/v1"
          class="gp-input"
        />
      </div>

      <div
        class="flex items-start gap-3 rounded-xl border border-gp-border/60 bg-gp-surface/40 dark:bg-gp-canvas/30 px-3 py-3"
      >
        <input
          id="use-keyring"
          v-model="useKeyringForApiKey"
          type="checkbox"
          class="mt-0.5 rounded border-gp-border accent-gp-accent shrink-0"
        />
        <label for="use-keyring" class="text-sm text-gp-ink leading-snug">
          将 API Key 存入系统钥匙串
        </label>
      </div>

      <div class="space-y-2">
        <label for="api-key" class="gp-label">API Key</label>
        <input
          id="api-key"
          v-model="apiKey"
          type="password"
          autocomplete="off"
          :placeholder="
            useKeyringForApiKey ? 'sk-…' : '仅本次运行有效，关闭应用后需重新填写'
          "
          class="gp-input font-mono tabular-nums"
        />
        <p v-if="!useKeyringForApiKey" class="gp-helper">
          未启用钥匙串时不会在磁盘保存密钥；可仅在当前会话填写供后续评审使用。
        </p>
      </div>

      <div class="space-y-2">
        <label for="model" class="gp-label">Model</label>
        <input
          id="model"
          v-model="model"
          type="text"
          autocomplete="off"
          placeholder="gpt-4o-mini"
          class="gp-input"
        />
      </div>

      <div class="gp-action-bar border-t border-gp-border/70 pt-6">
        <button
          type="button"
          class="gp-btn-primary px-5 py-2.5"
          :disabled="saving"
          @click="save()"
        >
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </div>
    </div>
  </div>
</template>
