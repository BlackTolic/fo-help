# QQ幻想脚本助手 · 详细设计文档

> **版本:** v1.0 · **更新日期:** 2026-09-11 · **状态:** 设计阶段

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术选型](#2-技术选型)
3. [架构总览](#3-架构总览)
4. [大漠插件封装层](#4-大漠插件封装层)
5. [核心模块详细设计](#5-核心模块详细设计)
6. [Profile 系统](#6-profile-系统)
7. [IPC 协议](#7-ipc-协议)
8. [数据存储](#8-数据存储)
9. [目录结构](#9-目录结构)
10. [打包与分发](#10-打包与分发)
11. [订阅/授权模型](#11-订阅授权模型)
12. [实施阶段](#12-实施阶段)
13. [风险与开放问题](#13-风险与开放问题)

---

## 1. 项目概述

### 1.1 项目目标

构建一个面向 QQ幻想 私服玩家的桌面助手工具,支持:

- **单机多开**:同一游戏多个窗口并行挂机
- **每窗口独立**:每窗口独立的图色识别 + 鼠标/按键模拟
- **智能战斗**:技能优先级 + 条件触发 + AOE 群刷 + 威胁自保
- **玩家定制**:通用 Profile 框架 + 玩家自定义模板/坐标/技能
- **订阅制**:免费 + 高级双层,跨多个 QQ幻想 私服通用

### 1.2 业务范围

**In Scope:**

- Windows 桌面应用(Electron)
- 多窗口并行控制(理论无上限,实际建议 4-8 个)
- 战斗 / 移动 / 拾取 / 回城 自动化
- 免费 + 高级订阅双层功能

**Out of Scope(明确不做):**

- 移动端
- 跨平台(只 Windows)
- 游戏内交易 / 拍卖行自动化
- 多游戏适配(只做 QQ幻想 引擎,后期可扩展)

### 1.3 商业模式

- **免费版**:1 窗口,基础功能(打怪 / 移动 / 拾取)
- **高级版(月付 / 年付)**:
  - 多窗口并行
  - 高级功能(AOE / 回城 / 威胁自保)
  - 云端 Profile 同步
  - 优先更新 / 优先客服

### 1.4 风险与合规

- QQ幻想 已停服,目标用户为私服玩家
- 工具不绕过游戏客户端,只读取屏幕 + 模拟输入
- 必须包含免责声明
- 不存储用户账号密码
- 代码签名 + 杀软白名单申请

---

## 2. 技术选型

### 2.1 运行环境

| 项 | 版本 |
|---|---|
| 操作系统 | Windows 10 / Windows 11 (x64) |
| Node.js | 20 LTS |
| Electron | 32 LTS |
| QQ幻想 | 任意私服(通过 Profile 适配) |

### 2.2 核心栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Electron | 跨平台桌面首选,生态成熟,打包 / 更新成熟 |
| 语言 | TypeScript | 类型安全,工程化 |
| UI | React 18 + Zustand | 生态成熟,状态管理轻 |
| 样式 | Tailwind CSS | 快速样式 |
| 进程隔离 | Node `worker_threads` | 同进程多线程,共享 native,启动快 |
| 图像识别 (P1-P3) | 大漠插件 | 起步快,识别强 |
| 图像识别 (P4+) | 自研 | 零授权,代码可控,长期方案 |
| 鼠标 / 键盘 | 大漠 / SendInput | P1-P3 用大漠,P4+ 切原生 |
| 打包 | electron-builder | 主流方案 |
| 更新 | electron-updater | 主流方案 |
| 日志 | electron-log | 持久化日志 |
| 崩溃上报 | Sentry | 业内标准 |

### 2.3 关键依赖

```json
{
  "dependencies": {
    "electron": "^32",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^5",
    "tailwindcss": "^3",
    "electron-log": "^5",
    "electron-updater": "^6",
    "koffi": "^2",
    "yaml": "^2"
  },
  "devDependencies": {
    "electron-builder": "^25",
    "typescript": "^5",
    "vite": "^5",
    "@types/node": "^20",
    "@types/react": "^18"
  }
}
```

### 2.4 决策记录(ADR)

- **ADR-001**: 大漠优先 + 自研兜底(详见 §4)
- **ADR-002**: `worker_threads` 替代 `child_process`(共享 native,启动快)
- **ADR-003**: 订阅模式(避免一次性付费的高门槛)
- **ADR-004**: Profile 自定义(降低适配成本)

---

## 3. 架构总览

### 3.1 进程模型

```
┌────────────────────────────────────────────────────┐
│              Electron Main Process                  │
│  - BrowserWindow 生命周期                           │
│  - WindowRegistry: 枚举 / 匹配 / 跟踪游戏窗口       │
│  - WorkerManager: Worker 池分配 / 回收              │
│  - LicenseManager: 授权验证                         │
│  - AutoUpdater: 版本检查                            │
│  - IPC 总线                                         │
└────────────────┬───────────────────────────────────┘
                 │ MessagePort
        ┌────────┼────────┐
        ▼        ▼        ▼
    ┌──────┐ ┌──────┐ ┌──────┐
    │ W-1  │ │ W-2  │ │ W-N  │  (worker_threads,每游戏窗口一个)
    │hwndA │ │hwndB │ │hwndN │
    └──────┘ └──────┘ └──────┘

┌────────────────────────────────────────────────────┐
│              Electron Renderer (UI)                 │
│  - 窗口列表 / 状态卡片                              │
│  - Profile 管理                                     │
│  - 设置中心                                         │
│  - 日志面板                                         │
└────────────────────────────────────────────────────┘
```

### 3.2 模块分层

```
┌─────────────────────────────────────────────┐
│ 4. 应用层 (Application)                      │
│    UI 组件 / IPC 处理器 / 授权 / 更新         │
├─────────────────────────────────────────────┤
│ 3. 编排层 (Orchestration)                    │
│    ScriptRuntime + DSL / ProfileLoader        │
├─────────────────────────────────────────────┤
│ 2. 核心层 (Core)                             │
│    Vision / Movement / Combat / Skills        │
├─────────────────────────────────────────────┤
│ 1. 平台层 (Platform)                         │
│    大漠绑定 / 系统 API 封装 / 窗口枚举        │
└─────────────────────────────────────────────┘
```

### 3.3 数据流

```
Profile YAML ──┐
               ▼
        ScriptRuntime (Worker 内)
               │
   ┌───────────┼─────────────┐
   ▼           ▼             ▼
Vision      MouseSim      SkillMgr
   │           │             │
   └────┬──────┴──────┬──────┘
        ▼             ▼
   GameWindow    EventBus
                     │
                     ▼
              Main Process
                     │
                     ▼
              Renderer (UI)
```

---

## 4. 大漠插件封装层

### 4.1 设计原则

**核心:大漠是"实现细节",所有上层模块不直接依赖大漠。**

通过抽象接口隔离,后期可平滑切换到自研实现,业务代码零改动。

### 4.2 抽象接口

```ts
// core/platform/vision/IVisionProvider.ts
export interface IVisionProvider {
  findImage(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point | null>;
  findImages(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point[]>;
  findColor(roi: Rect, color: string, dir?: Direction): Promise<Point | null>;
  ocr(roi: Rect, opts?: OcrOpts): Promise<OcrResult>;
  captureScreen(roi?: Rect): Promise<ImageData>;
  destroy(): void;
}

// core/platform/input/IInputProvider.ts
export interface IInputProvider {
  moveMouse(to: Point, style: MoveStyle): Promise<void>;
  click(button: MouseButton, count: number): Promise<void>;
  pressKey(key: KeyCode): Promise<void>;
  keyDown(key: KeyCode): Promise<void>;
  keyUp(key: KeyCode): Promise<void>;
}
```

### 4.3 大漠实现

- 用 `koffi`(现代化 FFI)绑定大漠 DLL
- 每个 worker 内独立 `LoadLibrary`(`worker_threads` 隔离)
- 大漠是单线程,所以**一个 worker 一个 hwnd**(避免锁)
- 接口命名映射大漠函数(下划线转驼峰)

```ts
// core/platform/vision/damoo/DamooProvider.ts
export class DamooVisionProvider implements IVisionProvider {
  private dm: DmDll;  // 绑定的大漠对象
  
  constructor() {
    this.dm = loadDamooDll(); // 每个 worker 独立 LoadLibrary
  }
  
  async findImage(roi, template, opts) {
    const result = this.dm.FindPic(
      roi.x, roi.y, roi.x + roi.w, roi.y + roi.h,
      template.toString('base64'),
      opts?.similarity ?? 0.8,
      opts?.direction ?? 'leftTop'
    );
    // 解析 "x|y" 格式
  }
  
  // ... 其他方法
}
```

### 4.4 自研实现(预留)

```ts
// core/platform/vision/native/NativeVisionProvider.ts
// - BitBlt 截图
// - 自实现灰度化 + 模板匹配(SAD / SSD)
// - 颜色识别:遍历像素
// - OCR: Tesseract.js
```

### 4.5 切换策略

- 启动时根据 `config.engine.mode` 选择 Provider
  - `'damoo'`: 大漠(默认 P1-P3)
  - `'native'`: 自研(P4+ 默认)
- 两个 Provider 实现同一接口,上层无感知
- 切换触发点: 性能监控 + 杀软反馈

---

## 5. 核心模块详细设计

### 5.1 WindowRegistry

**职责:** 发现并跟踪所有 QQ幻想 游戏窗口。

```ts
class WindowRegistry {
  listGameWindows(): GameWindow[];
  onWindowCreated(cb: (hwnd: number) => void): void;
  onWindowClosed(cb: (hwnd: number) => void): void;
  matchByTitle(regex: RegExp): GameWindow[];
  matchByProcess(name: string): GameWindow[];
  matchByClassName(name: string): GameWindow[];
}

interface GameWindow {
  hwnd: number;
  pid: number;
  title: string;
  className: string;
  processName: string;
  rect: Rect;
  isForeground: boolean;
  isMinimized: boolean;
  workerId?: string;
  profileId?: string;
}
```

**关键点:**

- `SetWinEventHook` 监听窗口创建 / 销毁 / 最小化
- QQ幻想 主窗口类名通常固定(如 `TMainForm`),优先按类名匹配
- 一个 hwnd 只能绑定一个 worker
- 主进程持有 `hwnd → workerId` 映射,防止重复分配

### 5.2 ScriptRuntime + DSL

**职责:** 加载并执行玩家 Profile 中的脚本。

**DSL 设计原则:**

- 声明式、组合式
- 异步友好
- 可序列化(可视化编辑 / 远程传输)
- 节点可中断

```ts
type ScriptNode =
  | { type: 'moveTo'; target: Point; style: MoveStyle }
  | { type: 'arrive'; target: WorldPoint; threshold: number; timeout: number }
  | { type: 'findTarget'; filter: TargetFilter; onNotFound?: ScriptNode }
  | { type: 'combatLoop'; rotation: SkillRotation }
  | { type: 'loot'; radius: number; skip: string[] }
  | { type: 'heal'; threshold: number }
  | { type: 'kite'; direction: 'forward' | 'back' | 'strafe' }
  | { type: 'wait'; ms: number }
  | { type: 'log'; msg: string }
  | { type: 'sequence'; nodes: ScriptNode[] }
  | { type: 'parallel'; nodes: ScriptNode[] }
  | { type: 'repeat'; until: Condition; nodes: ScriptNode[] }
  | { type: 'branch'; if: Condition; then: ScriptNode; else?: ScriptNode };
```

**运行时:**

- 每个 worker 一个 `ScriptRuntime` 实例
- Visitor 模式逐节点执行
- 节点可中断(`token.cancel()`)
- 状态上报到 EventBus
- 异常隔离:单个节点失败不中断整个循环

### 5.3 SkillManager

**职责:** 技能槽位 + 冷却管理 + 智能选技。

```ts
interface SkillConfig {
  key: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9';
  name: string;
  cooldownMs: number;
  priority: number;        // 1-100
  condition?: Condition;
  interruptible?: boolean;
  preemptedBy?: string[];
}

class SkillManager {
  bind(configs: SkillConfig[]): void;
  cast(skillKey: string): Promise<boolean>;
  forceCast(skillKey: string): Promise<void>;
  getCooldown(skillKey: string): number;
  onReady(skillKey: string, cb: () => void): void;
  pickBest(context: CombatContext): SkillConfig | null;
}

interface CombatContext {
  selfHp: number;
  selfMp: number;
  targetHp: number;
  nearbyMobs: number;
  inCombat: boolean;
  threatLevel: 'none' | 'low' | 'high';
}
```

**冷却实现:**

```ts
private lastCastTime: Map<string, number> = new Map();

cast(key: string): boolean {
  const now = Date.now();
  const last = this.lastCastTime.get(key) || 0;
  const cd = this.configs.get(key).cooldownMs;

  if (now - last < cd) return false;  // 还在冷却

  this.lastCastTime.set(key, now);
  this.input.pressKey(key);
  return true;
}
```

**智能选技(优先级队列):**

```ts
pickBest(ctx: CombatContext): SkillConfig | null {
  const now = Date.now();
  const candidates = this.configs.filter(s => {
    const last = this.lastCastTime.get(s.key) || 0;
    return now - last >= s.cooldownMs;  // 冷却好了
  }).filter(s => this.evalCondition(s.condition, ctx));  // 条件满足

  if (candidates.length === 0) return null;

  // 按 priority 降序
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}
```

### 5.4 MovementEngine(QQ幻想 2.5D 适配)

**职责:** 角色移动控制。

**关键差异:** QQ幻想 是 2.5D,**移动 = 点击地面**(由游戏寻路),不需要生成贝塞尔轨迹。贝塞尔轨迹只用于"鼠标点击操作"的拟人化。

**坐标源:小地图**

| 位置 | 内容 | 用途 |
|---|---|---|
| 右上角 | 小地图(俯视 2D) | 角色在地图上的真实 2D 坐标 |
| 左上角 | 头像 + HP/MP 数字 | 读自己血蓝 |
| 角色头顶 | 名字 + 等级 | 自己的状态 |
| 怪头顶 | 名字 + 血条 | 找怪 + 读怪血 |
| 中央 | 2.5D 游戏画面 | 点击地面移动 / 点击怪物 |
| 底部 | 技能栏 F1-F9 | 释放技能 |

```ts
class MovementEngine {
  // 点击地面移动(由游戏自己寻路)
  async moveTo(target: ScreenPoint): Promise<MoveResult> {
    // 1. 拟人化鼠标移动到目标(短距离)
    await this.input.moveMouse(target, { style: 'human', duration: 300 });
    // 2. 点击
    await this.input.click('left', 1);
    // 3. 等待到达(小地图坐标判定)
    return this.waitForArrive(target);
  }

  // 通过小地图判定到达
  async waitForArrive(target: WorldPoint, opts?: ArriveOpts): Promise<ArriveResult> {
    const {
      threshold = 5,    // 距离阈值(世界坐标)
      timeout = 30000,  // 30s 超时
      pollMs = 200,     // 200ms 轮询
    } = opts || {};

    const start = Date.now();
    let lastPos: WorldPoint | null = null;
    let stuckTicks = 0;

    while (Date.now() - start < timeout) {
      const cur = await this.coordReader.readPlayerPosition();
      if (!cur) {
        await this.wait(pollMs);
        continue;
      }

      const dist = distance(cur, target);
      if (dist < threshold) return { status: 'arrived' };

      // 卡死检测(连续多次位置不变)
      if (lastPos && distance(lastPos, cur) < 1) {
        stuckTicks++;
        if (stuckTicks > 10) return { status: 'stuck' };
      } else {
        stuckTicks = 0;
      }
      lastPos = cur;

      await this.wait(pollMs);
    }
    return { status: 'timeout' };
  }
}
```

**移动策略分级:**

| 场景 | 鼠标轨迹 | 速度 |
|---|---|---|
| 战斗内走位 | 短直线 | 快 |
| 战斗外走路 | 短贝塞尔 | 中 |
| 紧急逃跑 | 直线瞬移 | 极快 |

### 5.5 CoordinateReader

**职责:** 读取游戏内各种坐标和数值。

```ts
class CoordinateReader {
  // 读小地图上角色位置 → 世界坐标
  async readPlayerPosition(): Promise<WorldPoint | null>;

  // 读 HP/MP 数字
  async readSelfHp(): Promise<number>;
  async readSelfMp(): Promise<number>;

  // 读目标血条百分比
  async readTargetHpPercent(): Promise<number | null>;

  // 读角色等级
  async readSelfLevel(): Promise<number>;

  // 读小地图附近实体(可选)
  async readNearbyEntities(): Promise<Entity[]>;
}
```

**实现细节:**

- 数字读取:**优先数字模板**(快),OCR 兜底
- 模板预加载:启动时所有模板进 worker 内存
- 小地图定位:固定 ROI 区域,找"我"的方向箭头模板
- 缓存:100ms 内的同样查询返回缓存
- OCR 断字:中文名字用词库校验("野狼"不会被认成"狼野")

### 5.6 Vision

**职责:** 统一图像识别入口。

```ts
class Vision {
  async findImage(template: string, opts: FindOpts): Promise<Point | null>;
  async findImages(template: string, opts: FindOpts): Promise<Point[]>;
  async findColor(color: string, roi: Rect): Promise<Point | null>;
  async ocr(roi: Rect, opts?: OcrOpts): Promise<OcrResult>;
  async similarity(img1: ImageData, img2: ImageData): Promise<number>;
}

interface FindOpts {
  roi?: Rect;
  similarity?: number;     // 0-1, 默认 0.8
  direction?: Direction;   // 扫描方向
  maxResults?: number;
}
```

**优化:**

- ROI 分区:屏幕切成 4-8 个区,只扫相关区
- 模板分级:粗筛 + 精匹配
- 截图缓存:同 ROI 100ms 内复用
- 异步队列:识别任务入队,避免阻塞后续动作

### 5.7 Combat(子模块组)

```ts
class TargetFinder {
  async find(filter: TargetFilter): Promise<CombatTarget | null>;
  async findAll(filter: TargetFilter): Promise<CombatTarget[]>;
}

interface TargetFilter {
  type: 'mob' | 'npc' | 'player';
  levelRange?: [number, number];
  namePattern?: string;
  maxDistance?: number;
  colorFilter?: ('white' | 'yellow' | 'red')[];
}

interface CombatTarget {
  id: string;          // 临时 ID(基于位置 hash)
  screenPos: Point;
  worldPos: WorldPoint;
  name: string;
  level: number;
  hpPercent: number;
  type: 'mob' | 'npc' | 'player';
  color: 'white' | 'yellow' | 'red';
}

class TargetSelector {
  pick(candidates: CombatTarget[], rules: SelectRule[]): CombatTarget | null;
}

type SelectRule =
  | { type: 'nearest' }
  | { type: 'lowestHp' }
  | { type: 'priority'; color: ('white' | 'yellow' | 'red')[] }
  | { type: 'levelRange'; min: number; max: number }
  | { type: 'threatening'; weight: number };

class CombatEngine {
  async startLoop(ctx: CombatContext): Promise<LoopResult>;
  stop(reason: string): void;
  isRunning(): boolean;
}
```

**战斗循环状态机:**

```
       ┌─────────────────────────────────────┐
       │                                     │
       ▼                                     │
    [IDLE] ── findTarget() ──► [APPROACH]    │
                                  │           │
                  arrive within attack range  │
                                  ▼           │
                              [ENGAGE]       │
                                  │           │
                              cast skill ────┤
                                  │           │
                          target dead/timeout │
                                  ▼           │
                              [LOOT]  ────────┤
                                  │           │
                              loot done       │
                                  ▼           │
                              [IDLE]         │
                                              │
       异常分支: 被打 / 死亡 / 卡死 → [ALERT]
```

### 5.8 ThreatMonitor

**职责:** 检测被攻击情况,触发自保。

```ts
class ThreatMonitor {
  start(): void;
  stop(): void;

  private async tick(): Promise<void> {
    const hp = await this.coordReader.readSelfHp();
    const dropping = await this.isHpDropping();

    if (hp < 15) this.onCritical();         // 致命:瞬移逃跑
    else if (hp < 40) this.onLowHp();       // 低血:自愈 + 喝药
    else if (dropping) this.onUnderAttack(); // 被攻击:风筝走位
  }

  // 三级响应
  private onCritical()  { /* F7 瞬移 + 暂停脚本 */ }
  private onLowHp()     { /* F8 自愈 + 喝药 */ }
  private onUnderAttack(){ /* 斜线走位风筝 */ }
}
```

**判断"被打"的依据:**

- 血量在连续几次轮询中持续下降
- 屏幕出现红屏特效
- 仇恨列表里有怪(如果有 API)

### 5.9 LootHandler

```ts
class LootHandler {
  async lootNearby(opts: LootOpts): Promise<LootResult> {
    // 1. 找掉落物(地面闪光)
    const drops = await this.findDrops(opts.radius);
    if (drops.length === 0) return { collected: 0 };

    // 2. 过滤白名单 / 黑名单
    const targets = drops.filter(d => !opts.skip.includes(d.itemId));

    // 3. 走过去点
    for (const drop of targets) {
      await this.movement.moveTo(drop.screenPos);
      await this.wait(100);
    }

    return { collected: targets.length };
  }
}
```

### 5.10 CityRun

```ts
class CityRun {
  // 触发:死亡 / 药耗尽 / 背包满
  async run(ctx: RunReason): Promise<RunResult> {
    // 1. 召回
    await this.recallToCity();

    // 2. 主城内补给
    await this.sellJunk();       // 找商人卖垃圾
    await this.repairEquipment();// 找修理
    await this.buyPotions();     // 买血药 / 蓝药

    // 3. 离开主城
    await this.leaveCity();

    // 4. 返回挂机点
    await this.movement.moveTo(this.profile.farmSpot);

    return { ok: true };
  }
}
```

**关键:所有 NPC 位置都从 Profile 读取(玩家可自定义)。**

---

## 6. Profile 系统

### 6.1 Profile 结构

Profile = 一个游戏角色(或一张地图)的所有配置。

```yaml
# profiles/default-farm.yaml
id: default-farm
name: 默认挂机点
game: qqfantasy
server: generic
version: 1

# 窗口匹配规则
windowMatch:
  className: "TMainForm"
  processName: "QQ幻想.exe"
  titlePattern: "QQ幻想.*"

# UI 区域配置(屏幕坐标)
regions:
  minimap: { x: 1700, y: 0, w: 220, h: 220 }
  selfHp: { x: 60, y: 50, w: 200, h: 30 }
  selfMp: { x: 60, y: 90, w: 200, h: 30 }
  targetHp: { x: 800, y: 100, w: 200, h: 20 }
  skillBar: { x: 700, y: 900, w: 500, h: 80 }
  chat: { x: 0, y: 600, w: 400, h: 200 }

# 模板文件
templates:
  mob_normal: ./templates/mob_normal.png
  mob_elite: ./templates/mob_elite.png
  player_arrow: ./templates/player_arrow.png
  drop_white: ./templates/drop_white.png
  drop_blue: ./templates/drop_blue.png

# 数字模板目录(0-9 单独文件)
digitTemplates: ./templates/digits/

# 技能配置
skills:
  - key: F1
    name: 普攻
    cooldownMs: 500
    priority: 1
  - key: F2
    name: 致命一击
    cooldownMs: 6000
    priority: 8
    condition: { type: targetHpAbove, value: 50 }
  - key: F3
    name: 斩杀
    cooldownMs: 12000
    priority: 10
    condition: { type: targetHpBelow, value: 25 }
  - key: F5
    name: AOE
    cooldownMs: 10000
    priority: 6
    condition: { type: nearbyMobsAtLeast, value: 3 }
  - key: F8
    name: 治疗
    cooldownMs: 30000
    priority: 100
    condition: { type: selfHpBelow, value: 40 }

# 战斗策略
combat:
  approachDistance: 8
  combatTimeoutMs: 60000
  healThreshold: 40
  escapeThreshold: 15
  kiteDistance: 12

# 挂机脚本
script:
  type: sequence
  nodes:
    - type: moveTo
      target: { x: 1234, y: 5678 }
    - type: arrive
      target: { x: 1234, y: 5678 }
      threshold: 5
    - type: repeat
      until: { type: inventoryFull }
      nodes:
        - type: findTarget
          filter: { type: mob, levelRange: [1, 30] }
```

### 6.2 玩家自定义工作流

工具内置 **Profile 编辑器**:

- 截图 → 框选区域 → 生成 regions 配置
- 截图 → 抠图 → 生成模板
- 表单填写技能配置
- 一键测试:跑 Profile 5 分钟,看效果

### 6.3 Profile 共享(社区)

- 高级版用户可上传 / 下载社区 Profile
- Profile 评分、下载量
- 必须有 schema 校验(防止恶意 Profile)
- 服务器侧沙箱校验(可选)

---

## 7. IPC 协议

### 7.1 通道定义

```ts
// shared/ipc-channels.ts

// Main → Renderer (推送)
export enum PushChannel {
  WorkerStatus = 'worker.status',          // Worker 状态变化
  WindowList = 'window.list',              // 游戏窗口列表
  CombatEvent = 'combat.event',            // 战斗事件
  Log = 'log',                             // 日志
  Error = 'error',                         // 错误
  UpdateAvailable = 'update.available',    // 有新版本
  LicenseStatus = 'license.status',        // 授权状态
}

// Renderer → Main (请求)
export enum RequestChannel {
  StartWorker = 'worker.start',
  StopWorker = 'worker.stop',
  PauseWorker = 'worker.pause',
  ResumeWorker = 'worker.resume',
  GetWindows = 'window.getList',
  GetProfiles = 'profile.list',
  LoadProfile = 'profile.load',
  SaveProfile = 'profile.save',
  CaptureRegion = 'tool.captureRegion',    // 截图辅助工具
  TestSkill = 'tool.testSkill',            // 测试技能
  ActivateLicense = 'license.activate',
}
```

### 7.2 消息格式

```ts
interface IpcMessage<T = any> {
  id: string;        // UUID,请求 / 响应匹配
  type: 'request' | 'response' | 'event';
  channel: string;
  payload: T;
  timestamp: number;
  error?: { code: string; message: string };
}
```

### 7.3 心跳

- Worker 每 5s 推一次心跳(状态 + CPU + 内存)
- Main 超过 15s 没收到 → 标记为"失联",30s 后回收

---

## 8. 数据存储

### 8.1 目录结构

```
%APPDATA%/QQ幻想助手/
  config.json              # 全局配置
  profiles/
    default-farm.yaml
    my-custom.yaml
  templates/               # 用户自加模板
    custom-mob.png
  logs/
    app-2026-09-11.log
    crash-2026-09-11.log
  cache/
    last-screen-*.png      # 截图缓存(限制大小)
  license.json             # 授权信息
```

### 8.2 加密

- License 字段:对称加密(AES)
- 配置文件:明文(用户可改)
- 模板图片:明文

---

## 9. 目录结构

```
fo-help/
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
│
├── electron/                       # Electron 主进程
│   ├── main.ts                     # 入口
│   ├── preload.ts                  # 预加载脚本
│   ├── ipc/                        # IPC 处理器
│   │   ├── worker.ts
│   │   ├── window.ts
│   │   ├── profile.ts
│   │   └── license.ts
│   └── services/
│       ├── window-registry.ts
│       ├── worker-manager.ts
│       ├── license-manager.ts
│       └── auto-updater.ts
│
├── workers/                        # Worker 脚本
│   └── game-worker.ts              # 每窗口一个 worker 跑这个
│
├── core/                           # 核心引擎(主进程和 Worker 共享)
│   ├── platform/                   # 平台抽象
│   │   ├── vision/
│   │   │   ├── IVisionProvider.ts
│   │   │   ├── damoo/
│   │   │   │   ├── DamooProvider.ts
│   │   │   │   └── bindings.ts
│   │   │   └── native/             # 预留
│   │   │       └── NativeProvider.ts
│   │   └── input/
│   │       ├── IInputProvider.ts
│   │       ├── damoo/
│   │       └── native/
│   │
│   ├── vision/                     # 识别(基于 platform)
│   │   ├── Vision.ts
│   │   ├── ocr.ts
│   │   ├── template.ts
│   │   └── digits.ts
│   │
│   ├── input/
│   │   ├── MouseHumanizer.ts
│   │   ├── KeySimulator.ts
│   │   └── path-planner.ts
│   │
│   ├── state/
│   │   ├── CoordinateReader.ts
│   │   ├── SkillManager.ts
│   │   └── GameState.ts
│   │
│   ├── movement/
│   │   └── MovementEngine.ts
│   │
│   ├── combat/
│   │   ├── TargetFinder.ts
│   │   ├── TargetSelector.ts
│   │   ├── CombatEngine.ts
│   │   └── ThreatMonitor.ts
│   │
│   ├── tasks/
│   │   ├── LootHandler.ts
│   │   └── CityRun.ts
│   │
│   ├── runtime/
│   │   ├── ScriptRuntime.ts
│   │   ├── dsl.ts
│   │   └── interpreter.ts
│   │
│   └── profile/
│       ├── ProfileLoader.ts
│       └── schema.ts
│
├── shared/                         # 主 / Worker / Renderer 共享
│   ├── ipc-channels.ts
│   ├── types.ts
│   ├── events.ts
│   └── constants.ts
│
├── renderer/                       # React UI
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── Home.tsx                # 主面板
│   │   ├── Profiles.tsx            # Profile 管理
│   │   ├── Settings.tsx            # 设置
│   │   └── Logs.tsx                # 日志
│   ├── components/
│   │   ├── WindowCard.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── ProfileEditor.tsx
│   │   └── ...
│   ├── store/
│   │   ├── useWorkerStore.ts
│   │   ├── useProfileStore.ts
│   │   └── useUIStore.ts
│   └── styles/
│
├── profiles/                       # 默认 Profile
│   └── default.yaml
│
├── assets/                         # 资源
│   ├── icon.ico
│   └── templates/                  # 默认模板
│
├── docs/
│   ├── DESIGN.md                   # 本文档
│   ├── adr/                        # 决策记录
│   └── api/                        # API 文档
│
└── scripts/
    ├── build.sh
    └── release.sh
```

---

## 10. 打包与分发

### 10.1 electron-builder 配置(要点)

```yaml
appId: com.fohelp.assistant
productName: QQ幻想助手

directories:
  output: dist
  buildResources: assets

files:
  - dist/**
  - "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}"
  - "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}"
  - "!**/node_modules/*.d.ts"
  - "!**/node_modules/.bin"

extraResources:
  - from: "assets/templates"
    to: "templates"
  - from: "assets/dll"
    to: "dll"

win:
  target:
    - target: nsis
      arch: [x64]
  icon: assets/icon.ico
  # 代码签名(可选)
  # certificateFile: cert.pfx
  # certificatePassword: ${env.CERT_PASS}
  # publisherName: "Your Company"

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: QQ幻想助手
  uninstallDisplayName: QQ幻想助手

publish:
  provider: generic
  url: https://update.fohelp.com/qqfantasy/
  channel: latest
```

### 10.2 自动更新

- 使用 `electron-updater`
- 流程: 启动 → `checkForUpdates()` → 后台下载 → 弹窗提示 → 用户确认 → 重启安装
- 强制更新(关键 bug) / 可选更新(新功能)
- 灰度发布:按版本号分批(20% → 50% → 100%)

### 10.3 代码签名

- 购买 EV 代码签名证书(~$300-1000/年)
- 不签名:用户安装时 SmartScreen 警告
- 签名:无警告,信任度提升
- 建议:第一版不签名,等用户量起来再签

### 10.4 杀软白名单申请

主流杀软白名单:

- 360 安全卫士 / 360 杀毒
- 腾讯电脑管家
- 火绒
- Windows Defender(自动学习)

**实操建议:**

- electron-builder 打出的包结构要让查杀率低
- 避免使用某些被滥用的 Node 模块
- DLL 加载方式要"干净"(不要热加载、不加密)

---

## 11. 订阅/授权模型

### 11.1 功能分级

| 功能 | 免费版 | 高级版 |
|---|---|---|
| 同时运行窗口数 | 1 | 4(可加包) |
| 战斗循环 | ✓ | ✓ |
| 移动 / 拾取 | ✓ | ✓ |
| AOE 群刷 | ✗ | ✓ |
| 回城补给 | ✗ | ✓ |
| 威胁自保 | ✗ | ✓ |
| 自定义 Profile | ✓ | ✓ |
| 云端 Profile 同步 | ✗ | ✓ |
| 优先更新 | ✗ | ✓ |
| 客服支持 | 社区 | 1v1 |

### 11.2 授权实现

**免费版:**

- 无授权,默认功能

**高级版:**

- 用户在官网购买 → 收到激活码
- 工具内输入激活码 → 联网验证
- 验证通过 → 本地存 license token
- 定期(每 7 天)联网校验一次
- **离线宽限期:14 天**(出差 / 断网不阻塞使用)

**机器绑定:**

- License 绑定机器指纹(CPU ID + 主板序列号 hash)
- 同一 License 可绑定 2 台机器(家里 + 公司)

### 11.3 支付方案

- 微信 / 支付宝(通过虎皮椒 / Paddle 等第三方)
- 月付:¥29
- 年付:¥199(优惠 30%+)

---

## 12. 实施阶段

### 12.1 P1:脚手架(3-5 天)

**目标:** 跑通 Electron + Worker + 大漠绑定 + 单窗口连通

**任务清单:**

- [ ] 初始化 Electron + TypeScript + React + Vite
- [ ] 配置 tailwind + 基本布局
- [ ] 主进程 + Worker 通信骨架(MessagePort)
- [ ] 大漠 DLL 绑定(koffi)
- [ ] `IVisionProvider` + `IInputProvider` 接口定义
- [ ] `DamooProvider` 实现 findImage + click + moveMouse
- [ ] WindowRegistry 雏形(枚举窗口)
- [ ] 一个最简 Profile(能识别一张图)
- [ ] UI:窗口列表 + 启动 / 停止按钮
- [ ] 一个最小可运行的 Demo:打开游戏窗口,自动点一张图

**验收:** 点启动 → 自动在游戏里点一张图 → 看到效果

### 12.2 P2:单窗口核心(1-2 周)

**目标:** 移动 + 找怪 + 战斗循环

- [ ] CoordinateReader(小地图读坐标 + HP/MP 数字)
- [ ] Vision 完整(OCR + 数字模板 + 颜色)
- [ ] MovementEngine(点击地面 + 到达判定)
- [ ] SkillManager(F1-F9 冷却)
- [ ] TargetFinder(头顶名字 OCR)
- [ ] CombatEngine(简单循环)
- [ ] ScriptRuntime + DSL(基础节点)
- [ ] Profile YAML 加载

**验收:** 启动 → 走到挂机点 → 找怪 → 打怪 → 拾取,持续 1 小时不掉

### 12.3 P3:多窗口(1 周)

**目标:** Worker 池 + UI 状态面板

- [ ] WorkerManager(分配 / 回收)
- [ ] 每个窗口独立 Profile
- [ ] 状态面板(每窗口一个卡片)
- [ ] 日志面板(实时日志)
- [ ] 异常告警(弹窗 / 声音)
- [ ] 基础 Profile 编辑器

**验收:** 同时挂 3 个窗口,各自独立战斗,UI 实时显示状态

### 12.4 P4:高级特性(2 周+)

**目标:** AOE + 回城 + 威胁自保 + 自定义 Profile + 高级版

- [ ] ThreatMonitor(三级响应)
- [ ] LootHandler(白名单 / 黑名单)
- [ ] CityRun(回城补给流程)
- [ ] 自研 VisionProvider(开始迁移)
- [ ] 完整 Profile 编辑器(截图 → 框选)
- [ ] License 验证
- [ ] 自动更新
- [ ] 崩溃上报

**验收:** 全自动挂机循环 4 小时,无人工干预,异常自动回城

### 12.5 P5:分发准备(1 周)

- [ ] electron-builder 打包
- [ ] 自动更新服务器
- [ ] 官网(下载页 + 购买页)
- [ ] 文档(README + 使用手册 + 视频)
- [ ] 客服入口
- [ ] 灰度发布

---

## 13. 风险与开放问题

### 13.1 技术风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 大漠 DLL 加载失败 | 全功能不可用 | 提示用户安装 / 切到自研 |
| 杀软报毒 | 用户流失 | 签名 + 白名单申请 |
| SmartScreen 警告 | 安装率下降 | 证书 + 用户教育 |
| QQ幻想 私服版本差异 | Profile 失效 | Profile 多版本 + 玩家自定 |
| 2.5D 坐标精度 | 走位偏差 | 小地图 + 屏幕双校验 |
| 反外挂检测(私服) | 封号 | 拟人化点击 + 随机延迟 |

### 13.2 业务风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 私服关服 | 用户归零 | 扩展其他老游戏 |
| 法律风险 | 工具被封 | 免责声明 + 不绕过客户端 |
| 付费转化率低 | 收入不足 | 免费版够用,高级版是体验升级 |
| 客服压力 | 人力成本 | 文档 + FAQ + 社区 |
| 盗版 | 收入损失 | 联网校验 + 机器绑定 |

### 13.3 开放问题(待定)

- [ ] QQ幻想 私服是已经确定的吗?还是需要支持多个老游戏?
- [ ] 更新服务器用云服务(阿里云 OSS)还是自建?
- [ ] 支付平台选哪个?(微信支付 / 虎皮椒 / Paddle)
- [ ] 客服是用 QQ 群还是独立 IM?
- [ ] 是否需要 Discord / QQ 频道做用户社区?
- [ ] 第一个上线版本是只支持单窗口免费,还是直接做完整版?

---

## 附录 A:参考资料

- 大漠插件接口文档(私有)
- Electron 官方文档:https://www.electronjs.org/
- electron-builder:https://www.electron.build/
- electron-updater:https://www.electron.build/auto-update
- Sentry Electron:https://docs.sentry.io/platforms/javascript/guides/electron/

---

**文档结束。** 审阅后提修改意见,定稿后进入 P1 实施。
