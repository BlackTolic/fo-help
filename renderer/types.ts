// 全局声明:window.fohelp (preload 暴露的 API)

import type { GameWindow, TaskType, TaskConfig, WorkerState } from '../shared/types';

export interface ProfileInfo {
  id: string;
  name: string;
  description?: string;
  file: string;
}

interface FohelpAPI {
  listGameWindows: () => Promise<GameWindow[]>;
  refreshGameWindows: () => Promise<GameWindow[]>;
  captureWindow: (hwnd: number) => Promise<string | null>;
  recaptureThumbnail: (hwnd: number) => Promise<string | null>;
  startWorker: (hwnd: number, characterName: string, taskType: TaskType, profileId?: string) => Promise<{ ok: boolean; workerId?: string; error?: string }>;
  /** Bootstrap 模式:启动 worker 停在 idle 等命令,返回 thumbnail + characterName */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
    profileId?: string,
  ) => Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }>;
  /** 给已 bootstrap 的 worker 发 start-task,进入战斗 */
  startTask: (hwnd: number) => Promise<{ ok: boolean }>;
  /** 通过 hwnd 停 worker(用于取消 bootstrap) */
  stopWorkerByHwnd: (hwnd: number) => Promise<{ ok: boolean }>;
  stopWorker: (workerId: string) => Promise<boolean>;
  pauseWorker: (workerId: string) => Promise<boolean>;
  resumeWorker: (workerId: string) => Promise<boolean>;
  listWorkers: () => Promise<WorkerState[]>;
  saveTaskConfig: (hwnd: number, config: TaskConfig) => Promise<any>;
  getTaskConfig: (hwnd: number) => Promise<any>;
  listProfiles: () => Promise<ProfileInfo[]>;
  loadProfile: (id: string) => Promise<any>;
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
