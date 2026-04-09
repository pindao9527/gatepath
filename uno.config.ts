import { defineConfig, presetUno } from "unocss";

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      gp: {
        canvas: "var(--gp-canvas)",
        "canvas-2": "var(--gp-canvas-2)",
        elevated: "var(--gp-elevated)",
        surface: "var(--gp-surface)",
        ink: "var(--gp-ink)",
        muted: "var(--gp-muted)",
        faint: "var(--gp-faint)",
        border: "var(--gp-border)",
        accent: "var(--gp-accent)",
        "accent-hover": "var(--gp-accent-hover)",
        "accent-active": "var(--gp-accent-active)",
        "accent-dim": "var(--gp-accent-dim)",
      },
    },
    fontFamily: {
      sans:
        '"Outfit","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif',
      mono:
        '"JetBrains Mono","SF Mono",ui-monospace,"PingFang SC",monospace',
    },
    boxShadow: {
      gp: "0 1px 2px var(--gp-shadow), 0 8px 24px var(--gp-shadow)",
      "gp-inset": "inset 0 1px 0 rgba(255,255,255,0.06)",
    },
  },
  shortcuts: {
    "gp-focus":
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gp-accent",
    "gp-input":
      "w-full rounded-lg border border-gp-border bg-gp-surface px-3 py-2.5 text-sm text-gp-ink placeholder:text-gp-faint outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-gp-accent focus-visible:ring-2 focus-visible:ring-gp-accent-dim",
    "gp-btn":
      "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-200 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "gp-btn-primary":
      "gp-btn gp-focus bg-gp-accent text-white shadow-gp-inset hover:bg-gp-accent-hover active:bg-gp-accent-active",
    "gp-btn-secondary":
      "gp-btn gp-focus border border-gp-border bg-gp-surface text-gp-ink shadow-sm hover:bg-gp-canvas",
    "gp-page-wrap":
      "relative z-10 mx-auto w-full max-w-[min(100%,52rem)] px-5 pt-12 pb-16 text-left text-gp-ink sm:px-8 md:pt-16 md:pb-20 md:border-l-2 md:border-gp-accent/20 md:pl-10 lg:pl-14 lg:max-w-[min(100%,56rem)]",
    /** 评审台：流式对话与多列表格需要更宽阅读宽度 */
    "gp-page-wrap-wide":
      "lg:max-w-[min(100%,72rem)] xl:pl-16",
    "gp-page-head":
      "mb-10 md:mb-12",
    "gp-kicker":
      "font-mono text-[0.65rem] font-medium uppercase tracking-[0.2em] text-gp-faint mb-3",
    "gp-title":
      "text-2xl sm:text-[1.85rem] font-semibold tracking-tight leading-[1.2] text-balance text-gp-ink",
    "gp-lead":
      "text-base font-normal leading-relaxed text-gp-muted max-w-[65ch] text-pretty",
    "gp-workflow-crumb":
      "font-mono text-[0.7rem] text-gp-faint mb-6 flex flex-wrap items-center gap-x-2 gap-y-1",
    "gp-label":
      "block text-sm font-medium text-gp-ink mb-1.5",
    "gp-helper":
      "text-xs text-gp-faint mt-1.5 leading-snug max-w-[65ch]",
    "gp-panel":
      "rounded-2xl border border-gp-border/90 bg-gp-elevated/80 dark:bg-gp-elevated/55 backdrop-blur-md p-5 md:p-6 shadow-[0_14px_44px_-20px_var(--gp-shadow),inset_0_1px_0_rgba(255,255,255,0.07)] dark:shadow-[0_14px_44px_-22px_var(--gp-shadow),inset_0_1px_0_rgba(255,255,255,0.04)]",
    "gp-panel-quiet":
      "rounded-2xl border border-gp-border/70 bg-gp-surface/50 dark:bg-gp-surface/35 p-4 md:p-5 shadow-sm",
    "gp-code":
      "text-xs px-1.5 py-0.5 rounded-md bg-gp-accent-dim text-gp-ink font-mono",
    "gp-callout-warn":
      "text-sm rounded-xl border border-amber-200/90 dark:border-amber-900/70 bg-amber-50/95 dark:bg-amber-950/45 text-amber-950 dark:text-amber-100/95 px-4 py-3 leading-relaxed",
    "gp-callout-info":
      "text-sm rounded-xl border border-sky-200/85 dark:border-sky-900/65 bg-sky-50/90 dark:bg-sky-950/40 text-sky-950 dark:text-sky-100/95 px-4 py-3 leading-relaxed",
    "gp-callout-muted":
      "text-sm rounded-xl border border-gp-border/90 bg-gp-surface/60 dark:bg-gp-surface/30 text-gp-ink px-4 py-3 leading-relaxed",
    "gp-inline-error":
      "text-sm text-red-600 dark:text-red-400",
    "gp-pre-block":
      "max-h-[min(50dvh,26rem)] overflow-auto rounded-xl border border-gp-border/90 bg-gp-surface/90 dark:bg-gp-surface/50 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words text-gp-ink font-mono shadow-inner",
    "gp-action-bar":
      "flex flex-wrap items-center gap-3 pt-1",
    "gp-skeleton-bar":
      "rounded-lg bg-gp-border/45 dark:bg-gp-border/35 animate-pulse",
  },
});
