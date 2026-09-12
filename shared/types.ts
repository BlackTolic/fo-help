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

/** Worker 状态(上报给主面板) */
export interface WorkerState {
  workerId: string;
  hwnd: number;
  character: CharacterInfo | null;
  taskType: TaskType | null;
  taskName: TaskName | null;
  status: ScriptStatus;
  statusDetail?: string;       // 状态详细描述(比如"战斗中 - 目标:野狼")
  startedAt: number | null;    // 启动时间戳
  stats: {
    killCount: number;
    deathCount: number;
    uptimeMs: number;
  };
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
