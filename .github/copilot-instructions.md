# Copilot 指令 · fo-help（QQ幻想挂机助手）

本仓库的编码规范统一维护在根目录 [`AGENTS.md`](../AGENTS.md)，生成或修改代码前请先读它，并遵守其中的全部约定。

关键约束（详见 `AGENTS.md`）：

1. **import 一律用相对路径**，禁用 `@core` / `@shared` / `@renderer` 别名（会因子进程 CommonJS 环境崩溃）。
2. `core/` 与 `shared/` 是渲染端（ESM）与主进程（CommonJS）共享代码：禁止 `import.meta`、顶层 `await`、DOM API。
3. 渲染进程不得 import `core/platform/damoo/**`、`core/interrupt/handlers.ts`、`core/logger*.ts`、`electron/**`、`node:*`。
4. 子进程用 Electron `utilityProcess`，不要用 `worker_threads`。
5. 新增 IPC 通道必须同步修改：`shared/ipc-channels.ts` → `electron/main.ts` 的 `setupIpc()` → `electron/preload.ts` → `renderer/types.ts`。
6. React 用函数组件 + hooks（禁 `React.FC`）；状态走 `renderer/store/useStore.ts`；只经 `window.fohelp` 调主进程；图标只能从 `renderer/icons.ts` 导入；样式用 Tailwind 语义 token。
7. 改完执行 `npm run typecheck` 和 `npm run lint`，必须通过。项目无测试框架，不要新增测试文件。仓库有 36 个历史遗留文件未过 Prettier（`format:check` 全仓为红），只格式化你自己改动的文件，不要跑全量 `npm run format`。
8. 不要修改 `.deprecated/`，不要擅自新增依赖或新增 `*.md` 文档。
9. 提交信息用中文，不加 `feat:` / `fix:` 前缀。
