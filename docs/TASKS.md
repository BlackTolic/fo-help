# 任务系统详细设计

> **版本:** v1.0 · **更新日期:** 2026-09-11 · **状态:** 设计阶段
>
> 本文档是 `DESIGN.md` 的补充,聚焦 5 种任务的实现细节。

---

## 目录

1. [任务系统总览](#1-任务系统总览)
2. [主面板卡片规范](#2-主面板卡片规范)
3. [职业体系](#3-职业体系)
4. [5 种任务详细设计](#4-5-种任务详细设计)
5. [任务调度](#5-任务调度)

---

## 1. 任务系统总览

QQ幻想助手支持 5 种任务类型:

| 任务     | 复杂度 | 涉及模块                     | 实现优先级 |
| -------- | ------ | ---------------------------- | ---------- |
| 挂机打怪 | ★★★★★  | 全模块                       | **P2**     |
| 挖矿     | ★★     | 移动 + UI 操作               | **P2**     |
| 捕捉宠物 | ★★★    | 移动 + 战斗 + 拾取           | **P3**     |
| 装备炼化 | ★★★    | 纯 UI 操作                   | **P3**     |
| 名誉任务 | ★★★★   | 移动 + 任务检测 + 多种子任务 | **P4**     |

**统一抽象:**

```ts
interface Task {
  id: string;
  type: TaskType;
  name: string;
  config: TaskConfig;
  start(ctx: TaskContext): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  getStatus(): TaskStatus;
  onStatusChange(cb: (status: TaskStatus) => void): void;
}

type TaskType = 'farm' | 'mine' | 'catch-pet' | 'refine' | 'reputation';

type TaskStatus =
  | { state: 'idle' }
  | { state: 'running'; subState: string; progress?: number }
  | { state: 'paused' }
  | { state: 'alert'; reason: string }
  | { state: 'stopped' };
```

**任务通用状态机:**

```
   start()        pause()       stop()
[IDLE] ────► [RUNNING] ◄──► [PAUSED] ────► [STOPPED]
                │
                │ 异常 / 完成
                ▼
            [ALERT]
                │
                └─► 自行恢复 / 用户介入 → 回 IDLE 或 STOPPED
```

**任务调度(单窗口串行):**

一个窗口同一时间只跑 1 个任务。可以手动切换,也可以定时自动切换。

---

## 2. 主面板卡片规范

**每个游戏窗口一张卡片,只显示 4 个元素:**

```
┌────────────────────────┐
│                        │
│      实时缩略图         │  ← 240×180,5-10 FPS
│                        │
├────────────────────────┤
│ ⚔ 战士·大号              │  ← 角色名称
│ 任务: 挂机打怪           │  ← 当前任务名称
│ 状态: ● 战斗中           │  ← 脚本状态
└────────────────────────┘
```

### 状态定义(全局)

| 状态 | 颜色 | 文字        | 含义                  |
| ---- | ---- | ----------- | --------------------- |
| 空闲 | 灰   | `○ 空闲`    | 启动中 / 等待 Profile |
| 战斗 | 红   | `● 战斗中`  | 找怪 + 打             |
| 移动 | 蓝   | `→ 移动中`  | 走路 / 寻路           |
| 补给 | 紫   | `🏠 回城中` | 回城补给              |
| 异常 | 黄   | `⚠ 异常`   | 卡死 / 报错           |
| 暂停 | 暗   | `⏸ 暂停`   | 用户暂停              |

### 任务名(可能为以下值)

- `挂机打怪` / `挖矿` / `捕捉宠物` / `装备炼化` / `名誉任务`
- 或者更细:`挂机打怪·狐牙山` / `挖矿·矿区北`

### 角色名

来自 Profile 配置,玩家自定义。

---

## 3. 职业体系

**设计决策:内置 5 职业模板 + 玩家可微调。**

### 内置 5 职业(开箱即用)

| 职业 | 攻击类型 | 战斗风格 | 特点                        |
| ---- | -------- | -------- | --------------------------- |
| 战士 | 近战     | 拉扯     | 站前排,嘲讽聚怪,AOE 旋风斩  |
| 法师 | 远攻     | 后排     | 拉开距离,大范围 AOE,脆皮    |
| 道士 | 远攻     | 辅助     | 召唤宝宝,加血加 buff,慢但稳 |
| 弓手 | 远攻     | 风筝     | 单体高伤,边走边射,持续输出  |
| 刺客 | 近战     | 切入     | 高暴击,切入后排,秒脆皮      |

### 职业配置 Schema(Profile 内)

```yaml
class:
  name: 战士
  attackType: melee # melee | ranged
  combatStyle: pull # pull | aoe | single | kite
  idealDistance: 3 # 理想作战距离(像素)
  movementSpeed: 200 # 战斗内移动间隔 ms

  # F1-F9 技能槽
  skills:
    F1:
      name: 普攻
      type: basic
      cooldownMs: 500
    F2:
      name: 冲撞
      type: gap_close
      cooldownMs: 8000
      condition:
        type: distance
        op: greater_than
        value: 5
    F3:
      name: 旋风斩
      type: aoe
      cooldownMs: 12000
      condition:
        type: nearbyMobs
        op: at_least
        value: 3
    F4:
      name: 嘲讽
      type: threat
      cooldownMs: 30000
      condition:
        type: selfHp
        op: less_than
        value: 50
    F8:
      name: 暴怒
      type: heal
      cooldownMs: 60000
      condition:
        type: selfHp
        op: less_than
        value: 30

  # 药水/特殊按键(Q W E R 等)
  potions:
    Q:
      type: hp_potion
      trigger:
        type: selfHp
        op: less_than
        value: 60
    W:
      type: mp_potion
      trigger:
        type: selfMp
        op: less_than
        value: 30
    E:
      type: buff
      trigger:
        type: onCombatStart
        value: true
    R:
      type: emergency_teleport
      trigger:
        type: selfHp
        op: less_than
        value: 15
```

### 触发条件类型

```yaml
condition:
  type: selfHp | selfMp | targetHp | nearbyMobs | distance | onCombatStart
  op: less_than | greater_than | equal | at_least | at_most
  value: <number | boolean>
```

### 战斗风格 → 走位逻辑

| 风格               | 走位                    |
| ------------------ | ----------------------- |
| `single`(单体站桩) | 不移动                  |
| `aoe`(AOE 群攻)    | 走位到怪群质心          |
| `pull`(拉扯)       | 怪太近后退,维持理想距离 |
| `kite`(风筝)       | 持续移动,斜向走位       |
| `backline`(后排)   | 永远在队伍后方,远离前线 |

### 智能选技

每帧重算分,过滤冷却 + 过滤条件,按优先级选最优技能:

```ts
pickBest(ctx: CombatContext): SkillConfig | null {
  const candidates = this.skills.filter(s => {
    // 冷却过滤
    const last = this.lastCastTime.get(s.key) || 0;
    if (Date.now() - last < s.cooldownMs) return false;
    // 条件过滤
    return this.evalCondition(s.condition, ctx);
  });
  if (candidates.length === 0) return null;
  // 优先级降序
  candidates.sort((a, b) => (b.priority || 1) - (a.priority || 1));
  return candidates[0];
}
```

---

## 4. 5 种任务详细设计

### 4.1 挂机打怪(FarmTask)★ P2

**最复杂任务**,做完后其他任务都是它的子集。

**状态机:**

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
                  target dead/timeout     │
                              ▼           │
                          [LOOT]  ────────┤
                              │           │
                          loot done       │
                              ▼           │
                          [IDLE]         │
                                              │
   异常分支: 被打 / 死亡 / 卡死 → [ALERT]
```

**关键模块:**

- `TargetFinder` - OCR 头顶名字 + 等级
- `MovementEngine.approach()` - 走到理想距离
- `CombatEngine` - 智能选技 + 走位 + 药水
- `ThreatMonitor` - 威胁检测 + 风筝
- `LootHandler` - 拾取掉落
- `CityRun` - 触发:死亡 / 药耗尽 / 背包满

**执行入口:**

```ts
class FarmTask implements Task {
  async start(ctx: TaskContext) {
    while (this.running) {
      // 1. 检查补给
      if (await this.needResupply()) {
        await this.cityRun.run();
        continue;
      }

      // 2. 找目标
      const target = await this.targetFinder.find(this.config.filter);
      if (!target) {
        await this.wait(1000);
        continue;
      }

      // 3. 接近
      await this.movement.approach(target, this.profile.class.idealDistance);

      // 4. 战斗
      await this.combatLoop(target);

      // 5. 拾取
      await this.loot.lootNearby(this.config.lootFilter);
    }
  }
}
```

### 4.2 挖矿(MineTask)★★ P2

**最简单任务**,纯移动 + UI 操作,用于快速验证引擎。

**状态机:**

```
[IDLE] → FIND_MINE → APPROACH → MINE → LOOT → NEXT_MINE
                                       │
                                       └─► 没矿了 → 换地图 / IDLE
```

**关键点:**

- 矿点位置固定(Profile 配置)
- 小地图找矿点图标
- 挖矿动作:连续按键 3-5 次(模拟"按住点击")
- 拾取:和其他任务共用 LootHandler

**执行入口:**

```ts
class MineTask implements Task {
  async start(ctx: TaskContext) {
    for (const mine of this.config.mines) {
      // 1. 走到矿点
      await this.movement.moveTo(mine.worldPos);

      // 2. 挖(连续按键)
      for (let i = 0; i < 5; i++) {
        await this.input.pressKey(this.config.mineKey);
        await this.wait(200);
      }

      // 3. 拾取
      await this.loot.lootNearby();
    }
  }
}
```

### 4.3 捕捉宠物(CatchPetTask)★★★ P3

**状态机:**

```
[IDLE] → SEARCH → APPROACH → CAPTURE → JUDGE
                                    │
                                    ├─► 成功 → LOOT → 下一只
                                    └─► 失败 → 换目标 / 等 CD
```

**关键点:**

- 捕捉技能 CD 较长(常 30-60s)
- **CD 期间可配置做别的事**(打别的怪练级)
- OCR 识别"捕捉成功"提示(进背包提示 vs 失败提示)
- 失败重试:可能 N 次后换目标

### 4.4 装备炼化(RefineTask)★★★ P3

**状态机:**

```
[IDLE] → OPEN_UI → DEPOSIT → START → WAIT → COLLECT → 循环
```

**关键点:**

- **全 UI 操作**,不涉及移动和战斗
- 炼化炉位置固定(Profile 配置)
- 装备/材料格子位置固定
- 进度条识别(读"炼化中..."文字 + 进度条颜色)
- 可能需要切换角色(不同装备在不同角色身上)

### 4.5 名誉任务(ReputationTask)★★★★ P4

**最复杂任务之一**,因为任务种类多。

**状态机:**

```
[IDLE] → ACCEPT_TASK → 任务类型判断
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    [打怪型]           [采集型]           [送信型]
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                     [COMPLETE] → RETURN_TASK → 换任务
```

**关键点:**

- 任务列表 UI 检测(对话框、任务面板)
- 任务目标自动解析(显示在屏幕)
- 多种子任务类型:打怪 / 采集 / 送物
- 路径:接任务 NPC → 任务地点 → 交任务 NPC
- 所有 NPC 位置 Profile 配置

---

## 5. 任务调度

### 5.1 手动切换

主面板卡片 → 右键菜单 → 选择任务 → 选择 Profile → 启动

### 5.2 定时任务(自动调度)

Profile 中可配置 schedule,按时间段自动切换:

```yaml
schedule:
  - start: '00:00'
    end: '08:00'
    task: 挂机打怪
    profile: 狐牙山-战士

  - start: '08:00'
    end: '09:00'
    task: 挖矿
    profile: 矿区-铁矿

  - start: '09:00'
    end: '10:00'
    task: 装备炼化
    profile: 默认炼化
```

**调度器逻辑:**

- 每分钟检查一次当前时间
- 匹配到 schedule 段 → 自动切换任务
- 任务切换 = 停止当前 + 启动下一个
- 切换有 5-10s 缓冲(避免瞬切)
- 用户手动切换会**覆盖 schedule**,直到下个时间段

---

## 6. 验收清单(任务系统)

- [ ] 5 种任务都能独立启动 / 暂停 / 停止
- [ ] 5 种任务都能上报状态到主面板卡片
- [ ] 内置 5 职业模板,玩家可微调
- [ ] 智能选技按优先级 + 条件工作
- [ ] 战斗风格走位(单/aoe/pull/kite/backline)各自工作
- [ ] 手动切换 + 定时调度都能用
- [ ] 任务切换有平滑过渡(不停 Worker)
