// game-worker.ts: 每个游戏窗口一个 worker
// P4-B: 完整战斗循环(找怪 → 接近 → 战斗 → 死亡 → 找下一个)

import { parentPort, workerData } from 'worker_threads';
import type { TaskType, ScriptStatus, TaskName } from '../shared/types';
import {
  getDamoo,
  bindWindow,
  unbindWindow,
  releaseDamoo,
  DEFAULT_DAMOO_CONFIG,
  type DamooConfig,
} from '../core/platform/damoo/damoo-instance';
import { DamooVisionProvider } from '../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../core/platform/input/damoo/DamooInputProvider';
import { CoordinateReader } from '../core/state/CoordinateReader';
import { SkillManager } from '../core/state/SkillManager';
import { TargetFinder } from '../core/combat/TargetFinder';
import { CombatEngine, type CombatState } from '../core/combat/CombatEngine';
import { createLogger } from '../core/logger';

const log = createLogger('worker');

if (!parentPort) {
  throw new Error('必须在 worker_threads 中运行');
}

interface InitData {
  hwnd: number;
  characterName: string;
  taskType: TaskType;
  damooConfig?: Partial<DamooConfig>;
  profile?: any;
  taskConfig?: any;  // 任务配置(FarmTaskConfig 等)
  /**
   * true = bootstrap 模式:
   *   走完整初始化(大漠加载 / 绑窗 / 字符库 / OCR / 截图),
   *   但不进入战斗循环,停在 idle 等 'start-task' 命令
   * false/undefined = 直接进入战斗(老行为)
   */
  waitForConfig?: boolean;
  /** 缩略图本地存储目录(主进程传过来) */
  thumbsDir?: string;
}

const init = workerData as InitData;

const taskNameMap: Record<TaskType, TaskName> = {
  farm: '挂机打怪',
  mine: '挖矿',
  'catch-pet': '捕捉宠物',
  refine: '装备炼化',
  reputation: '名誉任务',
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
  parentPort!.postMessage({ type: 'log', level, msg });
  // 同步打到 pino(便于 dev/console 查)
  if (level === 'info') log.info(msg);
  else if (level === 'warn') log.warn(msg);
  else if (level === 'error') log.error(msg);
  else log.debug(msg);
}

function setStatus(status: ScriptStatus, detail?: string) {
  currentStatus = status;
  parentPort!.postMessage({
    type: 'state',
    state: { status, statusDetail: detail, startedAt: _startedAt },
  });
}

/**
 * OCR 读角色名(MOCK 实现)
 * 真实实现:用大漠 Ocr 读角色头像旁边的名字
 *  - 在 Profile 里配 selfName 区域(region)
 *  - dm.Ocr(x1, y1, x2, y2, "FFFFFF-FFFFFF", 0.8) 读白字
 * 现在 mock:返回传入的名字 + 随机后缀
 */
async function readCharacterNameMock(_dm: any, fallback: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  const r = Math.floor(Math.random() * 100);
  return `${fallback || '角色'}-${r.toString().padStart(2, '0')}`;
}

/**
 * 用大漠 Capture 截游戏窗口,直接写本地 PNG,推 thumb:// URL 给主进程
 * 不依赖 BindWindow:dm.Capture 直接读帧缓冲,即使绑定失败也能用
 * (需要 dm.dll 注册成功 + 大漠注册码有效)
 *
 * 本地存储(避免 base64 dataURL 太大导致 IPC 慢 + React img 解析慢):
 *   写到 <thumbsDir>/<hwnd>.png(同 hwnd 覆盖)
 *   推 thumb://<hwnd> URL → renderer <img src> 通过自定义协议加载
 */
async function takeAndSendThumbnail(dm: any, hwnd: number): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = (workerData as InitData).thumbsDir || path.join(require('os').tmpdir(), 'fo-help-thumbnails');
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const filePath = path.join(thumbsDir, `${hwnd}.png`);
    // 大漠 Capture 截 0,0 - 192,108(1920x1080 缩到 192x108,大漠自动处理)
    const ret = dm.Capture(0, 0, 192, 108, filePath);
    if (ret !== 1) {
      sendLog('warn', `大漠 Capture 返回 ${ret},缩略图跳过`);
      return;
    }
    if (!fs.existsSync(filePath)) {
      sendLog('warn', `大漠 Capture 文件不存在: ${filePath}`);
      return;
    }
    const stat = fs.statSync(filePath);
    // 推 thumb://image/<hwnd> URL(几字节),renderer 端用 <img src> 加载
    // (用 hostname='image' + path 放 hwnd,避免纯数字 hwnd 被 URL parser 错认为 IPv4)
    parentPort!.postMessage({
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
  sendLog('info', `Worker 启动: hwnd=${init.hwnd} 任务=${taskNameMap[init.taskType]} 角色=${init.characterName}`);

  const profile = init.profile;
  if (profile) {
    sendLog('info', `Profile: ${profile.id} | ${profile.name} | 职业=${profile.class.name}`);
    const kw = profile.combat?.mobFilter?.nameKeywords;
    if (kw) sendLog('info', `  找怪关键字: ${kw.join(', ')}`);
  } else {
    sendLog('warn', '未指定 Profile');
  }

  // 1. 加载大漠
  let dm: any;
  try {
    _dm = getDamoo();
    dm = _dm;
    sendLog('info', `大漠加载成功,版本 ${dm.Ver()}`);
  } catch (e: any) {
    log.error(`大漠加载失败: ${e.message}`);
    setStatus('alert', '大漠未加载');
    return;
  }

  // 2. 绑窗口
  const profileEngine = profile?.engine;
  const cfg: DamooConfig = {
    display: profileEngine?.display || init.damooConfig?.display || DEFAULT_DAMOO_CONFIG.display,
    mouse: profileEngine?.mouse || init.damooConfig?.mouse || DEFAULT_DAMOO_CONFIG.mouse,
    keypad: profileEngine?.keypad || init.damooConfig?.keypad || DEFAULT_DAMOO_CONFIG.keypad,
    mode: profileEngine?.mode ?? init.damooConfig?.mode ?? DEFAULT_DAMOO_CONFIG.mode,
  };
  const bindOk = _bindSuccess = bindWindow(init.hwnd, cfg);
  if (!bindOk) {
    sendLog('error', `窗口绑定失败 hwnd=${init.hwnd} dm.GetLastError=${dm.GetLastError?.()}`);
    setStatus('alert', '窗口绑定失败');
    return;
  }

  // 3. 加载字库
  if (profile?.fontLib) {
    try {
      const path = require('path');
      const { app } = require('electron');
      const fontPath = path.isAbsolute(profile.fontLib) ? profile.fontLib : path.join(app.getAppPath(), profile.fontLib);
      dm.SetDict(0, fontPath);
      dm.UseDict(0);
      sendLog('info', `字库已加载: ${fontPath}`);
    } catch (e: any) {
      sendLog('warn', `字库加载失败: ${e.message}`);
    }
  }

  // 3.5 OCR 读角色名(MOCK)
  characterName = await readCharacterNameMock(dm, init.characterName);
  sendLog('info', `OCR 角色名: ${characterName}`);

  // 把角色名告诉主进程
  parentPort!.postMessage({
    type: 'state',
    state: {
      characterName,
    },
  });

  // 3.6 截 1 张缩略图(用大漠 Capture)推给主进程
  await takeAndSendThumbnail(dm, init.hwnd);

  // 4. 初始化引擎
  const vision = new DamooVisionProvider();
  const input = new DamooInputProvider();
  vision.bind(init.hwnd);
  input.bind(init.hwnd);

  if (!profile) {
    sendLog('error', '战斗模式需要 Profile');
    setStatus('alert', '缺 Profile');
    return;
  }

  const coord = new CoordinateReader(vision, profile);
  const skills = new SkillManager(input, profile);
  const finder = new TargetFinder(vision);
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

  // 4.5 bootstrap 模式:停在 idle 等 'start-task' 命令
  if (_waitForConfig) {
    sendLog('info', 'bootstrap 模式:等待 start-task 命令...');
    setStatus('idle', '等待启动');
    await new Promise<void>((resolve) => {
      _startResolve = resolve;
    });
    _startResolve = null;
    sendLog('info', '收到 start-task,开始执行任务');
  }

  // 5. 主循环
  if (init.taskType === 'farm') {
    // 真实战斗循环
    await combat.start();
  } else {
    // 其他任务暂未实现,fallback
    sendLog('warn', `任务 ${init.taskType} 暂未实现,只跑挂机打怪`);
    await combat.start();
  }

  sendLog('info', 'Worker 主循环结束');
}

// 命令
parentPort.on('message', (msg: any) => {
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
        // 如果还在等命令,先 resolve 退出等待
        if (_startResolve) {
          _startResolve();
          _startResolve = null;
        }
        combat?.stop();
        unbindWindow();
        releaseDamoo();
        setStatus('idle', '已停止');
        setTimeout(() => process.exit(0), 100);
        break;
      case 'pause':
        sendLog('info', '收到 pause');
        // bootstrap 阶段 pause 无意义,直接 reject 等待
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
        // 截图请求(主进程转发 renderer)
        handleScreenshot().catch((e) => sendLog('error', `截图失败: ${e.message}`));
        break;
    }
  }
});

async function handleScreenshot(): Promise<void> {
  if (!_dm) {
    try { _dm = getDamoo(); } catch { /* noop */ }
  }
  if (_dm) {
    await takeAndSendThumbnail(_dm, init.hwnd);
  } else {
    sendLog('warn', '截图失败:大漠未加载');
  }
}

main().catch((e) => {
  sendLog('error', `Worker 异常: ${e.message}`);
  setStatus('alert', e.message);
});
