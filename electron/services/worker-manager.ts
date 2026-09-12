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
   * @param waitForConfig true = bootstrap 模式,worker 走完初始化后停在 idle 等 'start-task' 命令
   */
  start(
    hwnd: number,
    characterName: string,
    taskType: TaskType,
    profile: Profile | null,
    taskConfig: any = null,
    waitForConfig: boolean = false,
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

    log.info(
      `[WorkerManager] 启动 worker ${workerId},脚本=${workerScript},hwnd=${hwnd},profile=${profile?.id || 'none'},waitForConfig=${waitForConfig}`,
    );

    const worker = new Worker(workerScript, {
      workerData: { hwnd, characterName, taskType, profile, taskConfig, waitForConfig },
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

  /** 通过 hwnd 停止 worker(找不到返回 false) */
  stopByHwnd(hwnd: number): boolean {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) return false;
    return this.stop(wid);
  }

  /**
   * Bootstrap 模式启动 worker:
   *   1. 如果 hwnd 已有 worker(可能 reload 后还在),发 screenshot 命令再等一张图
   *   2. 否则以 waitForConfig=true 启动新 worker,等 thumbnail 推送 / alert 状态
   *   3. 任何路径都返回 Promise<{dataUrl, characterName}>
   *   4. alert(大漠/绑定失败)/ 15s 超时 -> reject
   */
  bootstrap(
    hwnd: number,
    characterName: string,
    profile: Profile | null,
  ): Promise<{ dataUrl: string | null; characterName: string }> {
    return new Promise((resolve, reject) => {
      const existingWid = this.byHwnd.get(hwnd);
      if (existingWid) {
        // 已存在:触发一次截图(防止 thumbnail 推送过但被错过)
        const m = this.workers.get(existingWid)!;
        if (m.state.status === 'alert') {
          reject(new Error(m.state.statusDetail || 'worker 处于 alert 状态'));
          return;
        }
        const onMsg = (msg: any) => {
          if (msg.type === 'thumbnail' && msg.hwnd === hwnd) {
            m.worker.off('message', onMsg);
            resolve({
              dataUrl: msg.dataUrl || null,
              characterName: m.state.character?.name || characterName,
            });
          }
        };
        m.worker.on('message', onMsg);
        m.worker.postMessage({ type: 'command', command: 'screenshot' });
        setTimeout(() => {
          m.worker.off('message', onMsg);
          // 超时但 worker 还在,允许 UI 继续(无缩略图也行)
          resolve({ dataUrl: null, characterName: m.state.character?.name || characterName });
        }, 8000);
        return;
      }

      // 新启动(bootstrap 模式)
      const wid = this.start(hwnd, characterName, 'farm', profile, null, true);
      const m = this.workers.get(wid)!;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        m.worker.off('message', onMsg);
        clearTimeout(timer);
        fn();
      };
      const onMsg = (msg: any) => {
        if (msg.type === 'thumbnail' && msg.hwnd === hwnd) {
          finish(() =>
            resolve({
              dataUrl: msg.dataUrl || null,
              characterName: msg.characterName || m.state.character?.name || characterName,
            }),
          );
        } else if (msg.type === 'state' && msg.state.status === 'alert') {
          finish(() => reject(new Error(msg.state.statusDetail || 'worker 进入 alert')));
        }
      };
      m.worker.on('message', onMsg);
      const timer = setTimeout(() => {
        finish(() => reject(new Error('bootstrap 超时(15s) — 检查大漠注册码/游戏窗口')));
      }, 15000);
    });
  }

  /** 给已 bootstrap 的 worker 发 'start-task' 命令,进入战斗循环 */
  startTask(hwnd: number): boolean {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) return false;
    const m = this.workers.get(wid);
    if (!m) return false;
    m.worker.postMessage({ type: 'command', command: 'start-task' });
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

  /** 请求 worker 给某 hwnd 截 1 张图(用大漠 Capture) */
  requestThumbnail(hwnd: number): Promise<string | null> {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) return Promise.resolve(null);
    const m = this.workers.get(wid);
    if (!m) return Promise.resolve(null);

    return new Promise((resolve) => {
      const onMessage = (msg: any) => {
        if (msg.type === 'thumbnail' && msg.hwnd === hwnd) {
          m.worker.off('message', onMessage);
          resolve(msg.dataUrl || null);
        }
      };
      m.worker.on('message', onMessage);
      m.worker.postMessage({ type: 'command', command: 'screenshot' });
      // 超时保护
      setTimeout(() => {
        m.worker.off('message', onMessage);
        resolve(null);
      }, 8000);
    });
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
    } else if (msg.type === 'thumbnail') {
      // 缩略图:缓存到主进程 + 推给 renderer
      this.broadcast('thumbnail:update', { hwnd: msg.hwnd, dataUrl: msg.dataUrl });
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
