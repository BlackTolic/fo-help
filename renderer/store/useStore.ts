// 全局应用状态
import { create } from 'zustand';
import type { GameWindow, WorkerState, TaskConfig, StoredTaskConfig } from '../../shared/types';

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

  /**
   * 当前已应用的任务配置(每个 hwnd 一份)
   * - 来源:用户点"创建任务"保存后,或点"历史任务"选中后
   * - 不持久化,reload 后清空
   */
  taskConfigs: Map<number, TaskConfig>;
  /** 当前 hwnd 应用的"任务名"(显示在卡片上,方便用户知道跑的是哪个任务) */
  appliedTaskNames: Map<number, string>;

  /**
   * 历史任务列表(全局所有已保存的任务,跨窗口复用)
   * - 启动时由 App.tsx 拉一次
   * - 每次保存/删除后刷新
   */
  taskHistory: StoredTaskConfig[];
  loadTaskHistory: () => Promise<void>;

  /** 应用配置到当前 hwnd(用于"创建任务保存后"或"历史任务选中后") */
  applyTaskConfig: (hwnd: number, config: TaskConfig, name?: string) => void;
  /** 移除 hwnd 的应用配置(停止任务后回到 unconfigured) */
  clearTaskConfig: (hwnd: number) => void;

  /** 保存任务配置(按 name,重名拒绝) — 返回 { ok, stored?, error? } */
  saveTaskByName: (name: string, config: TaskConfig) => Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }>;
  /** 按 name 加载配置(从历史任务 dialog 选中时用) */
  loadTaskByName: (name: string) => Promise<StoredTaskConfig | null>;

  // OCR 出来的角色名(按 hwnd 存)
  characterNames: Map<number, string>;
  setCharacterName: (hwnd: number, name: string) => void;

  // 缩略图(主进程后台推送,按 hwnd 存)
  thumbnails: Map<number, string>;
  setThumbnail: (hwnd: number, dataUrl: string | null) => void;

  // Workers
  workers: Map<string, WorkerState>;
  startWorker: (hwnd: number, characterName: string, taskType: string) => Promise<void>;
  /** Bootstrap 模式启动 worker:返回 ok + thumbnail + characterName(失败带 error) */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
  ) => Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }>;
  /** 给已 bootstrap 的 worker 发 start-task(异步:会等 worker ready,最多 30s) */
  startTask: (hwnd: number) => Promise<{ ok: boolean; error?: string }>;
  /** 取消 bootstrap:通过 hwnd 停掉 worker(用于 dialog 关闭但没保存) */
  cancelBootstrap: (hwnd: number) => Promise<void>;
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
    if (!window.fohelp) return;
    const list = await window.fohelp.listGameWindows();
    set({ gameWindows: list });
  },

  taskConfigs: new Map(),
  appliedTaskNames: new Map(),
  taskHistory: [],

  loadTaskHistory: async () => {
    if (!window.fohelp) return;
    const list = await window.fohelp.listAllTaskConfigs();
    set({ taskHistory: list });
  },

  applyTaskConfig: (hwnd, config, name) => {
    set((prev) => {
      const nextCfg = new Map(prev.taskConfigs);
      nextCfg.set(hwnd, config);
      const nextNames = new Map(prev.appliedTaskNames);
      if (name) nextNames.set(hwnd, name);
      else nextNames.delete(hwnd);
      return { taskConfigs: nextCfg, appliedTaskNames: nextNames };
    });
  },

  clearTaskConfig: (hwnd) => {
    set((prev) => {
      const nextCfg = new Map(prev.taskConfigs);
      nextCfg.delete(hwnd);
      const nextNames = new Map(prev.appliedTaskNames);
      nextNames.delete(hwnd);
      return { taskConfigs: nextCfg, appliedTaskNames: nextNames };
    });
  },

  saveTaskByName: async (name, config) => {
    if (!window.fohelp) return { ok: false, error: 'IPC 未就绪' };
    const res = await window.fohelp.saveTaskConfig(0, config, name);
    if (res.ok) {
      // 刷新历史任务列表
      try {
        const list = await window.fohelp.listAllTaskConfigs();
        set({ taskHistory: list });
      } catch {
        /* noop */
      }
    }
    return res;
  },

  loadTaskByName: async (name) => {
    if (!window.fohelp) return null;
    return await window.fohelp.loadTaskByName(name);
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
  bootstrapWorker: async (hwnd, characterName) => {
    if (!window.fohelp) return { ok: false, error: 'IPC 未就绪' };
    const res = await window.fohelp.bootstrapWorker(hwnd, characterName);
    if (res.ok) {
      if (res.dataUrl) {
        useStore.getState().setThumbnail(hwnd, res.dataUrl);
      }
      if (res.characterName) {
        useStore.getState().setCharacterName(hwnd, res.characterName);
      }
      try {
        const states = await window.fohelp.listWorkers();
        const map = new Map<string, WorkerState>();
        for (const s of states) map.set(s.workerId, s);
        set({ workers: map });
      } catch {
        /* noop */
      }
    }
    return res;
  },
  startTask: async (hwnd) => {
    if (!window.fohelp) return { ok: false, error: 'IPC 未就绪' };
    console.log('startTask - 任务启动', hwnd);
    return await window.fohelp.startTask(hwnd);
  },
  cancelBootstrap: async (hwnd) => {
    if (!window.fohelp) return;
    await window.fohelp.stopWorkerByHwnd(hwnd);
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

  window.fohelp.onThumbnailUpdate(({ hwnd, dataUrl }) => {
    useStore.getState().setThumbnail(hwnd, dataUrl);
  });
}
