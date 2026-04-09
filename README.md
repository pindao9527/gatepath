# gatepath（门径）

桌面端应用（**Tauri 2 + Vue 3 + Vite + TypeScript**）。围绕「需求文档 + 测试文档」做 **AI 辅助评审**：拉取与解析文档、预览、再调用 OpenAI 兼容接口输出 **0–100 分** 与 **修改建议**。

更细的进度与模块说明见 [`docs/project-status.md`](docs/project-status.md)。

## 本地开发

```bash
pnpm install
pnpm dev          # 仅前端（浏览器）
pnpm tauri dev    # 桌面端
pnpm test         # 单元测试（vitest）
pnpm run build    # 前端生产构建
```
