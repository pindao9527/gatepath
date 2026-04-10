import { createApp } from "vue";
import "@unocss/reset/tailwind-compat.css";
import "virtual:uno.css";
import "markstream-vue/index.css";
import "./styles.css";
import App from "./App.vue";
import router from "./router";

createApp(App).use(router).mount("#app");
