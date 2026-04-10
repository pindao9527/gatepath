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
    class="relative min-h-dvh flex flex-col font-sans text-base leading-6 font-normal antialiased text-gp-ink bg-gp-canvas bg-gradient-to-b from-gp-canvas to-gp-canvas-2 dark:from-gp-canvas dark:to-gp-canvas-2 overflow-x-hidden"
  >
    <!-- 氛围光：固定层，不参与滚动重绘主体 -->
    <div
      class="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      <div
        class="absolute -top-40 -right-16 h-[28rem] w-[28rem] rounded-full bg-white/45 blur-3xl dark:bg-white/[0.07]"
      />
      <div
        class="absolute -bottom-24 -left-20 h-[22rem] w-[26rem] rounded-full bg-white/35 blur-3xl dark:bg-white/[0.055]"
      />
    </div>

    <div class="gp-grain" aria-hidden="true" />

    <header
      class="relative z-20 shrink-0 border-b border-gp-border/90 bg-gp-elevated/95 backdrop-blur-xl shadow-[0_1px_0_var(--gp-shadow),inset_0_1px_0_rgba(255,255,255,0.06)] dark:shadow-[0_1px_0_var(--gp-shadow),inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div
        class="h-px w-full bg-gradient-to-r from-transparent via-gp-accent/35 to-transparent"
        aria-hidden="true"
      />
      <nav
        class="mx-auto max-w-7xl w-full min-w-0 px-4 sm:px-6 lg:px-10 min-h-[3.75rem] py-3 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-evenly md:gap-x-6 md:gap-y-3"
        aria-label="主导航"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span
            class="font-mono text-[0.62rem] font-medium uppercase tracking-[0.22em] text-gp-faint"
          >
            Gatepath
          </span>
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span class="text-lg font-semibold tracking-tight text-gp-ink">
              门径
            </span>
            <span
              class="text-xs font-normal text-gp-muted max-w-full sm:max-w-[20rem] leading-snug"
            >
              需求与测试文档的本地评审
            </span>
          </div>
        </div>

        <div
          class="flex shrink-0 items-center gap-1.5 self-start rounded-full border border-gp-border/90 bg-gp-surface/85 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md dark:bg-gp-surface/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] md:self-auto"
        >
          <RouterLink
            :to="{ name: 'review-input' }"
            class="rounded-full px-4 py-2 text-sm font-medium no-underline text-gp-muted transition-all duration-200 ease-out hover:text-gp-ink hover:bg-gp-canvas/80 dark:hover:bg-gp-canvas/40 active:scale-[0.98] gp-focus"
            :class="
              isHomeNavActive
                ? 'bg-gp-accent-dim text-gp-accent font-semibold shadow-sm'
                : ''
            "
          >
            首页
          </RouterLink>
          <RouterLink
            to="/settings"
            class="rounded-full px-4 py-2 text-sm font-medium no-underline text-gp-muted transition-all duration-200 ease-out hover:text-gp-ink hover:bg-gp-canvas/80 dark:hover:bg-gp-canvas/40 active:scale-[0.98] gp-focus [&.router-link-active]:bg-gp-accent-dim [&.router-link-active]:text-gp-accent [&.router-link-active]:font-semibold [&.router-link-active]:shadow-sm"
            active-class="router-link-active"
          >
            设置
          </RouterLink>
        </div>
      </nav>
    </header>

    <main class="relative z-10 flex-1 min-h-0 flex flex-col">
      <RouterView v-slot="{ Component }">
        <Transition name="gp-view" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
