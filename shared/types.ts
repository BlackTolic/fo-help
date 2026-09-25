// 共享类型定义(主进程 / Worker / Renderer 三端通用)

/** 游戏窗口信息 */
export interface GameWindow {
  hwnd: number;
  pid: number;
  title: string;
  className: string;
  processName: string;
  rect: { x: number; y: number; w: number; h: number };
  isForeground: boolean;
  isMinimized: boolean;
}

/** 角色信息(从 Profile 读) */
export interface CharacterInfo {
  name: string;
  class: 'warrior' | 'mage' | 'taoist' | 'archer' | 'assassin';
  level: number;
}

/** 任务类型 */
export type TaskType = 'farm' | 'mine' | 'catch-pet' | 'refine' | 'reputation' | 'default-skill';

/** 脚本状态(主面板卡片显示) */
export type ScriptStatus =
  | 'idle' // 已停止 / 未运行(无 task)
  | 'pending' // bootstrap 已就绪,等待 start-task 启动命令
  | 'combat' // 战斗中
  | 'moving' // 移动中
  | 'resupply' // 回城中
  | 'alert' // 异常
  | 'paused'; // 暂停

/** 任务名称(显示用) */
export type TaskName = '挂机打怪' | '挖矿' | '捕捉宠物' | '装备炼化' | '名誉任务' | '缺省技能';

/** 路径点 */
export interface Waypoint {
  id: string;
  x: number;
  y: number;
  /** farm-spot = 挂机点(可绑定技能) / rest = 休息点(回血回蓝) / path = 路径中间点 */
  type: 'farm-spot' | 'rest' | 'path';
  /** 挂机点绑定的技能 id 列表(引用 FarmTaskConfig.skills;空/未配 = worker 回退为全部技能) */
  skillIds?: string[];
  note?: string;
}

/** 技能施法方式 */
export type SkillCastMethod =
  | 'quick' // 快捷施法:只按键
  | 'target' // 缺省施法:按键 + 鼠标左键点击目标坐标
  | 'self'; // 状态施法:点击角色自身 + 按键(自身 buff 类)

/** 挂机打怪技能配置(任务级;路径点通过 skillIds 引用其中若干个) */
export interface FarmSkillConfig {
  /** 唯一 id(UI 排序/删除 + 路径点绑定用) */
  id: string;
  /** 技能键(F1-F10) */
  key: string;
  /** 技能名称(便于在路径点绑定界面辨认) */
  name?: string;
  /** 技能时间间隔/冷却(毫秒,两次释放之间的最短间隔) */
  cooldownMs: number;
  /** 技能吟唱时间(毫秒):target=按键后等多久再点鼠标;quick/self=按键后等多久再放下一个技能 */
  castMs?: number;
  /** 施法距离(屏幕像素,以角色为圆心):定点打怪=缺省施法技能落点离自身的距离(0=默认300px);定点识别=超出该距离的怪跳过不打 */
  rangePx?: number;
  /** 施法方式(默认 target,兼容旧配置) */
  method?: SkillCastMethod;
  /** 是否启用(临时禁用不删除) */
  enabled?: boolean;
  /** 备注 */
  note?: string;
}

/** 挂机打怪模式: fixed=定点打怪 / fixed-detect=定点识别 / move-detect=移动识别 */
export type FarmMode = 'fixed' | 'fixed-detect' | 'move-detect';

/** 挂机打怪施法方式: smart=智能施法(每个挂机点自动选一个可释放技能) / custom=自定义施法(按路径点绑定的技能) */
export type FarmCastMode = 'smart' | 'custom';

/** 挂机打怪任务配置 */
export interface FarmTaskConfig {
  type: 'farm';
  /** 地图 ID(预置 + 自定义) */
  mapId: string;
  /** 自定义地图名(mapId='custom' 时用) */
  customMapName?: string;
  /** 打怪模式: fixed=定点打怪(固定技能) / fixed-detect=定点识别 / move-detect=移动识别 */
  mode: FarmMode;
  /** 施法方式: smart=智能施法(每个挂机点从全部技能里选一个 CD 最长的可释放技能;不绑定点技能) / custom=自定义施法(按路径点绑定的 skillIds,不选=全部);缺省 = smart */
  castMode?: FarmCastMode;
  /** 路径点列表(patrol 模式必填;移动攻击测试作为 A→B→C… 移动路径) */
  waypoints: Waypoint[];
  /** 找怪配置 */
  mobFilter: {
    nameKeywords: string[];
    minLevel?: number;
    maxLevel?: number;
    /** 怪名字颜色(大漠颜色格式,如 'FFFFFF-FFFFFF';移动攻击测试找怪用) */
    nameColor?: string;
  };
  /** 任务级技能列表(路径点通过 skillIds 引用;空 = 用 worker 内置默认) */
  skills?: FarmSkillConfig[];
  /** 角色移动间隔(毫秒):移动一步后等多久再读坐标,越小走位越频繁(worker 的 stepIntervalMs) */
  movementSpeed?: number;
  /** 自定义备注 */
  note?: string;
}

/**
 * 缺省技能任务步骤 — 一个"按键动作" + 它的执行参数
 *
 * 设计要点(数据驱动):
 * - key 用字符串描述(F1/Alt+F2/Shift+F3),shared/key-combo.ts 提供解析
 * - 按键后立刻 keyUp,不在 worker 里阻塞 — 防按住期间被检测
 * - intervalMs = 按键抬起后到下一次按键的间隔(毫秒),用来调频率
 * - holdMs = 按键按住时长(毫秒,可选),默认 50ms;有长按需求时调大
 *
 * 例:连击 F1 每 200ms 一次 = { key:'F1', intervalMs:200, holdMs:50 }
 * 例:Alt+F1 慢放 = { key:'Alt+F1', intervalMs:1500, holdMs:80 }
 */
export interface DefaultSkillStep {
  /** 唯一 id(数组 reorder / delete 用,不要给业务用) */
  id: string;
  /** 按键描述:F1~F12 / Alt+F1~F12 / Shift+F1~F10 */
  key: string;
  /** 按键之间的间隔(毫秒) — 抬起主键后等多久再按下一个 */
  intervalMs: number;
  /** 按键按住时长(毫秒,可选,默认 50ms) */
  holdMs?: number;
  /** 该步骤是否启用(临时禁用某个步骤不删它) */
  enabled?: boolean;
  /** 备注 */
  note?: string;
}

/**
 * 缺省技能任务配置
 * - 按 steps 数组顺序执行,执行完一遍后等待 loopIntervalMs 再来一遍
 * - loopCount = 0 表示无限循环(默认)
 * - 没有 OCR / 战斗状态判定:纯按键编排,玩家自己承担"何时该按"的责任
 *   (这是"缺省技能"名字的由来:把一组固定按键循环跑下去)
 */
export interface DefaultSkillTaskConfig {
  type: 'default-skill';
  /** 按键步骤(按数组顺序执行) */
  steps: DefaultSkillStep[];
  /** 循环次数,0 = 无限循环 */
  loopCount: number;
  /** 一轮 steps 跑完到下一轮之间的间隔(毫秒) */
  loopIntervalMs: number;
  /** 备注 */
  note?: string;
}

/** 留白任务配置(后续实现) */
export interface PlaceholderTaskConfig {
  type: 'mine' | 'catch-pet' | 'refine' | 'reputation';
  _todo?: never;
}

/** 任务配置联合类型 */
export type TaskConfig = FarmTaskConfig | PlaceholderTaskConfig | DefaultSkillTaskConfig;

/** 任务配置存储(按"任务名"维度存储,跨窗口复用) */
export interface StoredTaskConfig {
  id: string; // 唯一 ID(默认等于 name,但允许 name 重命名时保留稳定 id)
  /** 用户自定义的任务名(全局唯一,创建时必填,跨窗口复用) */
  name: string;
  taskType: TaskType;
  config: TaskConfig;
  createdAt: number;
  updatedAt: number;
}

/** Worker 状态(上报给主面板) */
export interface WorkerState {
  workerId: string;
  hwnd: number;
  character: CharacterInfo | null;
  taskType: TaskType | null;
  taskName: TaskName | null;
  status: ScriptStatus;
  statusDetail?: string;
  startedAt: number | null;
  stats: {
    killCount: number;
    deathCount: number;
    uptimeMs: number;
  };
  /** 当前任务配置(挂机打怪才有) */
  taskConfig?: TaskConfig;
  /** 缩略图(base64 dataURL,可选) */
  thumbnail?: string;
  /** 子进程是否已 ready(顶层代码执行完,message listener 已注册,可以安全发命令) */
  ready?: boolean;
}
