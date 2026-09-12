// Zustand store: 全局应用状态

import { create } from 'zustand';
import type { GameWindow, WorkerState } from '../../shared/types';
import type { ProfileInfo } from '../types';

interface LogEntry {
  id: number;
  workerId: string;
  level: string;
  msg: string;
  timestamp: number;
}

interface AppState {
  // 游戏窗口
  gameWindows: GameWindow[];
  refreshWindows: () => Promise<void>;

  // Profiles
  profiles: ProfileInfo[];
  refreshProfiles: () => Promise<void>;

  // Workers
  workers: Map<string, WorkerState>;
  startWorker: (hwnd: number, characterName: string, taskType: string, profileId?: string) => Promise<void>;
  stopWorker: (workerId: string) => Promise<void>;
  pauseWorker: (workerId: string) => Promise<void>;
  resumeWorker: (workerId: string) => Promise<void>;
  updateWorkerState: (state: WorkerState) => void;
  removeWorker: (workerId: string) => void;

  // 日志
  logs: LogEntry[];
  appendLog: (log: Omit<LogEntry, 'id'>) => void;
  clearLogs: () => void;
}

let logIdCounter = 1;

export const useStore = create<AppState>((set) => ({
  gameWindows: [],
  refreshWindows: async () => {
    console.log(1111)
    if (!window.fohelp) return;
    const list = await window.fohelp.listGameWindows();
    console.log(list,'list')
    set({ gameWindows: list });
  },

  profiles: [],
  refreshProfiles: async () => {
    if (!window.fohelp) return;
    const list = await window.fohelp.listProfiles();
    set({ profiles: list });
  },

  workers: new Map(),
  startWorker: async (hwnd, characterName, taskType, profileId) => {
    if (!window.fohelp) return;
    const res = await window.fohelp.startWorker(hwnd, characterName, taskType as any, profileId);
    if (res.ok && res.workerId) {
      const states = await window.fohelp.listWorkers();
      const map = new Map<string, WorkerState>();
      for (const s of states) map.set(s.workerId, s);
      set({ workers: map });
    }
  },
  stopWorker: async (workerId) => {
    if (!window.fohelp) return;
    await window.fohelp.stopWorker(workerId);
  },
  pauseWorker: async (workerId) => {
    if (!window.fohelp) return;
    await window.fohelp.pauseWorker(workerId);
  },
  resumeWorker: async (workerId) => {
    if (!window.fohelp) return;
    await window.fohelp.resumeWorker(workerId);
  },
  updateWorkerState: (state) => {
    set((prev) => {
      const next = new Map(prev.workers);
      next.set(state.workerId, { ...next.get(state.workerId), ...state } as WorkerState);
      return { workers: next };
    });
  },
  removeWorker: (workerId) => {
    set((prev) => {
      const next = new Map(prev.workers);
      next.delete(workerId);
      return { workers: next };
    });
  },

  logs: [],
  appendLog: (log) => {
    set((prev) => {
      const entry: LogEntry = { ...log, id: logIdCounter++ };
      const next = [entry, ...prev.logs];
      // 限制最多 500 条
      if (next.length > 500) next.length = 500;
      return { logs: next };
    });
  },
  clearLogs: () => set({ logs: [] }),
}));

// 启动时订阅 IPC 事件
export function subscribeToIpc() {
  if (!window.fohelp) return;

  window.fohelp.onWorkerStateChanged((state: any) => {
    if (state.removed) {
      useStore.getState().removeWorker(state.workerId);
    } else {
      useStore.getState().updateWorkerState(state);
    }
  });

  window.fohelp.onWorkerLog((log) => {
    useStore.getState().appendLog(log);
  });

  window.fohelp.onWorkerError((err) => {
    useStore.getState().appendLog({
      workerId: err.workerId,
      level: 'error',
      msg: err.error?.message || JSON.stringify(err.error),
      timestamp: err.timestamp,
    });
  });
}
