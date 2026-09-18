// game-utility-worker.ts: utilityProcess 子进程入口
//
// ⚠️ 为什么用 utilityProcess 而不是 worker_threads?
//   dm.dll v7.2543 是 in-process COM dll,内部维护进程级:
//     - 全局绑定表(最近一次 BindWindow 的窗口)
//     - Win32 低级鼠标/键盘 hook(user32.dll 维护,跨线程共享)
//   多 worker_threads 在同一进程内同时绑多个窗口会:
//     - 互相踩 hook → 鼠标/键盘操作不生效 / 段错误 → 主进程闪退
//     - "上次未正常解绑"标记污染下次 BindWindow → code=-16
//   utilityProcess 是独立 OS 进程,每个子进程有自己的 dm.dll 实例,
//   完全隔离,真正支持多窗口多开
//
// 通信协议与 game-worker.ts 完全一致(parentPort.on/postMessage),
// init data 通过 process.argv 传入(JSON 字符串)

import {
  getDamoo,
  bindWindow,
  DEFAULT_DAMOO_CONFIG,
  dmApi,
  type DamooConfig,
} from '../../core/platform/damoo/dm-api';
import { dmErrorFull } from '../../core/platform/damoo/dm-errors';
import { DamooVisionProvider } from '../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../core/platform/input/damoo/DamooInputProvider';
import { CoordinateReader } from '../../core/state/CoordinateReader';
import { SkillManager } from '../../core/state/SkillManager';
import { TargetFinder } from '../../core/combat/TargetFinder';
import { CombatEngine, type CombatState } from '../../core/combat/CombatEngine';
import { createLogger } from '../../core/logger';
import type { TaskType, ScriptStatus, TaskName, DefaultSkillTaskConfig } from '../../shared/types';
import { parseKeyCombo } from '../../shared/key-combo';

const log = createLogger('utility-worker');

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

async function runDefaultSkill(cfg: DefaultSkillTaskConfig): Promise<void> {
  // ★ 诊断:把 cfg 摘要打出来,定位 steps 为空的原因(undefined / [] / 全 disabled)
  sendLog(
    'info',
    `缺省技能 config 摘要: cfg=${cfg ? 'present' : 'undefined'}, type=${cfg?.type}, ` +
      `steps.length=${cfg?.steps?.length ?? 'n/a'}, ` +
      `loopCount=${cfg?.loopCount}, loopIntervalMs=${cfg?.loopIntervalMs}, ` +
      `steps=${cfg?.steps ? JSON.stringify(cfg.steps.map((s) => ({ key: s.key, enabled: s.enabled, intervalMs: s.intervalMs }))) : 'n/a'}`,
  );
  const steps = (cfg.steps || []).filter((s) => s.enabled !== false);
  if (steps.length === 0) {
    sendLog('warn', '缺省技能任务:steps 为空或全部禁用,直接结束');
    setStatus('idle', '无可执行步骤');
    return;
  }
  const loopCount = cfg.loopCount ?? 0; // 0 = 无限
  const infinite = loopCount === 0;
  sendLog(
    'info',
    `缺省技能循环开始: ${steps.length} 个步骤, 循环=${infinite ? '无限' : loopCount + ' 轮'}`,
  );
  setStatus('combat', `缺省技能: 第 1 轮 / ${infinite ? '∞' : loopCount}`);

  let loop = 0;
  while (_skillRunning && (infinite || loop < loopCount)) {
    for (let i = 0; i < steps.length; i++) {
      if (!_skillRunning) break;

      // 暂停检查:在每一步之间等 resume
      if (_skillPaused) {
        setStatus('paused', `缺省技能: 第 ${loop + 1} 轮 第 ${i + 1} 步前暂停`);
        await new Promise<void>((resolve) => {
          _skillResumeResolve = resolve;
        });
      }
      if (!_skillRunning) break;

      const step = steps[i];
      const parsed = parseKeyCombo(step.key);
      if (!parsed) {
        sendLog('warn', `缺省技能:不支持的按键 "${step.key}",跳过`);
        continue;
      }

      // 执行按键:修饰键按下 → 主键 keyDown → 等 holdMs → 主键 keyUp → 修饰键抬起(反序)
      try {
        for (const m of parsed.modifiers) dmApi.keyDown(m);
        dmApi.keyDown(parsed.mainVk);
        await new Promise((r) => setTimeout(r, step.holdMs ?? 50));
        dmApi.keyUp(parsed.mainVk);
        for (let k = parsed.modifiers.length - 1; k >= 0; k--) {
          dmApi.keyUp(parsed.modifiers[k]);
        }
      } catch (e: any) {
        sendLog('error', `缺省技能按键失败 step=${i + 1} key=${step.key}: ${e.message}`);
      }

      // 步骤间间隔
      if (step.intervalMs > 0 && i < steps.length - 1) {
        await new Promise((r) => setTimeout(r, step.intervalMs));
      } else if (step.intervalMs > 0 && i === steps.length - 1) {
        // 最后一步也等 intervalMs,后面再统一等 loopIntervalMs(避免双倍等待)
        await new Promise((r) => setTimeout(r, step.intervalMs));
      }
    }
    if (!_skillRunning) break;

    loop++;
    _skillLoopCount = loop;
    setStatus(
      'combat',
      `缺省技能: 第 ${infinite ? loop + 1 : Math.min(loop + 1, loopCount)} 轮 / ${infinite ? '∞' : loopCount}`,
    );

    // 轮间间隔
    if (cfg.loopIntervalMs > 0 && (infinite || loop < loopCount)) {
      await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
    }
  }

  sendLog('info', `缺省技能循环结束,共执行 ${loop} 轮`);
  _skillPaused = false;
  _skillResumeResolve = null;
  setStatus('idle', `缺省技能已结束(${loop} 轮)`);
}

/**
 * 兜底异常处理 — 防止 dm.dll / winax 的 native SEH 异常绕过 V8 TryCatch
 * 触发 STATUS_FATAL_USER_CALLBACK_EXCEPTION (0xC00000D0) → 子进程非正常退出
 *
 * 注意:这些 handler 不能真正"处理"native SEH(SEH 异常 V8 接不住),
 * 只能 log + 让 Node.js 不进一步把进程状态搞乱
 */
process.on('uncaughtException', (err, origin) => {
  try {
    log.error(`[uncaughtException] origin=${origin}: ${err?.message || err}`);
    if (err?.stack) log.error(err.stack);
  } catch {
    /* noop — log 本身崩了就放弃 */
  }
});

process.on('unhandledRejection', (reason: any) => {
  try {
    const msg = reason?.message || reason?.toString() || String(reason);
    log.error(`[unhandledRejection] ${msg}`);
  } catch {
    /* noop */
  }
});

interface InitData {
  hwnd: number;
  characterName: string;
  taskType: TaskType;
  damooConfig?: Partial<DamooConfig>;
  profile?: any;
  taskConfig?: any;
  waitForConfig?: boolean;
  thumbsDir?: string;
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

// 获取主进程参数：'{"hwnd":12345,"characterName":"...","taskType":"farm",...}'
const init = parseInitData();

const taskNameMap: Record<TaskType, TaskName> = {
  farm: '挂机打怪',
  mine: '挖矿',
  'catch-pet': '捕捉宠物',
  refine: '装备炼化',
  reputation: '名誉任务',
  'default-skill': '缺省技能',
};

const DEFAULT_PROFILE: any = {
  id: 'default',
  name: 'Default',
  class: {
    name: 'warrior',
    skills: {},
    potions: {},
  },
  combat: {
    findTargetIntervalMs: 1500,
    combatTimeoutMs: 60000,
    mobFilter: { nameKeywords: [] },
  },
  engine: {},
  regions: {},
};

let currentStatus: ScriptStatus = 'idle';
void currentStatus;
let _running = true;
void _running;
const _startedAt = Date.now();
void _startedAt;
let killCount = 0;
void killCount;
let _bindSuccess = false;
void _bindSuccess;
let characterName = '';
let combat: CombatEngine | null = null;
void combat;
let _dm: any = null;
void _dm;
const _waitForConfig = init.waitForConfig === true;
let _startResolve: (() => void) | null = null;

// ===== 缺省技能任务(default-skill)的运行控制 =====
// 与 combat 解耦:缺省技能不依赖战斗引擎,自己管一个 while 循环
let _skillRunning = true;
let _skillPaused = false;
let _skillResumeResolve: (() => void) | null = null;
let _skillLoopCount = 0; // 已跑完多少轮(用于日志 + UI 状态)
void _skillLoopCount;
/**
 * ⚠️ Race-condition 兜底: spawn 后几百毫秒 主进程可能立刻 postMessage start-task,
 *   此时 worker 还在 loadDamoo 同步阶段(_startResolve 还是 null)。实测 dm.dll 加载
 *   要 2~3s,触发窗口很大。
 *   暂存这次 start-task,等 Promise executor 设 _startResolve 时自检补回。
 */
let _pendingStart = false;

function sendLog(level: string, msg: string) {
  process.parentPort!.postMessage({ type: 'log', level, msg });
  if (level === 'info') log.info(msg);
  else if (level === 'warn') log.warn(msg);
  else if (level === 'error') log.error(msg);
  else log.debug(msg);
}

function setStatus(status: ScriptStatus, detail?: string) {
  currentStatus = status;
  process.parentPort!.postMessage({
    type: 'state',
    state: { status, statusDetail: detail, startedAt: _startedAt },
  });
}

async function readCharacterNameMock(fallback: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  const r = Math.floor(Math.random() * 100);
  return `${fallback || '角色'}-${r.toString().padStart(2, '0')}`;
}

async function takeAndSendThumbnail(hwnd: number): Promise<boolean> {
  // 截图失败不阻断流程:回传 dataUrl=null 的 thumbnail 消息,
  // 让父进程 bootstrap/requestThumbnail 正常 resolve,而不是 setStatus('alert') 导致 reject
  const notifyFailure = (detail: string): void => {
    sendLog('error', detail);
    process.parentPort!.postMessage({ type: 'thumbnail', hwnd, dataUrl: null, error: detail });
  };
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = init.thumbsDir || path.join(require('os').tmpdir(), 'fo-help-thumbnails');
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const filePath = path.join(thumbsDir, `${hwnd}.png`);
    // dmApi.capture 也是同步原生调用,加了步骤标记方便 hang 定位
    stepStart(`capture(hwnd=${hwnd})`);
    const ret = dmApi.capture(0, 0, 192, 108, filePath);
    stepEnd('capture', ret === 1, `ret=${ret}`);
    if (ret !== 1) {
      const code = dmApi.getLastError();
      const { message, advice } = dmErrorFull(code);
      // code=0 时大漠自身无错误码,最常见原因是窗口大部分位于屏幕外/被遮挡:
      // dx.graphic.2d 靠 hook D3D 渲染取图,屏幕外区域不渲染,Capture 返回 0
      const extra =
        code === 0
          ? ' | 建议:检查游戏窗口是否大部分在屏幕外或被遮挡(dx 模式无法截取屏幕外区域),把窗口移回屏幕内后重试;仍失败可改用 gdi/normal 显示模式'
          : '';
      notifyFailure(
        `截图失败: dmApi.capture 返回 ${ret}, code=${code} ${message}${advice ? ' | 建议:' + advice : ''}${extra}`,
      );
      return false;
    }
    if (!fs.existsSync(filePath)) {
      notifyFailure(`截图失败: dmApi.capture 返回 1 但文件未生成 (${filePath})`);
      return false;
    }
    const stat = fs.statSync(filePath);
    process.parentPort!.postMessage({
      type: 'thumbnail',
      hwnd,
      dataUrl: `thumb://image/${hwnd}`,
      filePath,
      size: stat.size,
    });
    sendLog('info', `缩略图已写入 (${(stat.size / 1024).toFixed(0)}KB) → ${filePath}`);
    return true;
  } catch (e: any) {
    notifyFailure(`截图异常: ${e.message}`);
    return false;
  }
}

const STATUS_MAP: Record<CombatState['kind'], ScriptStatus> = {
  idle: 'idle',
  searching: 'moving',
  approaching: 'moving',
  engaging: 'combat',
  looting: 'combat',
  alert: 'alert',
  paused: 'paused',
} as const;

// 在每个同步/原生阻塞调用前后写 stderr 标记,父进程 bootstrap 超时 kill 时
// 通过这些标记可以精确定位卡在哪一步(loadDamoo / bindWindow / capture)
// 注意:必须用 process.stderr.write 同步写,不能用 log.*(pino 是异步,buffer 满可能丢失)
function stepStart(name: string) {
  try {
    process.stderr.write(`[STEP-START] ${name} [+${Date.now() - _mainStart}ms]\n`);
  } catch {}
  _currentStep = name;
}
function stepEnd(name: string, ok: boolean, extra?: string) {
  try {
    process.stderr.write(
      `[STEP-END] ${name} ${ok ? 'OK' : 'FAIL'} [+${Date.now() - _mainStart}ms]${extra ? ' ' + extra : ''}\n`,
    );
  } catch {}
}
let _currentStep = '(none)';
let _mainStart = Date.now();
void _currentStep;
void _mainStart;

async function main() {
  const t0 = Date.now();
  _mainStart = t0;
  const elapsed = () => `[+${Date.now() - t0}ms]`;
  sendLog(
    'info',
    `UtilityWorker 启动(PID=${process.pid}) ${elapsed()}: hwnd=${init.hwnd} 任务=${taskNameMap[init.taskType]} 角色=${init.characterName}`,
  );
  try {
    process.stderr.write(`[STEP-START] main 进入 [+0ms]\n`);
  } catch {}

  const profile = init.profile || DEFAULT_PROFILE;
  if (init.taskConfig?.type === 'farm' && init.taskConfig.mobFilter?.nameKeywords) {
    profile.combat = profile.combat || {};
    profile.combat.mobFilter = {
      ...profile.combat.mobFilter,
      nameKeywords: init.taskConfig.mobFilter.nameKeywords,
    };
    sendLog('info', `taskConfig 找怪关键字: ${init.taskConfig.mobFilter.nameKeywords.join(', ')}`);
  } else {
    sendLog('info', `默认 profile: 职业=${profile.class?.name || 'warrior'}`);
  }

  try {
    const tLoad = Date.now();
    stepStart('loadDamoo(同步 COM 初始化 + 注册码校验)');
    _dm = getDamoo();
    const ver = dmApi.version();
    stepEnd('loadDamoo', true, `version=${ver} 耗时=${Date.now() - tLoad}ms`);
    sendLog('info', `大漠加载成功,版本 ${ver} (耗时 ${Date.now() - tLoad}ms)`);
  } catch (e: any) {
    stepEnd('loadDamoo', false, e.message);
    log.error(`大漠加载失败: ${e.message}`);
    setStatus('alert', '大漠未加载');
    return;
  }

  const profileEngine = profile?.engine;
  const cfg: DamooConfig = {
    display: profileEngine?.display || init.damooConfig?.display || DEFAULT_DAMOO_CONFIG.display,
    mouse: profileEngine?.mouse || init.damooConfig?.mouse || DEFAULT_DAMOO_CONFIG.mouse,
    keypad: profileEngine?.keypad || init.damooConfig?.keypad || DEFAULT_DAMOO_CONFIG.keypad,
    mode: profileEngine?.mode ?? init.damooConfig?.mode ?? DEFAULT_DAMOO_CONFIG.mode,
  };
  const tBind = Date.now();
  // ⚠️ bindWindow 在以下场景会同步 hang(无法 unblock):
  //   - hwnd 无效/已销毁(此时 dm.dll 等不到窗口消息,无限挂起)
  //   - 窗口最小化/被遮挡且 mode 选了 dx.public.inject(等 D3D 表面)
  //   - 反作弊拦截 user32 hook 安装
  //   stepStart/stepEnd 是同步 stderr 写入,即使后续 hang 也能在 stderr 看到「卡在 bindWindow」
  stepStart(`bindWindow(hwnd=${init.hwnd}, mode=${cfg.mode}, display=${cfg.display})`);
  const bindOk = (_bindSuccess = bindWindow(init.hwnd, cfg));
  stepEnd('bindWindow', bindOk, `耗时=${Date.now() - tBind}ms`);
  sendLog('info', `bindWindow 完成: ${bindOk ? '成功' : '失败'} (耗时 ${Date.now() - tBind}ms)`);
  if (!bindOk) {
    const code = dmApi.getLastError();
    const { message, advice } = dmErrorFull(code);
    sendLog(
      'error',
      `窗口绑定失败 hwnd=${init.hwnd} code=${code} ${message}${advice ? ' | 建议:' + advice : ''}`,
    );
    // 绑定失败后不再截图:未绑定状态下 Capture 必然失败,
    // 会掩盖真正的「绑定失败」根因,误导排查方向
    setStatus('alert', `绑定失败: ${message}`);
    return;
  }

  if (profile?.fontLib) {
    try {
      const path = require('path');
      const { app } = require('electron');
      const fontPath = path.isAbsolute(profile.fontLib)
        ? profile.fontLib
        : path.join(app.getAppPath(), profile.fontLib);
      dmApi.setDict(0, fontPath);
      dmApi.useDict(0);
      sendLog('info', `字库已加载: ${fontPath}`);
    } catch (e: any) {
      sendLog('warn', `字库加载失败: ${e.message}`);
    }
  }

  // OCR读取角色名称
  characterName = await readCharacterNameMock(init.characterName);
  sendLog('info', `OCR 角色名: ${characterName}`);

  process.parentPort!.postMessage({
    type: 'state',
    state: {
      characterName,
    },
  });

  const tCap = Date.now();
  // 截图只影响缩略图显示,失败(返回 false)不阻断后续战斗循环,
  // takeAndSendThumbnail 内部已回传 dataUrl=null 让 bootstrap 正常 resolve
  const captureOk = await takeAndSendThumbnail(init.hwnd);
  if (!captureOk) {
    sendLog('warn', `缩略图截图失败(不影响后续任务)。耗时 ${Date.now() - tCap}ms`);
  }
  sendLog('info', `thumbnail 发送完成 (耗时 ${Date.now() - tCap}ms)`);

  const vision = new DamooVisionProvider();
  const input = new DamooInputProvider();
  vision.bind(init.hwnd);
  input.bind(init.hwnd);

  const coord = new CoordinateReader(vision, profile);
  const skills = new SkillManager(input, profile);
  const finder = new TargetFinder();
  combat = new CombatEngine(input, coord, skills, finder, profile, {
    onLog: (level, msg) => sendLog(level, msg),
    onStateChange: (s) => {
      const status: ScriptStatus = STATUS_MAP[s.kind] as ScriptStatus;
      let detail: string = s.kind;
      if (s.kind === 'engaging') detail = `战斗中: ${(s as any).target.name}`;
      else if (s.kind === 'approaching') detail = `接近: ${(s as any).target.name}`;
      else if (s.kind === 'alert') detail = `异常: ${(s as any).reason}`;
      setStatus(status, detail);
    },
    onKill: () => {
      killCount += 1;
      sendLog('info', `累计击杀: ${killCount}`);
    },
  });

  sendLog('info', '战斗引擎已就绪,开始循环...');

  if (_waitForConfig) {
    sendLog('info', 'bootstrap 模式:等待 start-task 命令...');
    setStatus('pending', '等待启动');
    await new Promise<void>((resolve) => {
      _startResolve = resolve;
      // Race-condition 自检: start-task 可能在 _startResolve 注册前就到了
      if (_pendingStart) {
        _pendingStart = false;
        sendLog('info', '从 _pendingStart 取出暂存的 start-task,立即放行');
        resolve();
      }
    });
    _startResolve = null;
    _pendingStart = false;
    sendLog('info', '收到 start-task,开始执行任务');
  }

  if (init.taskType === 'farm') {
    await combat.start();
  } else if (init.taskType === 'default-skill') {
    // 缺省技能:走自己的按键循环(不依赖 combat)
    const skillCfg = init.taskConfig as DefaultSkillTaskConfig | undefined;
    console.log('skillCfg:', skillCfg);
    if (!skillCfg || !Array.isArray(skillCfg.steps)) {
      sendLog('error', '缺省技能任务缺少 taskConfig.steps,直接结束');
      setStatus('alert', '缺省技能 config 缺失');
    } else {
      await runDefaultSkill(skillCfg);
    }
  } else {
    sendLog('warn', `任务 ${init.taskType} 暂未实现,只跑挂机打怪`);
    await combat.start();
  }

  sendLog('info', 'UtilityWorker 主循环结束');
}

process.parentPort.on('message', (event: any) => {
  // Electron 32.x UtilityProcess 把父进程发来的消息包成 MessageEvent 形状
  //   { data: <payload>, ports: [] }
  // 这跟 Node 标准 worker_threads.parentPort API 不一致(Node 应当 unwrap),
  // 解包一下保持正常使用
  const msg =
    event && typeof event === 'object' && 'data' in event && 'ports' in event ? event.data : event;
  console.log('收到消息:', msg?.type);
  if (msg?.type === 'command') {
    switch (msg.command) {
      case 'start-task':
        sendLog('info', `收到 start-task (taskType=${msg.taskType || '(未指定)'})`);
        // 覆盖 init 的 taskType + taskConfig — bootstrap 阶段 init.taskType 是 'farm' 兜底默认,
        //   真正任务类型由 dialog 保存后才确定,通过 start-task 命令告诉 worker
        if (msg.taskType) {
          init.taskType = msg.taskType;
          sendLog('info', `覆盖 init.taskType = ${init.taskType}`);
        }
        if (msg.taskConfig) {
          init.taskConfig = msg.taskConfig;
          sendLog('info', `覆盖 init.taskConfig = type=${init.taskConfig?.type}`);
        }
        if (_startResolve) {
          // 正常路径: _startResolve 已注册, 直接 resolve 让 main() 走完
          _startResolve();
        } else if (_waitForConfig) {
          // Race-condition: _startResolve 还没注册, 暂存让 main() 创建 Promise 时自检
          _pendingStart = true;
          sendLog('warn', 'start-task 在 _waitForConfig 早期到达, 暂存到 _pendingStart');
        } else {
          sendLog('warn', '收到 start-task,但 worker 未在等待状态(可能已启动)');
        }
        break;
      case 'stop':
        sendLog('info', '收到 stop');
        _running = false;
        if (_startResolve) {
          _startResolve();
          _startResolve = null;
        }
        combat?.stop();
        // 缺省技能:让按键循环跳出(顺便解除暂停,避免卡在 await Promise)
        _skillRunning = false;
        _skillPaused = false;
        if (_skillResumeResolve) {
          _skillResumeResolve();
          _skillResumeResolve = null;
        }
        // utilityProcess 子进程:dm.dll 进程级副作用不影响其他子进程
        //   每个子进程独立加载 dm.dll,UnBindWindow 只影响自己
        try {
          dmApi.unbindWindow();
          sendLog('info', '已 UnBindWindow');
        } catch (e: any) {
          sendLog('warn', `UnBindWindow 失败: ${e.message}`);
        }
        setStatus('idle', '已停止');
        // 给 in-flight 的 dm 调用留 300ms 完成
        setTimeout(() => process.exit(0), 300);
        break;
      case 'pause':
        sendLog('info', '收到 pause');
        if (_startResolve) {
          _startResolve();
          _startResolve = null;
        }
        combat?.stop();
        // 缺省技能:仅置位 paused,runDefaultSkill 内部 await Promise 阻塞
        if (init.taskType === 'default-skill') {
          _skillPaused = true;
        }
        setStatus('paused', '用户暂停');
        break;
      case 'resume':
        sendLog('info', '收到 resume');
        if (combat) {
          combat.start().catch((e) => sendLog('error', `resume 失败: ${e.message}`));
        }
        // 缺省技能:清 paused + resolve 暂停 Promise
        if (init.taskType === 'default-skill') {
          _skillPaused = false;
          if (_skillResumeResolve) {
            _skillResumeResolve();
            _skillResumeResolve = null;
          }
        }
        break;
      case 'screenshot':
        handleScreenshot().catch((e) => sendLog('error', `截图失败: ${e.message}`));
        break;
      case 'screenshot-test':
        takeAndSendThumbnailTest(init.hwnd).catch((e) =>
          sendLog('error', `测试截图失败: ${e.message}`),
        );
        break;
    }
  }
});

async function takeAndSendThumbnailTest(hwnd: number): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = init.thumbsDir;
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const ts = Date.now();
    const filePath = path.join(thumbsDir, `test-${hwnd}-${ts}.png`);
    const ret = dmApi.capture(0, 0, 100, 100, filePath);
    dmApi.getFullScreenData(path.join(thumbsDir, `testscreen-${hwnd}-${ts}.png`));
    if (ret !== 1) {
      sendLog('warn', `测试截图 Capture 返回 ${ret}`);
      process.parentPort!.postMessage({
        type: 'thumbnail-test',
        hwnd,
        error: `Capture 返回 ${ret}`,
      });
      return;
    }
    if (!fs.existsSync(filePath)) {
      process.parentPort!.postMessage({ type: 'thumbnail-test', hwnd, error: '文件未生成' });
      return;
    }
    const stat = fs.statSync(filePath);
    process.parentPort!.postMessage({ type: 'thumbnail-test', hwnd, filePath, size: stat.size });
    sendLog('info', `测试截图已写入 (${(stat.size / 1024).toFixed(0)}KB) → ${filePath}`);
  } catch (e: any) {
    process.parentPort!.postMessage({ type: 'thumbnail-test', hwnd: init.hwnd, error: e.message });
    sendLog('warn', `测试截图失败: ${e.message}`);
  }
}

async function handleScreenshot(): Promise<void> {
  if (!_dm) {
    try {
      _dm = getDamoo();
    } catch {
      /* noop */
    }
  }
  if (_dm) {
    await takeAndSendThumbnail(init.hwnd);
  } else {
    sendLog('warn', '截图失败:大漠未加载');
  }
}

main().catch((e) => {
  sendLog('error', `UtilityWorker 异常: ${e.message}`);
  setStatus('alert', e.message);
});

// 子进程初始化完成,发 'ready' 信号给父进程,告诉它 message listener 已注册
// ⚠️ 必须在顶层代码末尾立即发(不等 main() 完成!)
//   之前用 main().then(() => postMessage 'ready') 是 bug:
//   main() 是 async 且永不 resolve(战斗循环常驻),ready 信号永远不发 → startTask 一直超时
//   修复:在顶层代码末尾,所有 listener 注册后,立即 postMessage 'ready'
try {
  process.stderr.write(
    `[READY-DEBUG] 即将发 ready 信号, init.hwnd=${init?.hwnd}, process.argv.length=${process.argv.length}, process.argv[last]=${process.argv[process.argv.length - 1]?.slice(0, 100)}\n`,
  );
} catch {}
try {
  process.parentPort!.postMessage({ type: 'ready', hwnd: init.hwnd });
  try {
    process.stderr.write(`[READY-DEBUG] ✓ ready 信号 postMessage 成功\n`);
  } catch {}
} catch (e: any) {
  try {
    process.stderr.write(`[READY-DEBUG] ✗ ready 信号 postMessage 失败: ${e.message}\n`);
  } catch {}
}
