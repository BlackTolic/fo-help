// 预加载脚本:把 IPC 能力安全地暴露给渲染进程

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { RequestChannel, PushChannel } from '../shared/ipc-channels';
import type { GameWindow, TaskType, TaskConfig, WorkerState } from '../shared/types';

// 类型化 API
const api = {
  // 窗口
  listGameWindows: (): Promise<GameWindow[]> =>
    ipcRenderer.invoke(RequestChannel.ListGameWindows),

  refreshGameWindows: (): Promise<GameWindow[]> =>
    ipcRenderer.invoke(RequestChannel.RefreshGameWindows),

  captureWindow: (hwnd: number): Promise<string | null> =>
    ipcRenderer.invoke(RequestChannel.CaptureWindow, hwnd),

  // 强制重截某窗口的缩略图(清缓存)
  recaptureThumbnail: (hwnd: number): Promise<string | null> =>
    ipcRenderer.invoke('thumbnail:recapture', hwnd),

  // Worker
  startWorker: (hwnd: number, characterName: string, taskType: TaskType, profileId?: string) =>
    ipcRenderer.invoke(RequestChannel.StartWorker, { hwnd, characterName, taskType, profileId }),

  /** Bootstrap 模式:启动 worker 但停在 idle,等 thumbnail + start-task */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
    profileId?: string,
  ): Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.BootstrapWorker, { hwnd, characterName, profileId }),

  /** 给已 bootstrap 的 worker 发 start-task,进入战斗 */
  startTask: (hwnd: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(RequestChannel.StartTask, hwnd),

  /** 通过 hwnd 停止(用于取消 bootstrap) */
  stopWorkerByHwnd: (hwnd: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(RequestChannel.StopWorkerByHwnd, hwnd),

  stopWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.StopWorker, workerId),

  pauseWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.PauseWorker, workerId),

  resumeWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.ResumeWorker, workerId),

  listWorkers: (): Promise<WorkerState[]> => ipcRenderer.invoke(RequestChannel.ListWorkers),

  // 任务配置
  saveTaskConfig: (hwnd: number, config: TaskConfig) =>
    ipcRenderer.invoke(RequestChannel.SaveTaskConfig, hwnd, config),
  getTaskConfig: (hwnd: number) =>
    ipcRenderer.invoke(RequestChannel.GetTaskConfig, hwnd),

  // Profile
  listProfiles: (): Promise<any[]> => ipcRenderer.invoke(RequestChannel.ListProfiles),
  loadProfile: (id: string): Promise<any> => ipcRenderer.invoke(RequestChannel.LoadProfile, id),

  // 事件订阅
  onWorkerStateChanged: (cb: (state: WorkerState) => void) => {
    const listener = (_e: IpcRendererEvent, payload: WorkerState) => cb(payload);
    ipcRenderer.on(PushChannel.WorkerStateChanged, listener);
    return () => ipcRenderer.removeListener(PushChannel.WorkerStateChanged, listener);
  },

  onWorkerLog: (cb: (log: { workerId: string; level: string; msg: string; timestamp: number }) => void) => {
    const listener = (_e: IpcRendererEvent, payload: any) => cb(payload);
    ipcRenderer.on(PushChannel.WorkerLog, listener);
    return () => ipcRenderer.removeListener(PushChannel.WorkerLog, listener);
  },

  onWorkerError: (cb: (err: { workerId: string; error: any; timestamp: number }) => void) => {
    const listener = (_e: IpcRendererEvent, payload: any) => cb(payload);
    ipcRenderer.on(PushChannel.WorkerError, listener);
    return () => ipcRenderer.removeListener(PushChannel.WorkerError, listener);
  },

  // 后台缩略图推送
  onThumbnailUpdate: (cb: (data: { hwnd: number; dataUrl: string | null }) => void) => {
    const listener = (_e: IpcRendererEvent, payload: any) => cb(payload);
    ipcRenderer.on(PushChannel.ThumbnailUpdate, listener);
    return () => ipcRenderer.removeListener(PushChannel.ThumbnailUpdate, listener);
  },
};

contextBridge.exposeInMainWorld('fohelp', api);

export type FohelpAPI = typeof api;
