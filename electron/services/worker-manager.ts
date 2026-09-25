// WorkerManager: 管理所有 game utilityProcess(每游戏窗口一个独立 OS 进程)
//
// ⚠️ 为什么用 utilityProcess 而不是 worker_threads?
//   dm.dll v7.2543 是 in-process COM dll,内部维护进程级状态:
//     - 全局绑定表(最近一次 BindWindow 的窗口)
//     - Win32 低级鼠标/键盘 hook(user32.dll 维护,跨线程共享)
//   worker_threads 在同一进程内同时绑多个窗口会:
//     - 互相踩 hook → 鼠标/键盘操作不生效 / 段错误 → 主进程闪退
//     - "上次未正常解绑"标记污染下次 BindWindow → code=-16
//   utilityProcess 是独立 OS 进程,每个子进程有自己的 dm.dll 实例 + 独立 hook 表
//   → 真正支持多窗口多开,且进程隔离,一个子进程崩了不影响主进程

import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'path';
import { app } from 'electron';
import type { WorkerState, TaskName, TaskType, TaskConfig } from '../../shared/types';
import { PushChannel } from '../../shared/ipc-channels';
import { createLogger } from '../../core/logger';
import { ThumbnailService } from './thumbnail-service';
import { getAppSettings } from './app-settings-service';
import { getThumbsDir, getVerifyCodesDir } from '../main';

const log = createLogger('worker-manager');

interface ManagedWorker {
  worker: UtilityProcess;
  state: WorkerState;
  // 最近 stderr 行(环形缓冲),bootstrap 超时 kill 时 dump 出来定位卡哪一步
  recentStderr: string[];
}

export class WorkerManager {
  private workers = new Map<string, ManagedWorker>(); // workerId -> ManagedWorker
  private byHwnd = new Map<number, string>(); // hwnd -> workerId
  private thumbs: ThumbnailService; // 缩略图缓存(子进程 → 主进程 → renderer)

  constructor(thumbs?: ThumbnailService) {
    this.thumbs = thumbs || new ThumbnailService();
  }

  /**
   * 启动一个 utilityProcess 子进程,加载 game-utility-worker.js 绑定到指定游戏窗口
   * @param waitForConfig true = bootstrap 模式,worker 走完初始化后停在 idle 等 'start-task' 命令
   */
  start(
    hwnd: number,
    characterName: string,
    taskType: TaskType,
    profile: any | null,
    taskConfig: any = null,
    waitForConfig = false,
  ): string {
    if (this.byHwnd.has(hwnd)) {
      return this.byHwnd.get(hwnd)!;
    }

    const workerId = `w-${hwnd}-${Date.now()}`;
    // utilityProcess 子进程入口(由 electron/tsconfig 编译到 dist-electron)
    const workerScript = path.join(
      app.getAppPath(),
      'dist-electron',
      'electron',
      'workers',
      'game-utility-worker.js',
    );

    log.info(
      `[WorkerManager] 启动 utilityProcess ${workerId},hwnd=${hwnd},profile=${profile?.id || 'default'},waitForConfig=${waitForConfig}`,
    );

    // 缩略图本地存储目录:用 main.ts 统一的 getThumbsDir()(dev = 项目根,packaged = userData)
    const thumbsDir = getThumbsDir();

    // init data 通过 process.argv 传入(JSON 字符串,子进程从 argv[last] 取)
    const initPayload = JSON.stringify({
      hwnd,
      characterName,
      taskType,
      profile,
      taskConfig,
      waitForConfig,
      thumbsDir,
      // 验证码截图目录(dev = 项目根/logs/verify-codes,packaged = userData/logs/verify-codes),
      // 主进程退出时清空,见 main.ts cleanupVerifyCodes()
      verifyCodeDir: getVerifyCodesDir(),
      // app.getAppPath() 只能在主进程调,utilityProcess 里 require('electron') 拿不到 app
      appPath: app.getAppPath(),
      // 设置(分辨率 / 大漠注册码 / 大模型 API key):每次启动 worker 前新鲜读盘
      settings: getAppSettings(),
    });

    // 32-bit Electron 启动的 utilityProcess 默认也是 32-bit,能加载 32-bit dm.dll
    const worker = utilityProcess.fork(workerScript, [initPayload], {
      serviceName: `fo-help-game-${hwnd}`,
      // stdio 用 'pipe'(默认)而不是 'inherit':
      //   Electron 主进程是 GUI 应用,没有真正的 console;stdio:'inherit' 时
      //   子进程的 stdout/stderr 继承父进程的无效句柄,pino-pretty 等异步 transport
      //   可能在 pipe buffer 满时阻塞子进程 → 表现为"启动无反应 / 停止无反应"
      //   改成 'pipe' 后,父进程主动 drain 转发,不会阻塞子进程
      stdio: 'pipe',
    });

    // 把子进程的 stdout/stderr 转发到主进程的 pino 日志 + 终端
    // (stdio: 'pipe' 必须主动消费,否则 buffer 满了子进程会阻塞)
    const tag = `[w-${hwnd}]`;
    // 闭环:最近 80 行 stderr,bootstrap 超时 kill 时 dump 出来定位卡哪一步
    const recentStderr: string[] = [];
    const STDERR_RING_MAX = 80;
    const pushStderr = (line: string) => {
      recentStderr.push(line);
      if (recentStderr.length > STDERR_RING_MAX) recentStderr.shift();
    };
    worker.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log.info(`${tag} ${line}`);
      }
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        pushStderr(line);
        log.warn(`${tag} ${line}`);
      }
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

    this.workers.set(workerId, { worker, state: initialState, recentStderr });
    this.byHwnd.set(hwnd, workerId);

    worker.on('message', (msg) => this.onWorkerMessage(workerId, msg));
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
   * 停止 utilityProcess 子进程(发 'stop' 命令,等它自己清理 + exit)
   */
  stop(workerId: string): boolean {
    const m = this.workers.get(workerId);
    if (!m) {
      log.warn(`[WorkerManager] stop: workerId=${workerId} 不存在`);
      return false;
    }
    if (!m.state.ready) {
      log.warn(`[WorkerManager] stop: workerId=${workerId} 未 ready(消息可能丢失),先 kill 兜底`);
      // 兜底:未 ready 时直接 kill 强制退出,避免"停止无反应"
      try {
        m.worker.kill();
      } catch (e: any) {
        log.warn(`kill 失败: ${e.message}`);
      }
      return true;
    }
    log.info(`[WorkerManager] → stop 已发给 ${workerId} (hwnd=${m.state.hwnd})`);
    m.worker.postMessage({ type: 'command', command: 'stop' });
    return true;
  }

  /** 通过 hwnd 停止 worker(找不到返回 false) */
  stopByHwnd(hwnd: number): boolean {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) return false;
    return this.stop(wid);
  }

  /** 强制终止(不等 stop 命令,直接 kill) */
  kill(workerId: string): boolean {
    const m = this.workers.get(workerId);
    if (!m) return false;
    try {
      m.worker.kill();
    } catch (e: any) {
      log.warn(`[WorkerManager] kill ${workerId} 失败: ${e.message}`);
    }
    return true;
  }

  /**
   * Bootstrap 模式启动 worker:
   *   1. 如果 hwnd 已有 worker(可能 reload 后还在),发 screenshot 命令再等一张图
   *   2. 否则以 waitForConfig=true 启动新 worker,等 thumbnail 推送 / alert 状态
   *   3. 任何路径都返回 Promise<{dataUrl, characterName}>
   *   4. alert(大漠/绑定失败)/ 15s 超时 -> reject
   *
   * taskType 默认 'farm'(只是要预览 thumbnail,实际不会进入战斗循环)
   * 真正 start-task 时,worker 用的是 init.taskType,所以上层(WindowCard.handleTaskSaved
   * / handleHistorySelect)必须保证拿到正确 taskType 重新 bootstrap,不要信任默认。
   */
  bootstrap(
    hwnd: number,
    characterName: string,
    profile: any | null,
    taskType: TaskType = 'farm',
    taskConfig: TaskConfig | null = null,
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
      const t0 = Date.now();
      const wid = this.start(hwnd, characterName, taskType, profile, taskConfig, true);
      const m = this.workers.get(wid)!;
      log.info(`[WorkerManager] bootstrap start: hwnd=${hwnd}, fork 耗时 ${Date.now() - t0}ms`);

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        m.worker.off('message', onMsg);
        clearTimeout(timer);
        fn();
      };
      const onMsg = (msg: any) => {
        const elapsed = Date.now() - t0;
        if (msg.type === 'ready' && msg.hwnd === hwnd) {
          log.info(`[WorkerManager] 子进程 ready: hwnd=${hwnd}, 累计 ${elapsed}ms`);
        } else if (msg.type === 'log') {
          log.info(`[WorkerManager] [w-${hwnd}] ${msg.level}: ${msg.msg}`);
        } else if (msg.type === 'thumbnail' && msg.hwnd === hwnd) {
          log.info(`[WorkerManager] 收到 thumbnail: hwnd=${hwnd}, 累计 ${elapsed}ms`);
          finish(() =>
            resolve({
              dataUrl: msg.dataUrl || null,
              characterName: msg.characterName || m.state.character?.name || characterName,
            }),
          );
        } else if (msg.type === 'state' && msg.state.status === 'alert') {
          log.warn(
            `[WorkerManager] worker 进入 alert: hwnd=${hwnd}, 累计 ${elapsed}ms, detail=${msg.state.statusDetail}`,
          );
          finish(() => reject(new Error(msg.state.statusDetail || 'worker 进入 alert')));
        }
      };
      m.worker.on('message', onMsg);
      // 延长到 30s:首次启动 fork + dm.dll 加载 + bindWindow + Capture 累计可能要 15-25s
      const BOOTSTRAP_TIMEOUT_MS = 30000;
      const timer = setTimeout(() => {
        const elapsed = Date.now() - t0;
        // 根据 stderr 环形缓冲匹配当前卡在哪一步,给出可操作的诊断
        const lastLines = m.recentStderr;
        const lastStepStart = [...lastLines].reverse().find((l) => l.includes('[STEP-START]'));
        const phase = lastStepStart
          ? lastStepStart.replace(/.*\[STEP-START\]\s*/, '').trim()
          : '(未匹配到 STEP-START)';
        const diagnosis = (() => {
          // 没有任何 stderr → 子进程根本没启动 / require 阶段就挂了
          if (m.recentStderr.length === 0) {
            return '子进程未输出任何 stderr → 极可能 dm.dll 未注册/位数不对/fork 启动即崩溃。检查 dist-electron/electron/workers/game-utility-worker.js 是否存在,32/64 位是否匹配。';
          }
          if (
            /\[STEP-START\] loadDamoo\(.*\)/.test(lastLines.join('\n')) &&
            !/\[STEP-END\] loadDamoo/.test(lastLines.join('\n'))
          ) {
            return '卡在 loadDamoo(同步 COM 初始化) → 大概率是大漠注册码无效、dm.dll 未注册,或被 360/火绒隔离。请单独运行 regsvr32 dm.dll 验证。';
          }
          if (
            /\[STEP-START\] bindWindow/.test(lastLines.join('\n')) &&
            !/\[STEP-END\] bindWindow/.test(lastLines.join('\n'))
          ) {
            return `卡在 bindWindow(hwnd=${hwnd}) → 检查:1) 游戏窗口是否最小化/被遮挡/未进入游戏主界面 2) mode=${'?'} 在窗口后台时可能 hang 3) 反作弊拦截 user32 hook。试试前台+最大化+切到 mode=normal。`;
          }
          if (
            /\[STEP-START\] capture/.test(lastLines.join('\n')) &&
            !/\[STEP-END\] capture/.test(lastLines.join('\n'))
          ) {
            return `卡在 dmApi.capture(hwnd=${hwnd}) → 大概率 hwnd 已失效/窗口被关闭,或绑定关系异常。刷新一次窗口列表重试。`;
          }
          return `未匹配到已知步骤(stderr 已收到 ${m.recentStderr.length} 行)。请看上面 [w-${hwnd}] stderr 日志。`;
        })();
        log.error(
          `[WorkerManager] bootstrap 超时(${BOOTSTRAP_TIMEOUT_MS / 1000}s): hwnd=${hwnd}, 累计 ${elapsed}ms\n` +
            `  当前阶段: ${phase}\n` +
            `  诊断: ${diagnosis}`,
        );
        // 把最近 stderr dump 出来,方便一眼定位
        if (m.recentStderr.length > 0) {
          log.error(
            `[WorkerManager] 子进程 ${wid} 最近 ${m.recentStderr.length} 行 stderr:\n` +
              m.recentStderr.map((l) => `  | ${l}`).join('\n'),
          );
        }
        // 两阶段清理子进程(减少带挂游戏窗口的概率)
        // 阶段 1:先发 stop 命令 — 子进程消息循环还活着时(只在 capture/OCR 阶段卡住时有效),
        //   stop handler 会跑 dmApi.unbindWindow() + setTimeout(exit) 主动释放对游戏窗口的 hook
        //   bindWindow 同步 hang 时无效(主线程卡在 native 调用,Node 事件循环跑不到 message)
        // 阶段 2:等 1.5s — 子进程自己 cleanup + exit
        // 阶段 3:还活着才走 SIGKILL
        try {
          try {
            m.worker.postMessage({ type: 'command', command: 'stop' });
            log.warn(
              `[WorkerManager] bootstrap 超时 → 先发 stop 命令,等 1.5s 让子进程 graceful cleanup (hwnd=${hwnd}, 阶段=${phase})`,
            );
          } catch (e: any) {
            log.warn(`[WorkerManager] 发 stop 命令失败: ${e.message}`);
          }
          setTimeout(() => {
            if (m.worker.pid) {
              try {
                m.worker.kill();
                log.warn(
                  `[WorkerManager] 子进程 ${wid} 1.5s 内未 graceful 退出 → 强制 kill,下次创建任务会重新 fork`,
                );
              } catch (e: any) {
                log.warn(`[WorkerManager] 强制 kill 失败: ${e.message}`);
              }
            } else {
              log.info(`[WorkerManager] 子进程 ${wid} 已在 1.5s 内 graceful 退出(dm hook 已释放)`);
            }
            finish(() =>
              reject(
                new Error(
                  `bootstrap 超时(${BOOTSTRAP_TIMEOUT_MS / 1000}s)\n` +
                    `当前阶段: ${phase}\n` +
                    `诊断: ${diagnosis}\n` +
                    `请查看终端 [w-${hwnd}] 标记的 stderr 日志`,
                ),
              ),
            );
          }, 1500);
        } catch (e: any) {
          log.warn(`[WorkerManager] 两阶段清理异常: ${e.message}`);
          finish(() =>
            reject(
              new Error(
                `bootstrap 超时(${BOOTSTRAP_TIMEOUT_MS / 1000}s)\n` +
                  `当前阶段: ${phase}\n` +
                  `诊断: ${diagnosis}`,
              ),
            ),
          );
        }
      }, BOOTSTRAP_TIMEOUT_MS);
    });
  }

  /**
   * 给已 bootstrap 的 worker 发 'start-task' 命令,进入战斗循环
   * 异步:如果 worker 未 ready,等 ready(最多 30s)再发,避免消息丢失
   */
  async startTask(
    hwnd: number,
    taskType?: TaskType,
    taskConfig: any = null,
  ): Promise<{ ok: boolean; error?: string }> {
    const wid = this.byHwnd.get(hwnd);
    if (!wid) {
      log.warn(`[WorkerManager] startTask: hwnd=${hwnd} 没找到 worker`);
      return { ok: false, error: '该 hwnd 没有 worker' };
    }
    const m = this.workers.get(wid);
    if (!m) {
      log.warn(`[WorkerManager] startTask: workerId=${wid} 不在 workers map`);
      return { ok: false, error: 'worker 已退出' };
    }

    // 等 worker ready(最多 30s,避免 bootstrap 慢时 start-task 消息丢失)
    const WAIT_READY_MS = 30000;
    const t0 = Date.now();
    while (!m.state.ready && Date.now() - t0 < WAIT_READY_MS) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    if (!m.state.ready) {
      log.error(
        `[WorkerManager] startTask 超时: worker ${wid} 等 ready 超 ${WAIT_READY_MS / 1000}s`,
      );
      return { ok: false, error: 'worker 初始化未完成,稍后重试' };
    }

    log.info(
      `[WorkerManager] → start-task 已发给 ${wid} (hwnd=${hwnd}, taskType=${taskType || m.state.taskType || 'farm'}, 等 ready 耗时 ${Date.now() - t0}ms)`,
    );
    // 把 taskType + taskConfig 一起带给 worker,worker 收到后覆盖 init 字段再分派任务
    //   bootstrap 阶段 worker fork 时 init.taskType 硬编码为 'farm'(worker-manager.bootstrap 兜底默认),
    //   但真正的任务类型由 dialog 保存后才确定,只能通过 start-task 命令告诉 worker
    m.worker.postMessage({
      type: 'command',
      command: 'start-task',
      taskType,
      taskConfig,
    });
    return { ok: true };
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

  /**
   * 截图测试:让 worker 截一张到 thumbnails/test-<hwnd>-<ts>.png
   * 用于评估大漠截图精度,不影响正常 thumbnail 流
   * 前提:该 hwnd 已有 worker(否则需先点"创建任务")
   */
  captureTest(hwnd: number): Promise<{ filePath?: string; error?: string }> {
    return new Promise((resolve) => {
      const wid = this.byHwnd.get(hwnd);
      if (!wid) {
        resolve({ error: '该 hwnd 还没有 worker,请先点"创建任务"' });
        return;
      }
      const m = this.workers.get(wid)!;
      const onMessage = (msg: any) => {
        if (msg.type === 'thumbnail-test' && msg.hwnd === hwnd) {
          m.worker.off('message', onMessage);
          clearTimeout(timer);
          if (msg.error) resolve({ error: msg.error });
          else resolve({ filePath: msg.filePath });
        }
      };
      m.worker.on('message', onMessage);
      m.worker.postMessage({ type: 'command', command: 'screenshot-test' });
      const timer = setTimeout(() => {
        m.worker.off('message', onMessage);
        resolve({ error: '截图超时(20s)' });
      }, 20000);
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
      'default-skill': '缺省技能',
    };
    return map[t];
  }

  // 处理 worker 发来的的消息
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
    } else if (msg.type === 'interrupt') {
      // 弹框中断事件(看门狗上报):广播给 renderer(日志面板/未来的弹框统计 UI)
      const event = { workerId, ...(msg.event || {}), at: msg.event?.at || Date.now() };
      log.info(
        `[WorkerManager] [w-${m.state.hwnd}] 弹框事件 ${event.kind}: ${event.popupType} ${event.detail || ''}`,
      );
      this.broadcast(PushChannel.WorkerInterrupt, event);
    } else if (msg.type === 'thumbnail') {
      // 缩略图:缓存到主进程 ThumbnailService + 推给 renderer
      // (renderer 主要用 onThumbnailUpdate 订阅推送,但 CaptureWindow IPC handler
      //  也读这个缓存,二者保持一致)
      this.thumbs.set(msg.hwnd, msg.dataUrl);
      this.broadcast(PushChannel.ThumbnailUpdate, { hwnd: msg.hwnd, dataUrl: msg.dataUrl });
    } else if (msg.type === 'thumbnail-test') {
      // 测试截图:只 log,不 broadcast(由 captureTest await 模式接走)
      log.info(`[WorkerManager] 测试截图: hwnd=${msg.hwnd} → ${msg.filePath || msg.error}`);
    } else if (msg.type === 'ready') {
      // 子进程初始化完成,message listener 已注册,可以安全 postMessage
      log.info(`[WorkerManager] utilityProcess ${workerId} 报告 ready`);
      m.state = { ...m.state, ready: true };
      // ⚠️ 必须广播,否则渲染端 worker.ready 永远是 undefined,
      //   UI 无法精确定位 "bootstrap 完成但 start-task 还没到" 这种状态(便于排查 race-condition)
      this.broadcast(PushChannel.WorkerStateChanged, m.state);
    } else {
      log.warn(`[WorkerManager] utilityProcess ${workerId} 未知消息类型: ${msg.type}`);
    }
  }

  private onWorkerExit(workerId: string, code: number | null) {
    log.info(`[WorkerManager] utilityProcess ${workerId} 退出 code=${code}`);
    if (code !== 0 && code !== null) {
      log.warn(
        `[WorkerManager] utilityProcess ${workerId} 非正常退出 code=${code},可能是 dm.dll 崩溃或子进程被 kill`,
      );
    }
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

  // 广播事件到所有窗口
  private broadcast(channel: PushChannel, payload: unknown) {
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
      try {
        m.worker.kill();
      } catch (e: any) {
        log.warn(`[WorkerManager] shutdown kill 失败: ${e.message}`);
      }
    }
    this.workers.clear();
    this.byHwnd.clear();
  }
}
