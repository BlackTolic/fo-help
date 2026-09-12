// 全局应用状态
import { create } from 'zustand';
import type { GameWindow, WorkerState, TaskConfig } from '../../shared/types';
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

  // 任务配置(按 hwnd 存)
  taskConfigs: Map<number, TaskConfig>;
  loadTaskConfig: (hwnd: number) => Promise<void>;
  setTaskConfig: (hwnd: number, config: TaskConfig) => void;

  // OCR 出来的角色名(按 hwnd 存)
  characterNames: Map<number, string>;
  setCharacterName: (hwnd: number, name: string) => void;

  // 缩略图(主进程后台推送,按 hwnd 存)
  thumbnails: Map<number, string>;
  setThumbnail: (hwnd: number, dataUrl: string | null) => void;

  // Workers
  workers: Map<string, WorkerState>;
  startWorker: (hwnd: number, characterName: string, taskType: string) => Promise<void>;
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
    console.log(999)
    if (!window.fohelp) return;
    const list = await window.fohelp.listGameWindows();
    set({ gameWindows: list });
  },

  profiles: [],
  refreshProfiles: async () => {
    if (!window.fohelp) return;
    const list = await window.fohelp.listProfiles();
    set({ profiles: list });
  },

  taskConfigs: new Map(),
  loadTaskConfig: async (hwnd) => {
    if (!window.fohelp) return;
    const cfg = await window.fohelp.getTaskConfig(hwnd);
    set((prev) => {
      const next = new Map(prev.taskConfigs);
      if (cfg) next.set(hwnd, cfg);
      else next.delete(hwnd);
      return { taskConfigs: next };
    });
  },
  setTaskConfig: (hwnd, config) => {
    set((prev) => {
      const next = new Map(prev.taskConfigs);
      next.set(hwnd, config);
      return { taskConfigs: next };
    });
  },

  characterNames: new Map(),
  setCharacterName: (hwnd, name) => {
    set((prev) => {
      const next = new Map(prev.characterNames);
      next.set(hwnd, name);
      return { characterNames: next };
    });
  },

  thumbnails: new Map(),
  setThumbnail: (hwnd, dataUrl) => {
    set((prev) => {
      const next = new Map(prev.thumbnails);
      if (dataUrl) next.set(hwnd, dataUrl);
      else next.delete(hwnd);
      return { thumbnails: next };
    });
  },

  workers: new Map(),
  startWorker: async (hwnd, characterName, taskType) => {
    if (!window.fohelp) return;
    const res = await window.fohelp.startWorker(hwnd, characterName, taskType as any);
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
      // 如果有 characterName 推送,更新
      if (state.characterName && state.hwnd) {
        useStore.getState().setCharacterName(state.hwnd, state.characterName);
      }
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

  // 订阅后台缩略图推送
  window.fohelp.onThumbnailUpdate(({ hwnd, dataUrl }) => {
    useStore.getState().setThumbnail(hwnd, dataUrl);
  });
}
