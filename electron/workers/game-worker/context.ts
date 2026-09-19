// WorkerContext: game utilityProcess 子进程的共享上下文
//   持有 init 数据 + 全部运行期状态(currentStatus/killCount/combat/缺省技能控制标志等),
//   以及跨模块共用的通信方法(sendLog/setStatus/stepStart/stepEnd/postMessage)
// 这些原来是 game-utility-worker.ts 的模块级变量/函数,拆模块后集中到这里,
// 语义与模块级变量完全一致(包括 pause/stop 可在任务 start() 之前到达的边界行为)

import { createLogger } from '../../../core/logger';
import { DEFAULT_DAMOO_CONFIG, type DamooConfig } from '../../../core/platform/damoo/dm-api';
import type { CombatEngine } from '../../../core/combat/CombatEngine';
import type { TaskType, ScriptStatus } from '../../../shared/types';

export interface InitData {
  hwnd: number;
  characterName: string;
  taskType: TaskType;
  damooConfig?: Partial<DamooConfig>;
  profile?: any;
  taskConfig?: any;
  waitForConfig?: boolean;
  thumbsDir?: string;
  // 主进程算好传进来:utilityProcess 里 require('electron') 拿不到 app
  appPath?: string;
}

// 从 process.argv 取最后一个参数(JSON 序列化的 initData)
function parseInitData(): InitData {
  const last = process.argv[process.argv.length - 1];
  try {
    return JSON.parse(last);
  } catch (e: any) {
    throw new Error(`utilityProcess 初始化失败:无法解析 argv[last]=${last} (${e.message})`);
  }
}

export class WorkerContext {
  readonly log = createLogger('utility-worker');

  // 获取主进程参数:'{"hwnd":12345,"characterName":"...","taskType":"farm",...}'
  readonly init: InitData;
  readonly waitForConfig: boolean;

  currentStatus: ScriptStatus = 'idle';
  running = true;
  readonly startedAt = Date.now();
  killCount = 0;
  bindSuccess = false;
  characterName = '';
  combat: CombatEngine | null = null;
  dm: any = null;
  profile: any = null;
  damooConfig: DamooConfig = DEFAULT_DAMOO_CONFIG;
  startResolve: (() => void) | null = null;
  /**
   * ⚠️ Race-condition 兜底: spawn 后几百毫秒 主进程可能立刻 postMessage start-task,
   *   此时 worker 还在 loadDamoo 同步阶段(startResolve 还是 null)。实测 dm.dll 加载
   *   要 2~3s,触发窗口很大。
   *   暂存这次 start-task,等 Promise executor 设 startResolve 时自检补回。
   */
  pendingStart = false;

  // ===== 缺省技能任务(default-skill)的运行控制 =====
  // 与 combat 解耦:缺省技能不依赖战斗引擎,自己管一个 while 循环。
  // 标志放 ctx 而不是 task 实例上:pause/stop 命令可能在任务 start() 之前到达
  // (bootstrap 等 start-task 期间),必须保持原模块级变量的语义
  skill = {
    running: true,
    paused: false,
    resumeResolve: null as (() => void) | null,
    loopCount: 0, // 已跑完多少轮(用于日志 + UI 状态)
  };

  currentStep = '(none)';
  mainStart = Date.now();

  constructor() {
    // ★ DEBUG:在所有 import 之前打 stderr,确认子进程启动到这一行
    try {
      process.stderr.write(
        `[DEBUG] utilityProcess 启动 PID=${process.pid}, argv.length=${process.argv.length}\n`,
      );
    } catch {}

    if (!process.parentPort) {
      try {
        process.stderr.write(`[FATAL] process.parentPort 不存在,此进程不是 utilityProcess\n`);
      } catch {}
      throw new Error('必须在 Electron utilityProcess 中运行');
    }

    this.registerFatalErrorHandlers();

    this.init = parseInitData();
    this.waitForConfig = this.init.waitForConfig === true;
  }

  /** 发消息给主进程(worker-manager.ts 的 onWorkerMessage 接收) */
  postMessage(msg: any): void {
    process.parentPort!.postMessage(msg);
  }

  sendLog(level: string, msg: string): void {
    this.postMessage({ type: 'log', level, msg });
    if (level === 'info') this.log.info(msg);
    else if (level === 'warn') this.log.warn(msg);
    else if (level === 'error') this.log.error(msg);
    else this.log.debug(msg);
  }

  setStatus(status: ScriptStatus, detail?: string): void {
    this.currentStatus = status;
    this.postMessage({
      type: 'state',
      state: { status, statusDetail: detail, startedAt: this.startedAt },
    });
  }

  // 在每个同步/原生阻塞调用前后写 stderr 标记,父进程 bootstrap 超时 kill 时
  // 通过这些标记可以精确定位卡在哪一步(loadDamoo / bindWindow / capture)
  // 注意:必须用 process.stderr.write 同步写,不能用 log.*(pino 是异步,buffer 满可能丢失)
  stepStart(name: string): void {
    try {
      process.stderr.write(`[STEP-START] ${name} [+${Date.now() - this.mainStart}ms]\n`);
    } catch {}
    this.currentStep = name;
  }

  stepEnd(name: string, ok: boolean, extra?: string): void {
    try {
      process.stderr.write(
        `[STEP-END] ${name} ${ok ? 'OK' : 'FAIL'} [+${Date.now() - this.mainStart}ms]${extra ? ' ' + extra : ''}\n`,
      );
    } catch {}
  }

  /**
   * 兜底异常处理 — 防止 dm.dll / winax 的 native SEH 异常绕过 V8 TryCatch
   * 触发 STATUS_FATAL_USER_CALLBACK_EXCEPTION (0xC00000D0) → 子进程非正常退出
   *
   * 注意:这些 handler 不能真正"处理"native SEH(SEH 异常 V8 接不住),
   * 只能 log + 让 Node.js 不进一步把进程状态搞乱
   */
  private registerFatalErrorHandlers(): void {
    process.on('uncaughtException', (err, origin) => {
      try {
        this.log.error(`[uncaughtException] origin=${origin}: ${err?.message || err}`);
        if (err?.stack) this.log.error(err.stack);
      } catch {
        /* noop — log 本身崩了就放弃 */
      }
    });

    process.on('unhandledRejection', (reason: any) => {
      try {
        const msg = reason?.message || reason?.toString() || String(reason);
        this.log.error(`[unhandledRejection] ${msg}`);
      } catch {
        /* noop */
      }
    });
  }
}
