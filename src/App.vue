<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const isHomeNavActive = computed(() =>
  ["review-input", "review-preview", "review-workbench"].includes(
    route.name as string,
  ),
);
</script>

<template>
  <div
    class="min-h-screen flex flex-col font-sans text-base leading-6 font-normal antialiased bg-[#f6f6f6] dark:bg-[#1e1e1e] text-[#0f0f0f] dark:text-[#f6f6f6]"
  >
    <header
      class="shrink-0 border-b border-[#e8e8e8] dark:border-[#333] bg-white/80 dark:bg-[#252525]/90 backdrop-blur-sm"
    >
      <div
        class="mx-auto max-w-3xl w-full px-4 h-14 flex items-center justify-between gap-4"
      >
        <RouterLink
          :to="{ name: 'review-input' }"
          class="rounded-md px-3 py-1.5 text-sm no-underline text-[#555] dark:text-[#bbb] hover:bg-[#eee] dark:hover:bg-[#333]"
          :class="
            isHomeNavActive
              ? 'bg-[#e8eefc] text-[#264a99] dark:bg-[#2a3550] dark:text-[#9ec5ff]'
              : ''
          "
        >
          首页
        </RouterLink>
        <RouterLink
          to="/settings"
          class="rounded-md px-3 py-1.5 text-sm no-underline text-[#555] dark:text-[#bbb] hover:bg-[#eee] dark:hover:bg-[#333] [&.router-link-active]:bg-[#e8eefc] [&.router-link-active]:text-[#264a99] dark:[&.router-link-active]:bg-[#2a3550] dark:[&.router-link-active]:text-[#9ec5ff]"
          active-class="router-link-active"
        >
          设置
        </RouterLink>
      </div>
    </header>

    <main class="flex-1 min-h-0">
      <RouterView />
    </main>
  </div>
</template>
