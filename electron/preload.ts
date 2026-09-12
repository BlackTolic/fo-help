// 预加载脚本:把 IPC 能力安全地暴露给渲染进程

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { RequestChannel, PushChannel } from '../shared/ipc-channels';
import type { GameWindow, TaskType, WorkerState } from '../shared/types';

// 类型化 API
const api = {
  // 窗口
  listGameWindows: (): Promise<GameWindow[]> =>
    ipcRenderer.invoke(RequestChannel.ListGameWindows),

  refreshGameWindows: (): Promise<GameWindow[]> =>
    ipcRenderer.invoke(RequestChannel.RefreshGameWindows),

  // Worker
  startWorker: (hwnd: number, characterName: string, taskType: TaskType) =>
    ipcRenderer.invoke(RequestChannel.StartWorker, { hwnd, characterName, taskType }),

  stopWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.StopWorker, workerId),

  pauseWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.PauseWorker, workerId),

  resumeWorker: (workerId: string) => ipcRenderer.invoke(RequestChannel.ResumeWorker, workerId),

  listWorkers: (): Promise<WorkerState[]> => ipcRenderer.invoke(RequestChannel.ListWorkers),

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
};

contextBridge.exposeInMainWorld('fohelp', api);

export type FohelpAPI = typeof api;
