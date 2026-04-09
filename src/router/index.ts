import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";

/** `/`：进入壳后重定向到评审第一步 */
const homeRoute: RouteRecordRaw = {
  path: "/",
  component: () => import("../views/HomeLayout.vue"),
  meta: { title: "首页" },
  children: [
    { path: "", redirect: { name: "review-input" } },
  ],
};

/** `/review/*`：评审工作流（与 `/`、`/settings` 平级顶层路由） */
const reviewRoute: RouteRecordRaw = {
  path: "/review",
  component: () => import("../views/review/ReviewLayout.vue"),
  meta: { title: "评审打分" },
  children: [
    {
      path: "",
      redirect: { name: "review-input" },
    },
    {
      path: "input",
      name: "review-input",
      component: () => import("../views/review/ReviewInputView.vue"),
      meta: { title: "录入信息" },
    },
    {
      path: "preview",
      name: "review-preview",
      component: () => import("../views/review/ReviewPreviewView.vue"),
      meta: { title: "解析预览" },
    },
    {
      path: "review",
      name: "review-workbench",
      component: () => import("../views/review/ReviewWorkbenchView.vue"),
      meta: { title: "评审交流" },
    },
  ],
};

const settingsRoute: RouteRecordRaw = {
  path: "/settings",
  name: "settings",
  component: () => import("../views/SettingsView.vue"),
  meta: { title: "设置" },
};

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [homeRoute, reviewRoute, settingsRoute],
});

router.afterEach((to) => {
  const matchedWithTitle = [...to.matched]
    .reverse()
    .find((r) => r.meta.title != null);
  const title = matchedWithTitle?.meta.title as string | undefined;
  document.title = title ? `门径 · ${title}` : "门径";
});

export default router;
