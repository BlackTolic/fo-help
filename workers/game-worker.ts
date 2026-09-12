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
void currentStatus; // 写到 setStatus,TS 可能误判
let _running = true;       // 模块作用域,让 stop 命令能停
void _running;
let _startedAt = Date.now();
void _startedAt;
let killCount = 0;
void killCount;
let _bindSuccess = false;
void _bindSuccess;
let combat: CombatEngine | null = null;
void combat;

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

// 预留给 P5 心跳: function reportFullState(extra = {}) { ... }

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
    dm = getDamoo();
    sendLog('info', `大漠加载成功,版本 ${dm.Ver()}`);
  } catch (e: any) {
    sendLog('error', `大漠加载失败: ${e.message}`);
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
      case 'stop':
        sendLog('info', '收到 stop');
        _running = false;
        combat?.stop();
        unbindWindow();
        releaseDamoo();
        setStatus('idle', '已停止');
        setTimeout(() => process.exit(0), 100);
        break;
      case 'pause':
        sendLog('info', '收到 pause');
        combat?.stop();
        setStatus('paused', '用户暂停');
        break;
      case 'resume':
        sendLog('info', '收到 resume');
        // 重新启动
        if (combat) {
          combat.start().catch((e) => sendLog('error', `resume 失败: ${e.message}`));
        }
        break;
    }
  }
});

main().catch((e) => {
  sendLog('error', `Worker 异常: ${e.message}`);
  setStatus('alert', e.message);
});
