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
  startWorker: (hwnd: number, characterName: string, taskType: TaskType, profileId?: string) => Promise<{ ok: boolean; workerId?: string; error?: string }>;
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
