// 全局声明:window.fohelp (preload 暴露的 API)

import type {
  GameWindow,
  TaskType,
  TaskConfig,
  WorkerState,
  StoredTaskConfig,
} from '../shared/types';

interface FohelpAPI {
  listGameWindows: () => Promise<GameWindow[]>;
  refreshGameWindows: () => Promise<GameWindow[]>;
  captureWindow: (hwnd: number) => Promise<string | null>;
  recaptureThumbnail: (hwnd: number) => Promise<string | null>;
  startWorker: (
    hwnd: number,
    characterName: string,
    taskType: TaskType,
  ) => Promise<{ ok: boolean; workerId?: string; error?: string }>;
  /** Bootstrap 模式:启动 worker 停在 idle 等命令,返回 thumbnail + characterName */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
  ) => Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }>;
  /** 给已 bootstrap 的 worker 发 start-task,进入战斗 */
  startTask: (hwnd: number) => Promise<{ ok: boolean }>;
  /** 通过 hwnd 停 worker(用于取消 bootstrap) */
  stopWorkerByHwnd: (hwnd: number) => Promise<{ ok: boolean }>;
  /** 截图测试:截一张到 thumbnails/test-<hwnd>-<ts>.png,返回 filePath */
  captureTest: (hwnd: number) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  /** Windows 资源管理器高亮显示文件 */
  showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
  stopWorker: (workerId: string) => Promise<boolean>;
  pauseWorker: (workerId: string) => Promise<boolean>;
  resumeWorker: (workerId: string) => Promise<boolean>;
  listWorkers: () => Promise<WorkerState[]>;
  /** 检查大漠 dll 是否已注册到当前项目自带的 dm.dll */
  checkDamoo: () => Promise<{
    ok: boolean;
    status?: {
      kind: 'ok' | 'wrong' | 'missing' | 'no-dll';
      path?: string;
      registeredPath?: string;
      expectedPath?: string;
      reason?: string;
    };
    message?: string;
    error?: string;
  }>;
  /** 触发 UAC → regsvr32 /s 注册项目自带的 dm.dll(用户需在桌面 UAC 弹窗点"是") */
  registerDamoo: () => Promise<{ ok: boolean; error?: string }>;
  /** 保存任务配置(按 name 唯一,重名拒绝) */
  saveTaskConfig: (
    hwnd: number,
    config: TaskConfig,
    name: string,
  ) => Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }>;
  /** 列出所有已保存的任务(全局) */
  listAllTaskConfigs: () => Promise<StoredTaskConfig[]>;
  /** 按任务名加载配置 */
  loadTaskByName: (name: string) => Promise<StoredTaskConfig | null>;
  /** 原地更新已有任务(保留 id/createdAt),用于历史任务编辑 */
  updateTaskConfig: (
    name: string,
    config: TaskConfig,
  ) => Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }>;
  /** 旧 API 保留(返回 null) */
  getTaskConfig: (hwnd: number) => Promise<TaskConfig | null>;
  onWorkerStateChanged: (cb: (state: WorkerState) => void) => () => void;
  onWorkerLog: (
    cb: (log: { workerId: string; level: string; msg: string; timestamp: number }) => void,
  ) => () => void;
  onWorkerError: (
    cb: (err: { workerId: string; error: any; timestamp: number }) => void,
  ) => () => void;
  onThumbnailUpdate: (cb: (data: { hwnd: number; dataUrl: string | null }) => void) => () => void;
}

declare global {
  interface Window {
    fohelp: FohelpAPI;
  }
}

export {};
