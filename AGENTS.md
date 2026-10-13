# AGENTS.md · QQ幻想脚本助手 — AI 编码规范

> 本文件是本仓库**唯一权威**的编码规范。任何 AI 工具（Trae / Kimi Code / Cursor / Claude Code / Copilot）在生成或修改代码前，必须先读完本文件并遵守。
>
> ⚠️ `README.md` 的「目录结构」停留在 P1 脚手架阶段（`workers/` 目录已迁到 `electron/workers/`，根目录下已不存在），**以本文件为准**。

---

## 0. 动手之前

1. **先读代码再改**：改动前先读目标文件与它的邻居，沿用同一目录已有的写法、命名、注释风格。
2. **不臆造**：不确定某个 API、依赖、文件是否存在时，先 `Grep`/`Read` 确认。新增依赖前必须确认它已在 `package.json` 中，否则先问用户。
3. **最小改动**：只做被要求的事。不顺手重构、不顺手改格式、不新增测试文件、不新增 `*.md` 文档（除非用户明确要求）。
4. **注释用中文**：与全仓风格一致。不要写「改了什么/为什么改」这类解释性废话，只在代码看不出「为什么」时补一句。

---

## 1. 项目是什么

QQ幻想（游戏）多窗口并行挂机助手，本地桌面工具。Electron 主进程 + 每游戏窗口一个子进程 + React 渲染进程，通过大漠插件（dm.dll，经 `winax`）做图色识别与键鼠模拟。

- 栈：Electron 32 / Vite 5 / React 18 / TypeScript 5.6 / Tailwind 3.4 / zustand 5 / pino
- 三端运行环境：主进程（Node + CJS）、子进程 utilityProcess（Node + CJS）、渲染进程（浏览器 + ESM）
- 平台：仅 Windows（依赖 winax、dm.dll、UAC 管理员权限）

---

## 2. 验证与「完成」标准

改完代码必须保证下面这条命令通过：

```bash
npm run typecheck && npm run lint
```

> `npm run verify` = 上面两条 + `npm run format:check`。
> ⚠️ `format:check` 目前**对全仓是红的**：有 36 个历史遗留文件没按 Prettier 格式化（`task-configs/*.json`、部分 `core/` `electron/` `renderer/` 源码、`scripts/race-test.js`）。**不要顺手去格式化这些文件**，那会把无关改动混进提交。
> 只要求你**新建/修改的文件**格式正确：用 `npx prettier --write <你改的文件>`。**不要**执行 `npm run format`，它会重排那 36 个历史文件。

其他常用命令：

| 命令                                  | 作用                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                         | 同时起 vite + 编译主进程 + 起 electron                           |
| `npm run build:main`                  | 只编主进程/子进程（`electron/tsconfig.json` → `dist-electron/`） |
| `npm run build:renderer`              | 只编渲染进程（vite → `dist/`）                                   |
| `npm run build`                       | 全量构建                                                         |
| `npm run lint:fix` / `npm run format` | 自动修 lint / 格式化（`format` 慎用，见上）                      |

- **本项目没有测试框架**（无 vitest/jest、无 `*.test.*`、`package.json` 无 `test` 脚本）。**不要新增测试文件或测试框架**，验证靠 `typecheck + lint` 与 `npm run dev` 手动跑通。
- 改完主进程或子进程后，还要确认 `npm run build:main` 能过——它验证真实产物路径，而 `typecheck` 不产出文件。

---

## 3. 分层与目录职责

```
electron/            主进程（CJS，编到 dist-electron/electron/）
├── main.ts          入口：生命周期、窗口创建、所有 ipcMain.handle 注册点
├── preload.ts       contextBridge 暴露 window.fohelp
├── services/        主进程服务（单例式管理器，见 §9）
└── workers/         子进程（utilityProcess）
    ├── game-utility-worker.ts   子进程入口
    └── game-worker/             context / bootstrap / commands / tasks / resupply

core/                跨端核心引擎（同时被渲染端与主/子进程引用）
├── platform/        底层能力抽象：IVisionProvider / IInputProvider + damoo 实现  ← 只依赖接口
├── perception/      屏幕像素 → 结构化实体（OCR / 找色识别）
├── combat/          战斗状态机与目标选择
├── navigation/      地图坐标校准与移动
├── state/           游戏数值状态辅助类（读 HP/MP、技能冷却）
├── interrupt/       弹框中断框架（看门狗 + 检测器 + 处理器）
├── constant-ocr/    大漠实测坐标/颜色常量表（纯数据，无逻辑）
└── utils/           纯函数小工具

shared/              跨端类型与常量（types.ts / ipc-channels.ts / npc.ts / game-hotkeys.ts / key-combo.ts）
renderer/            React 渲染进程（ESM）——components / store / types.ts / icons.ts
docs/                DESIGN.md（设计）、TASKS.md（任务）、react-electron-flow.md（数据流）
```

**依赖方向（自下而上，禁止反向）**：`platform`（原语）→ `perception`（识别）→ `combat` / `navigation`（决策）→ 子进程任务。高层的类型可以依赖低层的类型，低层永远不要 import 高层。

---

## 4. 硬约束（违反会直接把程序跑挂）

### 4.1 import 一律用相对路径，禁用 `@core` / `@shared` / `@renderer` 别名

别名叫法只配在 `tsconfig.json` / `vite.config.ts` 里，**源码中一处都没用过，也不要开始用**。
原因见 `core/interrupt/detectors.ts:10-11`：`core/` 与 `electron/` 是 tsc 直出 CommonJS，没有打包器改写别名，写成 `'@core/utils/parse'` 会在子进程 `require` 阶段直接 `MODULE_NOT_FOUND` 崩溃。

```ts
// ✅
import { parseFindColor } from '../utils/parse';
import type { ScriptStatus } from '../../shared/types';

// ❌ 会在子进程/主进程运行时崩
import { parseFindColor } from '@core/utils/parse';
```

相对导入不带 `.js` 后缀。

### 4.2 `core/` 与 `shared/` 是双端共享代码，必须同时能被 CJS 与 ESM 消费

它们会被两套 tsconfig 编译：渲染端走 vite（ESM/bundler，有 DOM），主进程/子进程走 `tsc`（CommonJS，无 DOM）。因此：

- **禁止** `import.meta`、顶层 `await`、`import()` 动态导入只在 ESM 下可用的写法。
- **禁止**在 `core/` 里直接引用 DOM API（`document`、`window` 仅允许在 `core/logger.ts` 做环境探测，那是既有特例）。
- 需要环境的模块要显式分支，例如 `core/logger.ts` 通过 `globalThis.window` 判断是渲染端还是 Node 端再降级。
- `node:*` / `fs` / `path` / `stream` / `winax` 这类 Node 专属 import 只允许出现在 Node-only 的模块里，并且该模块不得被渲染进程 import（见 4.3）。

### 4.3 渲染进程不得 import Node/Windows-only 模块

以下模块是 Node/Windows 专属，`renderer/` 里**绝对不要** import：

- `core/platform/damoo/**`（用 `require('winax')`）
- `core/interrupt/handlers.ts`（用 `fs` / `os` / `path`）
- `core/logger.ts`、`core/logger-format.ts`（用 `path` / `stream`）
- `electron/**`、任何 `node:*`

渲染端只能引用 `core/` 里的**纯数据 / 纯逻辑**模块，现有做法是只引 `core/constant-ocr/*`。若渲染端确实需要某个 type，把类型放 `shared/types.ts`。

### 4.4 用 `utilityProcess`，不要引入 `worker_threads`

每个游戏窗口跑一个**独立 OS 进程**（`electron.workers/game-utility-worker.js`）。原因见 `electron/services/worker-manager.ts:1-11`：dm.dll 是 in-process COM，内部有进程级绑定表和 Win32 低级键鼠 hook，`worker_threads` 同进程内会互相踩 hook 导致闪退。新增子进程能力请沿用 `utilityProcess` + `postMessage`。

---

## 5. 命名与文件约定

| 对象                     | 约定                                               | 例子                                                         |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| 含导出类的文件           | **PascalCase，且与类同名**                         | `CombatEngine.ts`、`MovementController.ts`                   |
| 纯函数 / 常量 / 接口模块 | **kebab-case**                                     | `dm-api.ts`、`captcha-solver.ts`、`map/qiu-feng-yuan-120.ts` |
| React 组件               | **PascalCase.tsx**                                 | `WindowCard.tsx`、`TaskConfigDialog.tsx`                     |
| 非组件前端模块           | 小写 / camelCase                                   | `useStore.ts`、`farm-maps.ts`、`icons.ts`                    |
| 类 / 类型                | PascalCase                                         | `InterruptWatcher`、`MapPosition`                            |
| 能力接口（可替换实现）   | 加 `I` 前缀                                        | `IVisionProvider`、`IInputProvider`                          |
| 数据结构接口             | **不加**前缀                                       | `PopupMatch`、`CombatContext`                                |
| 常量                     | SCREAMING_SNAKE_CASE                               | `COLOR_WHITE`、`DEFAULT_SIM`                                 |
| 联合类型代替 enum        | 优先字符串字面量联合；**enum 仅用于 IPC 通道常量** | `type MoveStyle = 'walk' \| 'run'`                           |

**导出**：统一**具名导出** `export class/function/const/interface`。默认导出是例外，仅两处：`core/logger-format.ts`（pino transport 要求）与 `renderer/App.tsx`。

**barrel 文件**：非必要不加 `index.ts`。目前全仓只有 `core/interrupt/index.ts`（以及任务注册表 `tasks/index.ts`，那是注册用途）。其他地方都按具体文件 deep import。

**NPC 名称与对话配方**：NPC 名称只在 `shared/npc.ts` 维护（中文名 + 旧英文 id 归一），界面用 `NPC_OPTIONS` / `npcSelectOptions()` 出下拉，新增 NPC = 在 `NPC` 表加一行。`TownProfileNpc.recipeName` 显式引用一份 dialog-recipe 的任务名——**不要用 NPC 名字隐式匹配配方**；补给流程按档案顺序依次访问所有配了 recipeName 的 NPC。

---

## 6. 日志

统一走 `core/logger.ts` 的 `createLogger(component)`，底层是懒加载的 pino 单例（`.child({ component })`）：

```ts
import { createLogger } from '../logger';           // 相对路径，注意层数
const log = createLogger('navigation.movement');     // 小写点分，域.子域
log.info(...); log.warn(...); log.error(...);
```

- component 名用小写点分前缀，与目录/职责对应：`navigation.movement`、`perception.monster`、`damoo.input`、`worker-manager`。
- **不要**自己 `new pino()`、不要 `console.log` 当业务日志（既有少量 console 是历史遗留，别扩散）。
- 渲染端同样 `import { createLogger }` 即可，logger 会自动降级为 console 包装。

---

## 7. 错误处理

风格是「**边界抛错，业务循环吞错续跑**」：

- 允许 `throw` 的场景：平台层不可恢复错误、编程错误（如传入不支持的按键、Capture 失败）。
- **业务主循环 / 看门狗 / 检测器必须 `try/catch`**：捕获后 `log.error` 然后继续或降级，绝不允许单个检测器/单条规则抛异常打断整个循环（参考 `InterruptWatcher`「单个检测器抛错不能打死看门狗」）。
- 工具函数失败返回 `null` / `false`（如 `core/utils/parse.ts` 的 `parseTextPos`），不抛。
- 没有 `Result<T>` 类型，不要引入。
- IPC handler **不要 throw**，返回 `{ ok: false, error }` 结构（见 §8）。
- 主/子进程已有全局 `uncaughtException` / `unhandledRejection` 兜底，别再另起一套。

---

## 8. IPC：新增一个通道要改 4 个文件

**通道常量只定义在 `shared/ipc-channels.ts`**，命名 `域:动作`（`window:list` / `worker:start` / `task:save`）。请求用 `ipcMain.handle` + `ipcRenderer.invoke`；推送用 `webContents.send` + `ipcRenderer.on`。

新增一个 renderer→main 的通道，**四处都要改，缺一不可**：

1. `shared/ipc-channels.ts` — 在 `RequestChannel`（请求）或 `PushChannel`（推送）enum 里加常量；
2. `electron/main.ts` — 在 `setupIpc()` 里加 `ipcMain.handle(...)`，用 `try/catch` 包住并返回 `{ ok, error? }`；
3. `electron/preload.ts` — 在 `api` 对象加 camelCase 方法（内部 `ipcRenderer.invoke`）；
4. `renderer/types.ts` — 在 `FohelpAPI` 补同名方法签名。

约定：

- **禁止在业务代码里硬编码通道字符串**。现存 3 处历史破例（`thumbnail:recapture`、`worker:capture-test`、`shell:showItemInFolder`）不要效仿。
- preload 暴露的 `onXxx` 订阅**必须返回取消订阅闭包**（既有 `onPush()` 已封装，照用）。
- 跨端数据结构放 `shared/types.ts`；`window.fohelp` 的接口类型手写在 `renderer/types.ts`（与 preload 的 `api` 需人工保持一致）。

---

## 9. 子进程（utilityProcess）约定

- 入口：`dist-electron/electron/workers/game-utility-worker.js`，路径用 `path.join(app.getAppPath(), 'dist-electron', 'electron', 'workers', ...)` 解析。
- 启动参数通过 **`process.argv` 传 JSON 字符串**（`JSON.stringify` 作唯一 argv），子进程 `JSON.parse(process.argv[process.argv.length - 1])`。
- 通信：父→子统一 `{ type: 'command', command: 'start-task' | 'stop' | 'pause' | 'resume' | 'screenshot' | 'read-position', ... }`；子→父 `{ type: 'state' | 'log' | 'error' | 'interrupt' | 'notify' | 'thumbnail' | 'position' | 'ready' }`（`notify` = 请求主进程弹一次系统通知，见 `electron/services/notification-service.ts`）。父↔子消息目前无共享 TS 类型，靠约定 + 注释，改时两边同步。
- **`ready` 握手时序**：子进程必须在**顶层同步代码末尾**立即发 `{ type: 'ready' }`（不能等 async main resolve），父进程要等收到 `ready` 才 `postMessage`。
- Electron 32 的 UtilityProcess 会把父→子消息包成 `MessageEvent`，收端要解包 `event.data`。
- **清理方法命名**：管理器用 `stop()`（优雅）/ `kill()`（强杀）/ `shutdownAll()`（批量）；缓存用 `clear()` / `clearAll()`。**不要用 `dispose()`**。
- 一次性请求（截图、读坐标等）必须成对 `setTimeout` + `clearTimeout`，并在 resolve/reject 时 `off('message')` 注销监听。

---

## 10. 新增挂机任务

任务插件在 `electron/workers/game-worker/tasks/`：

1. 新建 `tasks/xxx.ts`，实现 `TaskFactory`（返回 `TaskController`，控制器可选实现 `pause?/resume?/stop?`）；
2. 在 `tasks/index.ts` 的 `TASK_RUNNERS` 注册表加一行；
3. `TaskType` 本体在 `shared/types.ts` 定义。

未注册的任务类型**要显式报错停在 alert 状态，不要静默回退**（现有 `unregisteredTask` 就是这么做的）。

---

## 11. 渲染进程（React）约定

- **函数组件 + hooks，禁止 `React.FC`**（全仓零使用）。props 用局部 `interface Props`（主组件）或具名导出的 `XxxProps`（可复用子组件）。
- 组件用**具名导出** `export function Xxx`；仅 `App.tsx` 默认导出。
- **状态一律走 `renderer/store/useStore.ts`**（单一 zustand store，无切片）。组件里逐字段取 `useStore((s) => s.xxx)`；非组件上下文用 `useStore.getState()`。
  - state 用复数小写（`workers` / `thumbnails`）；action 动词开头（`refreshWindows` / `bootstrapWorker`）。
  - 异步 action 返回 `{ ok, error? }`。
  - Map / 数组更新**必须不可变复制**：`set((prev) => { const next = new Map(prev.x); ... })`。
- **调用主进程只经 `window.fohelp`**，调用前先判空 `if (!window.fohelp) return`，`invoke` 用 `try/catch` 转成 `{ ok: false, error }`。
- **IPC 事件订阅只在 `subscribeToIpc()` 里注册**（在 `App.tsx` 的 `useEffect` 中调用一次），不要在组件里各自 `window.fohelp.onXxx`。
- **图标只能从 `renderer/icons.ts` 深路径导入**：`import { X } from '../icons'`。**禁止** `import { X } from 'lucide-react'`——那会把 1500+ 图标打进首屏 chunk（约 1.1MB）。新增图标在 `icons.ts` 追加一行 re-export，类型由 `lucide-icons.d.ts` 通配提供。
- 大组件懒加载：超大组件（如 `TaskConfigDialog.tsx`）用 `lazy(() => import(...))` 避免进首屏模块图。
- ESLint 对 `renderer/**` 关闭了 `react-hooks/exhaustive-deps`，但仍应尽量写全依赖。

---

## 12. 样式

- 用 Tailwind **语义 token**，不写裸色值：`bg-bg-card`、`text-text-muted`、`border-border-base`、`accent-cyan` 等，token 定义在 `tailwind.config.js` 的 `theme.extend.colors`。新增颜色先加 token 再用。
- 复用 `index.css` 里 `@layer components` 的语义类：`.btn` / `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.card`。
- 条件类名可用 `clsx`（已有依赖）或数组 `.join(' ')`，两者都在用，无强制。

---

## 13. 格式、编码与提交

- **Prettier**（`.prettierrc`，会被 `format:check` 卡）：单引号、分号、2 空格、`trailingComma: all`、`printWidth: 140`、箭头函数带括号、**LF 换行**。写完直接 `npm run format`。
- **编码**：源码统一 UTF-8 + LF（`.gitattributes` 强制 `eol=lf`）。不要写出 GBK/CRLF 文件。
- **提交信息**：中文、**不加** `feat:`/`fix:` 前缀，直述改动，如「完善城镇逻辑」「修复启动慢的问题」「新增流花径打怪」。不要把多个不相关改动塞进一个提交。

---

## 14. 禁区

- **`.deprecated/`**：旧代码/旧构建产物，未纳入 git、已被 eslint 忽略。**不要读它当参考、不要 import、不要改**。
- **不要新增测试框架/测试文件**（项目无测试体系）。
- **不要新增 `*.md` 文档**，除非用户明确要求。
- **不要擅自加依赖或改 `package.json`**；缺能力先说清楚，别默默装包。
- **不要改 `dist/`、`dist-electron/`** 等构建产物（那是编译输出）。
- 根目录 `需要解决的问题.txt` 是待办清单、`ai-descrip.txt` 是需求草稿，**不是规范**，别当约束。
