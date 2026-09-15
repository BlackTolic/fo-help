// 全局声明:window.fohelp (preload 暴露的 API)

import type { GameWindow, TaskType, TaskConfig, WorkerState, StoredTaskConfig } from '../shared/types';

interface FohelpAPI {
  listGameWindows: () => Promise<GameWindow[]>;
  refreshGameWindows: () => Promise<GameWindow[]>;
  captureWindow: (hwnd: number) => Promise<string | null>;
  recaptureThumbnail: (hwnd: number) => Promise<string | null>;
  startWorker: (hwnd: number, characterName: string, taskType: TaskType) => Promise<{ ok: boolean; workerId?: string; error?: string }>;
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
  /** 旧 API 保留(返回 null) */
  getTaskConfig: (hwnd: number) => Promise<TaskConfig | null>;
  onWorkerStateChanged: (cb: (state: WorkerState) => void) => () => void;
  onWorkerLog: (cb: (log: { workerId: string; level: string; msg: string; timestamp: number }) => void) => () => void;
  onWorkerError: (cb: (err: { workerId: string; error: any; timestamp: number }) => void) => () => void;
  onThumbnailUpdate: (cb: (data: { hwnd: number; dataUrl: string | null }) => void) => () => void;
}

declare global {
  interface Window {
    fohelp: FohelpAPI;
  }
}

export {};
