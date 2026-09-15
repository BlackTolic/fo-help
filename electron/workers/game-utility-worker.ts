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
import type { TaskType, ScriptStatus, TaskName } from '../../shared/types';

const log = createLogger('utility-worker');

if (!process.parentPort) {
  throw new Error('必须在 Electron utilityProcess 中运行');
}

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

const init = parseInitData();

const taskNameMap: Record<TaskType, TaskName> = {
  farm: '挂机打怪',
  mine: '挖矿',
  'catch-pet': '捕捉宠物',
  refine: '装备炼化',
  reputation: '名誉任务',
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
let _startedAt = Date.now();
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

async function takeAndSendThumbnail(hwnd: number): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = init.thumbsDir || path.join(require('os').tmpdir(), 'fo-help-thumbnails');
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const filePath = path.join(thumbsDir, `${hwnd}.png`);
    const ret = dmApi.capture(0, 0, 192, 108, filePath);
    if (ret !== 1) {
      const code = dmApi.getLastError();
      const { message, advice } = dmErrorFull(code);
      sendLog('warn', `大漠 Capture 返回 ${ret} code=${code} ${message}${advice ? ' | 建议:' + advice : ''}`);
      return;
    }
    if (!fs.existsSync(filePath)) {
      sendLog('warn', `大漠 Capture 文件不存在: ${filePath}`);
      return;
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
  } catch (e: any) {
    sendLog('warn', `截图失败: ${e.message}`);
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

async function main() {
  sendLog('info', `UtilityWorker 启动(PID=${process.pid}): hwnd=${init.hwnd} 任务=${taskNameMap[init.taskType]} 角色=${init.characterName}`);

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
    _dm = getDamoo();
    sendLog('info', `大漠加载成功,版本 ${dmApi.version()}`);
  } catch (e: any) {
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
  const bindOk = _bindSuccess = bindWindow(init.hwnd, cfg);
  if (!bindOk) {
    const code = dmApi.getLastError();
    const { message, advice } = dmErrorFull(code);
    sendLog('error', `窗口绑定失败 hwnd=${init.hwnd} code=${code} ${message}${advice ? ' | 建议:' + advice : ''}`);
    setStatus('alert', `绑定失败: ${message}`);
    await takeAndSendThumbnail(init.hwnd);
    return;
  }

  if (profile?.fontLib) {
    try {
      const path = require('path');
      const { app } = require('electron');
      const fontPath = path.isAbsolute(profile.fontLib) ? profile.fontLib : path.join(app.getAppPath(), profile.fontLib);
      dmApi.setDict(0, fontPath);
      dmApi.useDict(0);
      sendLog('info', `字库已加载: ${fontPath}`);
    } catch (e: any) {
      sendLog('warn', `字库加载失败: ${e.message}`);
    }
  }

  characterName = await readCharacterNameMock(init.characterName);
  sendLog('info', `OCR 角色名: ${characterName}`);

  process.parentPort!.postMessage({
    type: 'state',
    state: {
      characterName,
    },
  });

  await takeAndSendThumbnail(init.hwnd);

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
    setStatus('idle', '等待启动');
    await new Promise<void>((resolve) => {
      _startResolve = resolve;
    });
    _startResolve = null;
    sendLog('info', '收到 start-task,开始执行任务');
  }

  if (init.taskType === 'farm') {
    await combat.start();
  } else {
    sendLog('warn', `任务 ${init.taskType} 暂未实现,只跑挂机打怪`);
    await combat.start();
  }

  sendLog('info', 'UtilityWorker 主循环结束');
}

process.parentPort.on('message', (msg: any) => {
  if (msg.type === 'command') {
    switch (msg.command) {
      case 'start-task':
        sendLog('info', '收到 start-task');
        if (_startResolve) {
          _startResolve();
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
        // ✅ utilityProcess 子进程:dm.dll 进程级副作用不影响其他子进程
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
        setStatus('paused', '用户暂停');
        break;
      case 'resume':
        sendLog('info', '收到 resume');
        if (combat) {
          combat.start().catch((e) => sendLog('error', `resume 失败: ${e.message}`));
        }
        break;
      case 'screenshot':
        handleScreenshot().catch((e) => sendLog('error', `截图失败: ${e.message}`));
        break;
      case 'screenshot-test':
        takeAndSendThumbnailTest(init.hwnd).catch((e) => sendLog('error', `测试截图失败: ${e.message}`));
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
    dmApi.getFullScreenData(`testscreen-${hwnd}-${ts}.png`);
    if (ret !== 1) {
      sendLog('warn', `测试截图 Capture 返回 ${ret}`);
      process.parentPort!.postMessage({ type: 'thumbnail-test', hwnd, error: `Capture 返回 ${ret}` });
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
    try { _dm = getDamoo(); } catch { /* noop */ }
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
// ⚠️ 必须在顶层代码末尾发,保证 listener 注册后才发,父进程收到 'ready' 后
//   再 postMessage start-task/stop 等命令,绝对不会再丢消息
process.parentPort!.postMessage({ type: 'ready', hwnd: init.hwnd });
