// WorkerManager: 管理所有 game worker(每游戏窗口一个)

import { Worker } from 'worker_threads';
import path from 'path';
import { app } from 'electron';
import type { WorkerState, TaskName, TaskType } from '../../shared/types';
import { PushChannel } from '../../shared/ipc-channels';
import type { Profile } from '../../core/profile/types';
import { createLogger } from '../../core/logger';

const log = createLogger('worker-manager');

interface ManagedWorker {
  worker: Worker;
  state: WorkerState;
}

export class WorkerManager {
  private workers = new Map<string, ManagedWorker>(); // workerId -> ManagedWorker
  private byHwnd = new Map<number, string>();        // hwnd -> workerId

  /**
   * 启动一个 worker 绑定到指定游戏窗口
   */
  start(
    hwnd: number,
    characterName: string,
    taskType: TaskType,
    profile: Profile | null,
    taskConfig: any = null,
  ): string {
    if (this.byHwnd.has(hwnd)) {
      return this.byHwnd.get(hwnd)!;
    }

    const workerId = `w-${hwnd}-${Date.now()}`;
    const workerScript = path.join(
      app.getAppPath(),
      'dist-workers',
      'workers',
      'game-worker.js',
    );

    log.info(`[WorkerManager] 启动 worker ${workerId},脚本=${workerScript},hwnd=${hwnd},profile=${profile?.id || 'none'}`);

    const worker = new Worker(workerScript, {
      workerData: { hwnd, characterName, taskType, profile, taskConfig },
    });

    const initialState: WorkerState = {
      workerId,
      hwnd,
      character: {
        name: characterName,
        class: this.classToEnum(profile?.class.name),
        level: 1,
      },
      taskType,
      taskName: this.taskNameFor(taskType),
      status: 'idle',
      startedAt: Date.now(),
      stats: { killCount: 0, deathCount: 0, uptimeMs: 0 },
    };

    this.workers.set(workerId, { worker, state: initialState });
    this.byHwnd.set(hwnd, workerId);
    
    worker.on('message', (msg) => this.onWorkerMessage(workerId, msg));
    worker.on('error', (err) => this.onWorkerError(workerId, err));
    worker.on('exit', (code) => this.onWorkerExit(workerId, code));

    return workerId;
  }

  private classToEnum(name?: string): 'warrior' | 'mage' | 'taoist' | 'archer' | 'assassin' {
    if (!name) return 'warrior';
    const lower = name.toLowerCase();
    if (lower.includes('法')) return 'mage';
    if (lower.includes('道')) return 'taoist';
    if (lower.includes('弓')) return 'archer';
    if (lower.includes('刺')) return 'assassin';
    return 'warrior';
  }

  /**
   * 停止 worker
   */
  stop(workerId: string): boolean {
    const m = this.workers.get(workerId);
    if (!m) return false;
    m.worker.postMessage({ type: 'command', command: 'stop' });
    return true;
  }

  pause(workerId: string): boolean {
    const m = this.workers.get(workerId);
    if (!m) return false;
    m.worker.postMessage({ type: 'command', command: 'pause' });
    return true;
  }

  resume(workerId: string): boolean {
    const m = this.workers.get(workerId);
    if (!m) return false;
    m.worker.postMessage({ type: 'command', command: 'resume' });
    return true;
  }

  list(): WorkerState[] {
    return Array.from(this.workers.values()).map((m) => m.state);
  }

  getByHwnd(hwnd: number): WorkerState | null {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) return null;
    return this.workers.get(wid)?.state ?? null;
  }

  private taskNameFor(t: TaskType): TaskName {
    const map: Record<TaskType, TaskName> = {
      farm: '挂机打怪',
      mine: '挖矿',
      'catch-pet': '捕捉宠物',
      refine: '装备炼化',
      reputation: '名誉任务',
    };
    return map[t];
  }

  private onWorkerMessage(workerId: string, msg: any) {
    const m = this.workers.get(workerId);
    if (!m) return;

    if (msg.type === 'state') {
      // 状态更新
      m.state = { ...m.state, ...msg.state };
      this.broadcast(PushChannel.WorkerStateChanged, m.state);
    } else if (msg.type === 'log') {
      this.broadcast(PushChannel.WorkerLog, {
        workerId,
        level: msg.level,
        msg: msg.msg,
        timestamp: Date.now(),
      });
    } else if (msg.type === 'error') {
      this.broadcast(PushChannel.WorkerError, {
        workerId,
        error: msg.error,
        timestamp: Date.now(),
      });
    }
  }

  private onWorkerError(workerId: string, err: Error) {
    log.error(`[WorkerManager] worker ${workerId} 错误:`, err);
    this.broadcast(PushChannel.WorkerError, {
      workerId,
      error: { message: err.message, stack: err.stack },
      timestamp: Date.now(),
    });
  }

  private onWorkerExit(workerId: string, code: number) {
    log.info(`[WorkerManager] worker ${workerId} 退出 code=${code}`);
    const m = this.workers.get(workerId);
    if (m) {
      this.byHwnd.delete(m.state.hwnd);
      this.workers.delete(workerId);
    }
    // 通知 UI 移除
    this.broadcast(PushChannel.WorkerStateChanged, {
      workerId,
      removed: true,
    });
  }

  private broadcast(channel: string, payload: unknown) {
    // 通过 BrowserWindow.webContents.send 推送
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  shutdownAll() {
    for (const m of this.workers.values()) {
      m.worker.terminate();
    }
    this.workers.clear();
    this.byHwnd.clear();
  }
}
