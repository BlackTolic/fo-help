# React 端调用逻辑梳理

> 完整梳理 renderer/ 下所有 React 组件、state、handler,以及它们如何通过 IPC 调用 Electron 主进程能力。
>
> 最后更新:对应代码 commit `c4e3c04`

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│  Electron 主进程 (Node.js)                                     │
│    electron/main.ts — IPC handlers                           │
│    electron/services/* — 业务服务                            │
│    electron/workers/game-utility-worker.ts — utilityProcess 子进程入口 │
├──────────────────────────────────────────────────────────────┤
│  Preload (electron/preload.ts)                                  │
│    contextBridge.exposeInMainWorld('fohelp', api)             │
│    ↕ ipcRenderer.invoke / ipcRenderer.on                       │
├──────────────────────────────────────────────────────────────┤
│  Renderer (React + Zustand)                                    │
│    App.tsx → WindowCard → TaskConfigDialog / HistoryTaskDialog │
│    store/useStore.ts — Zustand 全局状态                        │
└──────────────────────────────────────────────────────────────┘
```

**3 类 IPC 通信**:

1. **invoke**(request/response):renderer `await window.fohelp.x()` → 主进程返回 Promise
2. **send**(push event):主进程 `webContents.send` → renderer `window.fohelp.onXxx(cb)` 触发回调
3. **utilityProcess.postMessage / on('message')**:主进程 ↔ utilityProcess 子进程(Renderer 不参与)

---

## 2. 文件清单

| 文件                                        | 职责                                         |
| ------------------------------------------- | -------------------------------------------- |
| `renderer/types.ts`                         | `window.fohelp` API 的 TypeScript 类型定义   |
| `renderer/store/useStore.ts`                | Zustand 全局状态 + IPC 订阅入口              |
| `renderer/App.tsx`                          | 顶层布局 + 自动刷新窗口列表 + 加载任务历史   |
| `renderer/components/WindowCard.tsx`        | 单游戏窗口卡片,5 状态机 + 所有 task 控制按钮 |
| `renderer/components/TaskConfigDialog.tsx`  | 任务配置 dialog(select / config / name 3 步) |
| `renderer/components/HistoryTaskDialog.tsx` | 历史任务列表 dialog                          |

---

## 3. State 总览

### 3.1 `useStore` 全局状态(`renderer/store/useStore.ts`)

| State              | 类型                       | 说明                                                 |
| ------------------ | -------------------------- | ---------------------------------------------------- |
| `gameWindows`      | `GameWindow[]`             | 当前检测到的所有 QQ幻想 窗口(每 3 秒刷新)            |
| `taskConfigs`      | `Map<number, TaskConfig>`  | 每个 hwnd 当前已应用的任务配置(运行时,reload 后清空) |
| `appliedTaskNames` | `Map<number, string>`      | 每个 hwnd 应用的"任务名"(显示在卡片)                 |
| `taskHistory`      | `StoredTaskConfig[]`       | 全局已保存的任务列表(跨窗口共享)                     |
| `characterNames`   | `Map<number, string>`      | 每个 hwnd OCR 出来的角色名                           |
| `thumbnails`       | `Map<number, string>`      | 每个 hwnd 的最新缩略图 URL (`thumb://image/<hwnd>`)  |
| `workers`          | `Map<string, WorkerState>` | 所有活跃 worker(按 workerId)                         |
| `logs`             | `LogEntry[]`               | 全局日志(最多 500 条,新进前部)                       |

### 3.2 `WindowCard` 组件 state(`renderer/components/WindowCard.tsx`)

| State                 | 类型                           | 说明                                        |
| --------------------- | ------------------------------ | ------------------------------------------- |
| `dialogOpen`          | `boolean`                      | TaskConfigDialog 是否打开                   |
| `historyOpen`         | `boolean`                      | HistoryTaskDialog 是否打开                  |
| `dialogMode`          | `'create' \| 'edit' \| 'view'` | dialog 当前模式(决定行为)                   |
| `autoStartAfterClose` | `boolean`                      | dialog 关闭后是否自动触发 startTask         |
| `isCreating`          | `boolean`                      | "创建任务"按钮的 loading 状态(bootstrap 中) |
| `error`               | `string \| null`               | 错误信息条(bootstrap 失败 / 保存失败等)     |

### 3.3 `TaskConfigDialog` 组件 state(`renderer/components/TaskConfigDialog.tsx`)

| State                     | 类型                             | 说明                                           |
| ------------------------- | -------------------------------- | ---------------------------------------------- |
| `step`                    | `'select' \| 'config' \| 'name'` | dialog 内部步骤                                |
| `taskType`                | `TaskType \| null`               | 选中的任务类型                                 |
| `historyOpen`             | `boolean`                        | 内部嵌套的 HistoryTaskDialog(选任务类型页打开) |
| `mapId` / `customMapName` | `string`                         | farm 任务的地图                                |
| `mode`                    | `'single' \| 'aoe' \| 'patrol'`  | farm 任务的打怪模式                            |
| `waypoints`               | `Waypoint[]`                     | patrol 模式的路径点                            |
| `nameKeywords`            | `string`                         | 找怪关键字(逗号分隔字符串)                     |
| `note`                    | `string`                         | 任务备注                                       |
| `taskName`                | `string`                         | 命名步骤中用户输入的任务名                     |
| `nameError`               | `string \| null`                 | 命名步骤错误(重名时显示)                       |

### 3.4 `HistoryTaskDialog` 组件 state

| State          | 类型 | 说明                            |
| -------------- | ---- | ------------------------------- |
| (无内部 state) | -    | 完全受控组件,所有数据来自 props |

---

## 4. State 流转图

### 4.1 `useStore` 关键字段的更新路径

```
┌────────────────────────────────────────────────────────────────┐
│  初始:空状态                                                     │
└────────────────────────────────────────────────────────────────┘
                            ↓ refreshWindows() (mount + 每 3 秒)
                  gameWindows: GameWindow[]
                            ↓ bootstrap / thumbnail 推送
              thumbnails: Map<hwnd, dataUrl>
                  characterNames: Map<hwnd, string>
                            ↓ 加载任务历史
              taskHistory: StoredTaskConfig[]
                            ↓ 用户选创建/历史/编辑
       taskConfigs: Map<hwnd, TaskConfig>
       appliedTaskNames: Map<hwnd, name>
                            ↓ 子进程发 state / log
       workers: Map<workerId, WorkerState>
                            ↓ 子进程 exit
       workers.delete(workerId)
```

### 4.2 WindowCard uiState 派生(`WindowCard.tsx:81-97`)

```ts
let uiState: 'unconfigured' | 'creating' | 'running' | 'paused' | 'editable';
if (!isConfigured) {
  uiState = 'unconfigured';
} else if (worker && worker.status === 'alert') {
  uiState = 'editable';
} else if (isRunning) {
  uiState = 'running';
} else if (isPaused) {
  uiState = 'paused';
} else if (worker && worker.ready === false) {
  uiState = 'creating';
} else {
  uiState = 'editable';
}
```

| uiState        | 显示按钮                       |
| -------------- | ------------------------------ |
| `unconfigured` | `[创建任务] [历史任务]`        |
| `creating`     | `[连接中…]`(loading)           |
| `running`      | `[查看详情] [暂停] [停止]`     |
| `paused`       | `[查看详情] [继续] [停止]`     |
| `editable`     | `[编辑配置] [历史任务] [放弃]` |

---

## 5. Handler 总览(WindowCard 主要交互)

### 5.1 入口按钮 handlers

| Handler                       | 触发                      | 流程                                                              |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `handleCreateTask()`          | 点"创建任务"              | setIsCreating(true) → 立即 setDialogOpen(true) → 后台 onBootstrap |
| `handleOpenHistory()`         | 点"历史任务"              | setHistoryOpen(true)                                              |
| `handleHistorySelect(stored)` | 选中历史                  | onApplyConfig → 复用或 bootstrap → onStartTask                    |
| `handleEditConfig()`          | editable 模式点"编辑配置" | dialogMode='edit' + setDialogOpen(true)                           |
| `handleReselectHistory()`     | editable 模式点"历史任务" | setHistoryOpen(true)                                              |
| `handleAbandon()`             | editable 模式点"放弃"     | onClearConfig                                                     |

### 5.2 任务运行控制 handlers

| Handler          | 触发     | 流程                      |
| ---------------- | -------- | ------------------------- |
| `handlePause()`  | 点"暂停" | onPause(worker.workerId)  |
| `handleResume()` | 点"继续" | onResume(worker.workerId) |
| `handleStop()`   | 点"停止" | onStop(worker.workerId)   |

### 5.3 Dialog handlers

| Handler                         | 触发                          | 流程                                                       |
| ------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `handleDialogClose()`           | 点 dialog 关闭按钮 / ESC      | create 模式且未保存 → onCancelBootstrap(hwnd);关闭         |
| `handleTaskSaved(config, name)` | 命名步骤点"确认保存"          | saveTaskByName(name, config) → onApplyConfig → onStartTask |
| `handleTaskConfirm(config)`     | config 步骤点"确认"(不持久化) | onApplyConfig(hwnd, config, 无 name) → onStartTask         |

---

## 6. 调用链(完整流程)

### 6.1 应用启动

```
[PowerShell: chcp 65001]
    ↓
electron . (package.json "main" 指向 dist-electron/electron/main.js)
    ↓
electron/main.ts 执行:
  ├─ process.stdout.setDefaultEncoding('utf8')
  ├─ protocol.registerSchemesAsPrivileged([{thumb}])
  └─ app.whenReady().then(() => {
       ├─ 创建 thumbnails 目录
       ├─ protocol.handle('thumb', ...)            [thumb:// → 本地 PNG 文件]
       ├─ setupIpc()                              [注册所有 IPC handlers]
       └─ createWindow()
            └─ BrowserWindow.loadFile/loadURL
                 ├─ 加载 dist/index.html (renderer 入口)
                 └─ 加载 dist-electron/electron/preload.js
                      └─ preload.ts:
                          contextBridge.exposeInMainWorld('fohelp', api)
                              ↓
renderer/index.tsx → App.tsx
    ├─ useEffect (mount 时):
    │   ├─ subscribeToIpc()                      [订阅主进程推送]
    │   ├─ refreshWindows()                      [首次拉游戏窗口列表]
    │   ├─ loadTaskHistory()                     [首次拉历史任务]
    │   └─ setInterval(refreshWindows, 3000)     [每 3 秒刷新]
    └─ 渲染 gameWindows.map(win => <WindowCard ... />)
```

### 6.2 创建任务(完整链路)

```
1. 用户点"创建任务"
   WindowCard.handleCreateTask()                              [WindowCard.tsx:93]
     ├─ setIsCreating(true)                                   [按钮变 "连接中…"]
     ├─ setDialogMode('create')
     ├─ setAutoStartAfterClose(true)
     ├─ setDialogOpen(true)                                   [★ dialog 立刻弹出]
     └─ 后台异步:
        onBootstrap(gameWindow.hwnd, name)                     [useStore.bootstrapWorker]
          └─ window.fohelp.bootstrapWorker(hwnd, name)
               └─ ipcRenderer.invoke('BootstrapWorker', {hwnd, name})
                    ↓ 主进程 IPC
               ipcMain.handle('BootstrapWorker', ...)         [electron/main.ts]
                 └─ workerManager.bootstrap(hwnd, name, null)  [worker-manager.ts]
                      ├─ this.start(hwnd, name, 'farm', null, null, waitForConfig=true)
                      │   ├─ utilityProcess.fork(workerScript, [initPayload], {...})
                      │   ├─ worker.on('message', onWorkerMessage)
                      │   └─ worker.on('exit', onWorkerExit)
                      └─ return new Promise((resolve, reject) => {
                           ├─ worker.on('message', onMsg)     [bootstrap 临时 listener]
                           └─ setTimeout(30s, () => reject('bootstrap 超时'))
                         })

2. utilityProcess 子进程冷启动(独立 OS 进程)
   game-utility-worker.js:
     ├─ 顶层 import + 加载业务模块
     ├─ if (!process.parentPort) throw
     ├─ process.on('uncaughtException' / 'unhandledRejection')
     ├─ process.parentPort.on('message', listener)            [顶层注册]
     ├─ const init = parseInitData()                          [从 process.argv 取 JSON]
     ├─ process.parentPort.postMessage({type:'ready'})        [★ 发 ready 信号]
     └─ main() 异步:
         ├─ _dm = getDamoo()                                 [dm.dll + winax COM]
         ├─ bindWindow(init.hwnd, cfg)                       [BindWindowEx]
         ├─ setDict / useDict                                [加载字库]
         ├─ OCR mock 读角色名
         ├─ process.parentPort.postMessage({state:{characterName}})
         ├─ takeAndSendThumbnail:
         │   ├─ dmApi.capture(0, 0, 192, 108, filePath)
         │   └─ postMessage({type:'thumbnail', dataUrl:'thumb://image/<hwnd>'})
         ├─ new CombatEngine(...)
         ├─ setStatus('idle', '等待启动')
         └─ await new Promise((resolve) => { _startResolve = resolve })
             [★ worker 阻塞在这里,等父进程发 start-task]

3. bootstrap Promise resolve
   worker-manager.bootstrap.onMsg(msg):
     ├─ if (msg.type === 'thumbnail') finish(() => resolve({dataUrl, characterName}))
     └─ onWorkerMessage(msg) → broadcast('thumbnail:update', {hwnd, dataUrl})
   useStore.bootstrapWorker:
     ├─ setThumbnail(hwnd, dataUrl)
     ├─ setCharacterName(hwnd, characterName)
     └─ listWorkers() 刷新 workers Map

4. WindowCard.handleCreateTask 继续:
     └─ setIsCreating(false)                                 [loading 消失]

[★ 此时 dialog 已开,bootstrap 完成,UI 一切正常]
```

### 6.3 选择历史任务

```
1. 用户点"历史任务"
   WindowCard.handleOpenHistory()                              [WindowCard.tsx:108]
     └─ setHistoryOpen(true)                                  [打开 HistoryTaskDialog]

2. 用户选中某条
   HistoryTaskDialog 触发 onApply(stored: StoredTaskConfig)
     └─ WindowCard.handleHistorySelect(stored)               [WindowCard.tsx:114]
          ├─ setHistoryOpen(false)
          ├─ onApplyConfig(hwnd, stored.config, stored.name) [存 store]
          ├─ if (worker) {
          │   // 已有 worker(可复用)
          │   const startRes = await onStartTask(hwnd)      [直接 startTask]
          │ } else {
          │   const res = await onBootstrap(hwnd, name)
          │   if (!res.ok) { setError; return }
          │   const startRes = await onStartTask(hwnd)
          │ }
          └─ alert 失败信息

3. onStartTask 链路:
   useStore.startTask → window.fohelp.startTask → IPC
     → worker-manager.startTask(hwnd):
        ├─ 找到 worker,循环等 m.state.ready(最多 30s)
        └─ worker.postMessage({type:'command', command:'start-task'})

4. utilityProcess 子进程收到 start-task
   listener case 'start-task': _startResolve()
     [解开 await Promise,worker 继续往下走]
   main() 继续:
     └─ await combat.start()                                  [战斗循环]
```

### 6.4 任务配置保存(走完整"挂机打怪"流程)

```
1. 用户在 TaskConfigDialog 的 select step 选"挂机打怪"
   onClick → setTaskType('farm'); setStep('config')

2. 用户在 config step 选地图/模式/关键字 → state 更新

3. 用户点"保存配置"
   TaskConfigDialog.handleSave()                              [TaskConfigDialog.tsx]
     ├─ setTaskName(`任务-${hwnd}-${date}`)
     ├─ setNameError(null)
     └─ setStep('name')                                       [跳到命名步骤]

4. 用户在 name step 输入名字,点"确认保存"
   TaskConfigDialog.handleConfirmName()                       [TaskConfigDialog.tsx]
     ├─ const trimmed = taskName.trim()
     ├─ if (!trimmed) { setNameError('任务名不能为空'); return }
     └─ const res = await onSaved(config, trimmed)
          └─ WindowCard.handleTaskSaved(config, name)          [WindowCard.tsx:171]
               ├─ const res = await saveTaskByName(trimmed, config)
               │   └─ window.fohelp.saveTaskConfig(0, config, name)
               │        └─ ipcRenderer.invoke('SaveTaskConfig', {hwnd, config, name})
               │             ↓
               │        ipcMain.handle('SaveTaskConfig', payload =>
               │          taskConfigService.saveByName(name, config)
               │        )
               │             ├─ exists(name) → 返回 {ok:false, error:'任务名已存在'}
               │             └─ 否则:写文件 <sanitize(name)>.json
               ├─ if (!res.ok) return {ok:false, error}       [dialog 留在 name step 显示错误]
               ├─ onApplyConfig(hwnd, config, trimmed)         [store 写入 taskConfigs + appliedTaskNames]
               ├─ setDialogOpen(false)                          [关 dialog]
               ├─ setAutoStartAfterClose(false)
               └─ const startRes = await onStartTask(hwnd)
                    ├─ 等 worker ready(最多 30s)
                    ├─ postMessage start-task
                    └─ 子进程 _startResolve → combat.start()

[任务进入战斗循环]
```

### 6.5 任务运行控制

#### 暂停

```
WindowCard.handlePause()
  └─ onPause(worker.workerId)                                [useStore.pauseWorker]
       └─ window.fohelp.pauseWorker(workerId)
            └─ ipcRenderer.invoke('PauseWorker', workerId)
                 ↓
            ipcMain.handle('PauseWorker', _e, workerId =>
              workerManager?.pause(workerId)
            )
                 ↓
            worker-manager.pause(workerId):
              └─ worker.postMessage({type:'command', command:'pause'})

子进程 case 'pause':
  ├─ combat?.stop()                                  [让战斗循环退出 while]
  └─ setStatus('paused', '用户暂停')
  [★ 子进程不退出,worker 保留]
```

#### 继续

```
类似暂停,command='resume',worker 收到后:
  case 'resume':
    └─ combat.start().catch(...)                     [重启战斗循环]
```

#### 停止

```
WindowCard.handleStop()
  └─ onStop(worker.workerId)                                 [useStore.stopWorker]
       └─ worker-manager.stop(workerId):
            └─ worker.postMessage({type:'command', command:'stop'})

子进程 case 'stop':
  ├─ _running = false
  ├─ combat?.stop()
  ├─ try { dmApi.unbindWindow() } catch {}       [可选清理 hook]
  ├─ setStatus('idle', '已停止')
  └─ setTimeout(() => process.exit(0), 300)

worker.exit → 主进程 onWorkerExit:
  ├─ this.byHwnd.delete(worker.hwnd)
  ├─ this.workers.delete(workerId)
  └─ broadcast(WorkerStateChanged, {workerId, removed:true})
       ↓
    renderer onWorkerStateChanged → store.removeWorker(workerId)
       ↓
    WindowCard uiState 派生回 'editable'(worker 不存在,taskConfig 还在)
```

### 6.6 缩略图刷新

```
用户点 WindowCard 右上角的"刷新缩略图"按钮(RefreshCw 图标):
  onClick → window.fohelp.recaptureThumbnail(hwnd)
              └─ ipcRenderer.invoke('thumbnail:recapture', hwnd)
                   ↓
              ipcMain.handle('thumbnail:recapture', hwnd =>
                workerManager.requestThumbnail(hwnd)
              )
                   ↓
              worker-manager.requestThumbnail(hwnd):
                └─ postMessage({type:'command', command:'screenshot'})

子进程 case 'screenshot':
  └─ handleScreenshot():
        ├─ _dm = getDamoo() (如未加载)
        └─ takeAndSendThumbnail(hwnd)
              ├─ dmApi.capture(...)
              └─ postMessage({type:'thumbnail', dataUrl:'thumb://image/<hwnd>'})

主进程 onWorkerMessage 收到 thumbnail:
  ├─ this.thumbs.set(hwnd, dataUrl)
  └─ broadcast('thumbnail:update', {hwnd, dataUrl})
       ↓
    renderer onThumbnailUpdate → store.setThumbnail(hwnd, dataUrl)
       ↓
    WindowCard 用 useStore selector 重新渲染,thumbnail img src 更新
```

### 6.7 截图测试(相机图标按钮)

```
onClick → window.fohelp.captureTest(hwnd)
  └─ ipcRenderer.invoke('worker:capture-test', hwnd)
       ↓
  worker-manager.captureTest(hwnd):
    └─ postMessage({type:'command', command:'screenshot-test'})

子进程 takeAndSendThumbnailTest(hwnd):
  ├─ dmApi.capture(0, 0, 100, 100, filePath)
  ├─ dmApi.getFullScreenData(`testscreen-${hwnd}-${ts}.png`)
  └─ postMessage({type:'thumbnail-test', hwnd, filePath, size})

主进程捕获 thumbnail-test 消息 → resolve 给 captureTest Promise
返回 {filePath} → renderer 弹窗 alert('截图失败' / 自动打开文件位置)
  └─ window.fohelp.showItemInFolder(filePath)         [Windows 资源管理器高亮]
```

---

## 7. IPC Channel 总览

### 7.1 invoke (Renderer → Main → Renderer)

| Channel                  | Renderer 调用                        | Main handler                        | 主进程服务 |
| ------------------------ | ------------------------------------ | ----------------------------------- | ---------- |
| `window:list`            | `listGameWindows()`                  | `window-registry.ts`                | -          |
| `window:refresh`         | `refreshGameWindows()`               | 同上                                | -          |
| `window:capture`         | `captureWindow(hwnd)`                | `ThumbnailService.getCached()`      | -          |
| `thumbnail:recapture`    | `recaptureThumbnail(hwnd)`           | `worker-manager.requestThumbnail()` | -          |
| `worker:bootstrap`       | `bootstrapWorker(hwnd, name)`        | `worker-manager.bootstrap()`        | -          |
| `worker:start-task`      | `startTask(hwnd)`                    | `worker-manager.startTask()`        | -          |
| `worker:stop-by-hwnd`    | `stopWorkerByHwnd(hwnd)`             | `worker-manager.stopByHwnd()`       | -          |
| `worker:start`           | `startWorker(hwnd, name, type)`      | `worker-manager.start()`            | -          |
| `worker:stop`            | `stopWorker(workerId)`               | `worker-manager.stop()`             | -          |
| `worker:pause`           | `pauseWorker(workerId)`              | `worker-manager.pause()`            | -          |
| `worker:resume`          | `resumeWorker(workerId)`             | `worker-manager.resume()`           | -          |
| `worker:list`            | `listWorkers()`                      | `worker-manager.list()`             | -          |
| `worker:capture-test`    | `captureTest(hwnd)`                  | `worker-manager.captureTest()`      | -          |
| `task:save`              | `saveTaskConfig(hwnd, config, name)` | `task-config-service.saveByName()`  | -          |
| `task:get`               | `getTaskConfig(hwnd)`                | 返回 null(旧 API)                   | -          |
| `task:list-all`          | `listAllTaskConfigs()`               | `task-config-service.listAll()`     | -          |
| `task:load-by-name`      | `loadTaskByName(name)`               | `task-config-service.loadByName()`  | -          |
| `shell:showItemInFolder` | `showItemInFolder(filePath)`         | `shell.showItemInFolder()`          | -          |

### 7.2 send (Main → Renderer, push)

| Channel            | 推送时机                         | Renderer handler(useStore) | 更新 state                                                |
| ------------------ | -------------------------------- | -------------------------- | --------------------------------------------------------- |
| `worker:state`     | worker state 变化 / ready / 退出 | `onWorkerStateChanged`     | `updateWorkerState` / `removeWorker` / `setCharacterName` |
| `worker:log`       | worker 推 log                    | `onWorkerLog`              | `appendLog`                                               |
| `worker:error`     | worker 报错                      | `onWorkerError`            | `appendLog`(level='error')                                |
| `thumbnail:update` | worker 发 thumbnail              | `onThumbnailUpdate`        | `setThumbnail`                                            |

### 7.3 utilityProcess message(主进程 ↔ 子进程)

**主进程 → 子进程(command)**:

- `start-task` / `stop` / `pause` / `resume` / `screenshot` / `screenshot-test`

**子进程 → 主进程(state / data)**:

- `ready` — 子进程初始化完成(message listener 已注册)
- `state` — worker 状态变化(setStatus 调用)
- `log` — worker 日志
- `thumbnail` — 截图推送(dataUrl = `thumb://image/<hwnd>`)
- `thumbnail-test` — 测试截图(filePath)
- `error` — 子进程报错

---

## 8. 错误处理路径

### 8.1 Bootstrap 超时(30s)

```
worker-manager.bootstrap setTimeout 触发:
  ├─ finish(() => reject('bootstrap 超时(30s) — 检查大漠注册码/游戏窗口'))
  └─ WindowCard handleCreateTask:
       ├─ setIsCreating(false)
       └─ setError(res.error)                  [错误条显示在卡片上]

子进程 stdout 没日志输出 → 检查:
  - dm.dll 是否成功 new winax.Object('dm.dmsoft')
  - utilityProcess fork 是否成功
  - stdout pipe 是否被阻塞(父进程 listener 是否在消费)
```

### 8.2 重名保存

```
task-config-service.saveByName 检测到 exists(name):
  └─ return {ok:false, error:'任务名"X"已存在,请换一个名字'}

WindowCard.handleTaskSaved:
  └─ return {ok:false, error}
       ↓
TaskConfigDialog.handleConfirmName:
  └─ setNameError(res.error)                    [name step 显示错误]
  [用户改名重试]
```

### 8.3 startTask 失败

```
worker-manager.startTask 等 ready 超时(30s):
  └─ return {ok:false, error:'worker 初始化未完成,稍后重试'}

WindowCard.handleTaskSaved:
  └─ alert('已保存任务,但启动失败: ...请稍后重试')

[editable 状态下用户可以重试]
```

### 8.4 utilityProcess 子进程崩溃(0xC00000D0)

```
dm.dll v7.2543 native SEH 异常,绕过 V8 TryCatch:
  - 进程 exit code = 0xC00000D0
  - 触发 process.on('uncaughtException') handler(log 但救不了)
  - worker.on('exit') 触发 → onWorkerExit 清理 + log warning
```

---

## 9. 边界情况

### 9.1 已 bootstrap worker 的复用

```
handleHistorySelect 检测到 worker 已存在(byHwnd.has(hwnd)):
  └─ 直接 onStartTask,不重新 bootstrap
```

### 9.2 dialog 关闭但 worker 还在跑

```
handleDialogClose 检查 dialogMode==='create' && autoStartAfterClose && !worker?.taskConfig:
  └─ onCancelBootstrap(hwnd)                     [停掉 worker,避免孤儿]
```

### 9.3 任务历史为空

```
HistoryTaskDialog 显示空状态:"还没有保存过任何任务"
WindowCard 的"历史任务"按钮:disabled (taskHistory.length === 0)
```

### 9.4 同时多个窗口创建任务

```
每个窗口独立 hwnd → byHwnd 独立映射 → 各自 utilityProcess 子进程
进程隔离,互不影响
```

### 9.5 reload 后应用

```
App.tsx mount:
  ├─ subscribeToIpc()
  ├─ refreshWindows()       [拉最新窗口列表]
  ├─ loadTaskHistory()      [拉历史任务]
  └─ 但 taskConfigs / appliedTaskNames 都是空的(不持久化)
  → 所有窗口显示 unconfigured (创建/历史任务按钮)
  → 已运行的 worker(utilityProcess 子进程)会通过 push 重新连上(如果没死)
```

---

## 10. 已知陷阱(踩过的坑)

| 坑                                                        | 修复                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `window.prompt()` 在 Electron 中禁用                      | 改成 TaskConfigDialog 内部 `step='name'` inline UI               |
| dialog 渲染条件 `dialogOpen && taskConfig` 创建流程不显示 | 改成 `(dialogOpen && (taskConfig \|\| dialogMode === 'create'))` |
| bootstrap 卡住时 `setDialogOpen(true)` 不执行             | handleCreateTask 同步设置,bootstrap 后台跑                       |
| `dm.UnBindWindow()` 在某些 hwnd 触发 `0xC00000D0`         | 加 `process.on('uncaughtException')` 兜底                        |
| 多 worker 共享 dm.dll hook 冲突                           | 改用 utilityProcess(独立 OS 进程)                                |
| utilityProcess IPC 通道可能丢消息(子进程 listener 未注册) | 加 `ready` 信号,父进程只对 ready 后发 start-task                 |
| `stdio: 'inherit'` 在 GUI 环境可能阻塞                    | 改 `'pipe'` + 父进程主动 drain stdout/stderr                     |
| start-task 在 worker 未 ready 时丢消息                    | `worker-manager.startTask` 改为 async + 等 ready                 |

---

## 11. 关键文件速查表

| 文件                                        | 行数 | 关键导出                           |
| ------------------------------------------- | ---- | ---------------------------------- |
| `renderer/App.tsx`                          | ~150 | `App` 组件                         |
| `renderer/store/useStore.ts`                | ~250 | `useStore`, `subscribeToIpc`       |
| `renderer/components/WindowCard.tsx`        | ~530 | `WindowCard`                       |
| `renderer/components/TaskConfigDialog.tsx`  | ~620 | `TaskConfigDialog`                 |
| `renderer/components/HistoryTaskDialog.tsx` | ~110 | `HistoryTaskDialog`                |
| `renderer/types.ts`                         | ~70  | `FohelpAPI`                        |
| `electron/preload.ts`                       | ~100 | `api` (exposed as `window.fohelp`) |
| `electron/services/worker-manager.ts`       | ~410 | `WorkerManager`                    |
| `electron/workers/game-utility-worker.ts`   | ~390 | (子进程入口)                       |

---

## 12. 一次完整任务的时序图(创建→启动→运行→停止)

```
T=0ms   用户点"创建任务"
        WindowCard.handleCreateTask
        ├─ setIsCreating(true)
        ├─ setDialogOpen(true)
        └─ 后台 onBootstrap → IPC

T=20ms  主进程 fork utilityProcess 子进程

T=500ms 子进程冷启动 + dm.dll 加载 + 绑窗

T=2s    子进程发 thumbnail 消息

T=2s    主进程收到 → bootstrap Promise resolve
        ├─ broadcast thumbnail:update
        └─ IPC handler 返回 {ok:true, dataUrl, characterName}

T=2s    WindowCard setIsCreating(false)

T=3s    用户在 dialog 选地图/模式/关键字
T=4s    用户点"保存配置" → step='name'
T=5s    用户输入"测试-1",点"确认保存"
        ├─ saveTaskByName → IPC 存盘
        ├─ applyTaskConfig
        └─ onStartTask → IPC

T=5s    worker-manager.startTask 等 ready(已 ready)
        └─ postMessage start-task

T=5s    子进程 _startResolve() → main() 继续
        └─ combat.start() 进入战斗循环

T=5s~  战斗循环中:找怪 → 移动 → 点击 → 战斗 → 检测 → 循环
        每个 tick 调 dm.FindStr / dm.MoveTo / dm.KeyPress
        状态变化 → setStatus → postMessage state → 主进程 broadcast → React 重渲染

T=∞    用户点"停止"
        WindowCard.handleStop → onStop(workerId)
        ├─ worker-manager.stop → postMessage stop
        ├─ 子进程 case 'stop':
        │   ├─ combat?.stop()
        │   ├─ try dmApi.unbindWindow()
        │   ├─ setStatus('idle', '已停止')
        │   └─ setTimeout(process.exit, 300)
        ├─ 子进程 exit
        ├─ 主进程 onWorkerExit 清理 byHwnd/workers
        └─ broadcast removed → WindowCard uiState 回 'editable'
```
