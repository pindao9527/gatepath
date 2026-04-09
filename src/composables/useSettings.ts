import { ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import {
  deletePassword,
  getPassword,
  setPassword,
} from "tauri-plugin-keyring-api";

const STORE_FILE = "gatepath_settings.json";
const KEY_BASE_URL = "baseUrl";
const KEY_MODEL = "model";
const KEY_USE_KEYRING = "useKeyringForApiKey";

/** 与 `tauri.conf.json` 中 `identifier` 一致，用于钥匙串条目命名 */
export const KEYRING_SERVICE = "com.gatepath.app";
export const KEYRING_USER = "openai_api_key";

export function useSettings() {
  const baseUrl = ref("");
  const apiKey = ref("");
  const model = ref("");
  /** 开启后将 API Key 写入系统钥匙串；关闭则不在本机保存密钥（仅本次会话输入有效） */
  const useKeyringForApiKey = ref(true);
  const loaded = ref(false);
  const loadError = ref<string | null>(null);
  const saving = ref(false);

  async function load() {
    loadError.value = null;
    if (!isTauri()) {
      loaded.value = true;
      return;
    }
    try {
      const store = await Store.load(STORE_FILE);
      const bu = await store.get<string>(KEY_BASE_URL);
      const m = await store.get<string>(KEY_MODEL);
      const uk = await store.get<boolean>(KEY_USE_KEYRING);
      baseUrl.value = typeof bu === "string" ? bu : "";
      model.value = typeof m === "string" ? m : "";
      useKeyringForApiKey.value = uk !== false;

      if (useKeyringForApiKey.value) {
        const k = await getPassword(KEYRING_SERVICE, KEYRING_USER);
        apiKey.value = k ?? "";
      } else {
        apiKey.value = "";
      }
    } catch (e) {
      loadError.value =
        e instanceof Error ? e.message : "加载设置失败，请重试或检查权限。";
    } finally {
      loaded.value = true;
    }
  }

  async function save() {
    if (!isTauri()) return;
    saving.value = true;
    loadError.value = null;
    try {
      const store = await Store.load(STORE_FILE);
      await store.set(KEY_BASE_URL, baseUrl.value);
      await store.set(KEY_MODEL, model.value);
      await store.set(KEY_USE_KEYRING, useKeyringForApiKey.value);
      await store.save();

      if (useKeyringForApiKey.value) {
        if (apiKey.value) {
          await setPassword(KEYRING_SERVICE, KEYRING_USER, apiKey.value);
        } else {
          await deletePassword(KEYRING_SERVICE, KEYRING_USER);
        }
      } else {
        await deletePassword(KEYRING_SERVICE, KEYRING_USER);
      }
    } catch (e) {
      loadError.value =
        e instanceof Error ? e.message : "保存失败，请重试或检查权限。";
    } finally {
      saving.value = false;
    }
  }

  return {
    baseUrl,
    apiKey,
    model,
    useKeyringForApiKey,
    loaded,
    loadError,
    saving,
    load,
    save,
  };
}
