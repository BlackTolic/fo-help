# QQ幻想脚本助手

> 多窗口并行挂机工具(本地版)

## 项目状态

**P1 脚手架阶段** —— 已完成:
- ✅ Electron + Vite + React + TypeScript + Tailwind 工程
- ✅ 主进程 / Worker / 渲染进程 三层架构
- ✅ Win32 API 窗口枚举(koffi)
- ✅ Worker 池管理(每游戏窗口一个 worker)
- ✅ IPC 通信 + 状态推送
- ✅ 主面板 UI(窗口列表 + 4 元素卡片)

**P2 待做** —— 战斗/移动/识别引擎:
- ⏳ 大漠 DLL 真实绑定(P1 是 stub)
- ⏳ 坐标读取(小地图)
- ⏳ 找怪(OCR 头顶名字)
- ⏳ 战斗循环(智能选技)
- ⏳ 实时缩略图(`desktopCapturer`)
- ⏳ Profile YAML 加载

完整设计见 `docs/DESIGN.md`,任务系统见 `docs/TASKS.md`。

## 快速开始

### 开发模式

```bash
npm install        # 装依赖(首次约 3-5 分钟,electron 体积大)
npm run dev        # 启动 vite + tsc-watch + electron
```

启动后会自动打开窗口,主面板会显示当前所有 QQ幻想 窗口(如果有的话)。

### 构建打包

```bash
npm run build      # 编译主进程 + Worker + 渲染进程
npm run package    # electron-builder 打 NSIS 安装包
```

## 目录结构

```
fo-help/
├── electron/              # 主进程
│   ├── main.ts            # 入口
│   ├── preload.ts         # 预加载(contextBridge)
│   └── services/          # 主进程服务
│       ├── window-registry.ts   # 窗口枚举(koffi)
│       └── worker-manager.ts    # Worker 池管理
├── workers/               # Worker 线程
│   └── game-worker.ts     # 每游戏窗口一个实例
├── core/                  # 核心引擎(共享)
│   └── platform/          # 平台抽象层
│       ├── vision/        # 视觉识别接口
│       │   ├── IVisionProvider.ts
│       │   └── damoo/
│       │       └── DamooProvider.ts   # P1 stub,P2 接 DLL
│       └── input/         # 输入模拟接口
│           ├── IInputProvider.ts
│           └── damoo/
│               └── DamooInputProvider.ts
├── renderer/              # 渲染进程(React)
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── WindowCard.tsx
│   │   └── StatusBadge.tsx
│   ├── store/
│   │   └── useStore.ts
│   ├── types.ts           # window.fohelp 类型
│   └── index.css
├── shared/                # 主/Worker/Renderer 共享
│   ├── types.ts
│   └── ipc-channels.ts
├── docs/
│   ├── DESIGN.md
│   └── TASKS.md
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## 当前能做什么

- ✅ 自动枚举所有 QQ幻想 类游戏窗口
- ✅ 显示窗口列表(标题/类名/进程名/位置)
- ✅ 选择任务类型(挂机打怪/挖矿/捕捉宠物/装备炼化/名誉任务)
- ✅ 输入角色名
- ✅ 启动 / 暂停 / 停止 Worker
- ✅ 实时状态推送(6 种状态色)
- ✅ 日志流

## 当前不能做什么(P2+)

- ❌ 真实图色识别(需要 P2 接大漠 DLL)
- ❌ 真实鼠标/键盘模拟(P2 接入)
- ❌ 实时游戏画面缩略图(P2 接入 desktopCapturer)
- ❌ 战斗循环(智能选技、走位、药水)
- ❌ 任务调度(定时切换、手动切换)
- ❌ Profile YAML 编辑器

## 启动验证(P1 阶段)

`npm run dev` 启动后:

1. 主窗口应该打开(1280×800,深色主题)
2. 顶部显示 "QQ幻想助手 v0.1"
3. 如果电脑上有 QQ幻想 在运行,会显示卡片
4. 没检测到游戏时,显示空状态提示
5. 点 "刷新" 按钮可以重新枚举
6. 如果有游戏窗口,可以选任务 + 输角色名 + 点启动
7. 启动后 Worker 状态会从 `空闲` 变成 `战斗中`(stub 状态)

## 关键设计决策

- **大漠先行 + 自研兜底**: P2 用大漠,P4+ 切自研,接口隔离保证零迁移成本
- **worker_threads 隔离**: 每游戏窗口一个 worker,DLL 状态完全隔离
- **抽象接口优先**: 所有功能都通过接口,实现可替换
- **本地优先**: 现阶段不考虑自动更新 / 授权 / 分发,自己玩先跑通

## 已知 P1 限制

- 实时缩略图是占位(P2 接入)
- 大漠 Provider 是 stub(调用会抛错)
- 窗口识别规则可能不匹配所有私服(可在 `window-registry.ts` 的 `isQQFantasyWindow` 调整)
