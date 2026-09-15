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
export type TaskType =
  | 'farm'
  | 'mine'
  | 'catch-pet'
  | 'refine'
  | 'reputation';

/** 脚本状态(主面板卡片显示) */
export type ScriptStatus =
  | 'idle'      // 空闲
  | 'combat'    // 战斗中
  | 'moving'    // 移动中
  | 'resupply'  // 回城中
  | 'alert'     // 异常
  | 'paused';   // 暂停

/** 任务名称(显示用) */
export type TaskName =
  | '挂机打怪'
  | '挖矿'
  | '捕捉宠物'
  | '装备炼化'
  | '名誉任务';

/** 路径点 */
export interface Waypoint {
  id: string;
  x: number;
  y: number;
  /** farm-spot = 挂机点 / rest = 休息点(回血回蓝) / path = 路径中间点 */
  type: 'farm-spot' | 'rest' | 'path';
  note?: string;
}

/** 挂机打怪任务配置 */
export interface FarmTaskConfig {
  type: 'farm';
  /** 地图 ID(预置 + 自定义) */
  mapId: string;
  /** 自定义地图名(mapId='custom' 时用) */
  customMapName?: string;
  /** 打怪模式: single=单怪 / aoe=AOE 群刷 / patrol=路径巡逻 */
  mode: 'single' | 'aoe' | 'patrol';
  /** 路径点列表(patrol 模式必填) */
  waypoints: Waypoint[];
  /** 找怪关键字 */
  mobFilter: {
    nameKeywords: string[];
    minLevel?: number;
    maxLevel?: number;
  };
  /** 自定义备注 */
  note?: string;
}

/** 留白任务配置(后续实现) */
export interface PlaceholderTaskConfig {
  type: 'mine' | 'catch-pet' | 'refine' | 'reputation';
  _todo?: never;
}

/** 任务配置联合类型 */
export type TaskConfig = FarmTaskConfig | PlaceholderTaskConfig;

/** 任务配置存储(挂到 window) */
export interface StoredTaskConfig {
  id: string;            // 唯一 ID
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

/** IPC 消息基础结构 */
export interface IpcMessage<T = unknown> {
  id: string;
  type: 'request' | 'response' | 'event';
  channel: string;
  payload: T;
  timestamp: number;
  error?: { code: string; message: string };
}
