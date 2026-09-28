// 看门狗装配(worker 侧)
//   与任务主循环并发运行,处理:神医验证码 / 组队申请 / 生命回复 / 角色停级。
//   任务跑之前(pending 预览阶段,若已有配置)、任务运行中、暂停中 —— 都照处理。
//   暂停时也保持运行:验证码超时会掉线,暂停 ≠ 不管号。
//   stop 命令时由 commands.ts 调 stopInterruptWatcher() 一并停掉。
//
// 性能约定(2026-09):
//   看门狗是否启动完全由任务配置(挂机打怪页的四个开关)决定 ——
//   组队申请/神医验证码/生命回复/角色停级 全不勾选 = 不启动,不做任何额外轮询。
//   配置在 start-task 时才最终确定,所以由 syncInterruptWatcher() 按"配置指纹"按需
//   启动/重建/停止,而不是无条件 start。
//
// 新增检查项步骤:
//   1. core/constant-ocr/ 加识别区域常量
//   2. core/interrupt/detectors.ts / handlers.ts 加 detector/handler(或新建文件)
//   3. 在下面 buildWatchdogPlan() 加一条 rule

import { dmApi } from '../../../core/platform/damoo/dm-api';
import { DamooInputProvider } from '../../../core/platform/input/damoo/DamooInputProvider';
import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import type { FarmTaskConfig, GameResolution, TeamInviteAction } from '../../../shared/types';
import type { KeyCode } from '../../../core/platform/input/IInputProvider';
import {
  InterruptWatcher,
  createVerifyCodeDetector,
  createTeamInviteDetector,
  createBloodStatusDetector,
  createExpBarDetector,
  createVerifyCodeHandler,
  createTeamInviteHandler,
  createHealHandler,
  createStopFarmHandler,
  hasReadyItem,
  type HealItem,
  type PopupRule,
} from '../../../core/interrupt';
import { StaticCaptchaSolver, type CaptchaSolver } from '../../../core/ai/captcha-solver';
import { TuJianSolver } from '../../../core/ai/tu-jian';
import type { WorkerContext } from './context';

/**
 * 定分辨率档位(constant-ocr 常量按档位分)
 * 优先级:设置里选的档位(用户在设置面板显式指定)> hwnd 客户区实测尺寸 > '1280*800' 兜底
 * 用户在设置里指定档位是权威值:窗口客户区可能被缩放/带边框,实测尺寸未必等于坐标常量所依据的档位
 */
export function resolveWindowSizeKey(hwnd: number, preferred?: GameResolution | null): WindowSizeKey {
  if (preferred) return preferred;
  try {
    const w = { value: 0, byref: true } as any;
    const h = { value: 0, byref: true } as any;
    if (dmApi.getClientSize(hwnd, w, h) === 1 && w.value > 0 && h.value > 0) {
      return w.value >= 1600 ? '1600*900' : '1280*800';
    }
  } catch {
    /* noop */
  }
  return '1280*800';
}

/**
 * 创建验证码求解器(图鉴):
 *   账号密码取设置面板(app-settings.json 的 tuJianAccount / tuJianPassword,
 *   每次启动 worker 前由主进程新鲜读盘下发)
 * 没配账号不打断流程,只是每次都走兜底策略(点第一个选项),日志里会提示。
 */
function createSolver(ctx: WorkerContext): CaptchaSolver {
  const account = (ctx.init.settings?.tuJianAccount || '').trim();
  const password = (ctx.init.settings?.tuJianPassword || '').trim();
  if (!account || !password) {
    ctx.sendLog('warn', '[弹框看门狗] 未配置图鉴账号/密码(设置面板 → 图鉴账号),验证码将兜底点第一个选项');
    return new StaticCaptchaSolver('I');
  }
  return new TuJianSolver({
    account,
    password,
    // 识别结果 / 匹配得分记进 worker 日志,方便核对识别是否准确
    log: (level, msg) => ctx.sendLog(level, `[图鉴] ${msg}`),
  });
}

/** 可作为回血药的物品键位(与 farm.ts 的技能键位校验保持一致) */
const VALID_ITEM_KEYS = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);

/** 一次装配的结果:规则 + 配置指纹(指纹用于判断 start-task 后要不要重建) */
interface WatchdogPlan {
  signature: string;
  rules: PopupRule[];
}

/** 从任务技能里取出用户勾选的回血物品(method='item' 且键位合法) */
function resolveHealItems(ctx: WorkerContext, ids: string[]): HealItem[] {
  if (ids.length === 0) return [];
  const cfg = ctx.init.taskConfig as FarmTaskConfig | null | undefined;
  const skills = cfg?.type === 'farm' ? (cfg.skills ?? []) : [];
  const wanted = new Set(ids);
  return skills
    .filter((s) => s.enabled !== false && s.method === 'item' && wanted.has(s.id) && VALID_ITEM_KEYS.has(s.key))
    .map((s) => ({
      id: s.id,
      key: s.key as KeyCode,
      name: s.name,
      cooldownMs: Math.max(0, s.cooldownMs | 0),
    }));
}

/**
 * 按任务配置组装看门狗规则(新增检查项在这里加 rule)。
 * rules 为空 = 用户一项都没勾 → 调用方不启动看门狗。
 *
 * 兼容:旧配置没有 watchdog 字段 → 只开神医验证码,保持升级前的行为。
 */
function buildWatchdogPlan(ctx: WorkerContext, sizeKey: WindowSizeKey): WatchdogPlan {
  const cfg = ctx.init.taskConfig as FarmTaskConfig | null | undefined;
  const wd = cfg?.type === 'farm' ? (cfg.watchdog ?? { verifyCode: true }) : null;

  const teamInvite: TeamInviteAction | null = wd?.teamInvite?.action ?? null;
  const verifyCode = wd?.verifyCode === true;
  const healItems = resolveHealItems(ctx, wd?.autoHeal?.itemIds ?? []);
  const stopLevelUp = wd?.stopLevelUp === true;

  const signature = JSON.stringify({
    teamInvite,
    verifyCode,
    heal: healItems.map((i) => [i.id, i.key, i.cooldownMs]),
    stopLevelUp,
  });

  const rules: PopupRule[] = [];

  if (verifyCode) {
    const solver = createSolver(ctx);
    rules.push({
      type: 'verify-code',
      detector: createVerifyCodeDetector(sizeKey),
      handler: createVerifyCodeHandler(sizeKey, solver, ctx.init.verifyCodeDir),
      // 验证码处理含一次图鉴识别请求(数秒),single-flight 期间不会重复触发;
      // cooldown 兜底防处理失败后立即重试把接口打爆
      cooldownMs: 15000,
    });
  }

  if (teamInvite) {
    rules.push({
      type: 'team-invite',
      detector: createTeamInviteDetector(sizeKey),
      handler: createTeamInviteHandler(sizeKey, teamInvite),
      cooldownMs: 3000,
    });
  }

  if (healItems.length > 0) {
    rules.push({
      type: 'heal',
      detector: createBloodStatusDetector(sizeKey, () => hasReadyItem(healItems, ctx.lastCast)),
      handler: createHealHandler(healItems, ctx.lastCast),
      // 物品 CD 由 handler 走共享的 ctx.lastCast 自己管,这里的规则冷却只做防抖
      cooldownMs: 1000,
    });
  }

  if (stopLevelUp) {
    rules.push({
      type: 'stop-level-up',
      detector: createExpBarDetector(sizeKey),
      handler: createStopFarmHandler((reason) => {
        const ctrl = ctx.moveAttack;
        if (!ctrl.running) return;
        ctrl.stopReason = reason;
        ctrl.running = false;
        ctrl.paused = false;
        if (ctrl.resumeResolve) {
          ctrl.resumeResolve();
          ctrl.resumeResolve = null;
        }
      }),
      cooldownMs: 10000,
    });
  }

  return { signature, rules };
}

/**
 * 按当前任务配置同步看门狗状态:
 *   一项都没勾 → 停掉(如果之前开着),不做任何轮询(省性能)
 *   配置没变且已在跑 → 不动
 *   首次 / 配置变了 → 停掉旧的,按新规则重建
 *
 * 调用点:bootstrap 之后、start-task 覆盖配置之后(见 game-utility-worker.ts / commands.ts)。
 * watcher 实例挂在 ctx.interruptWatcher 上,stop 命令时停。
 */
export function syncInterruptWatcher(ctx: WorkerContext): void {
  const hwnd = ctx.init.hwnd;
  const sizeKey = resolveWindowSizeKey(hwnd, ctx.init.settings?.resolution);
  const plan = buildWatchdogPlan(ctx, sizeKey);

  if (plan.rules.length === 0) {
    if (ctx.interruptWatcher) {
      ctx.sendLog('info', '[看门狗] 当前任务未勾选任何看门狗项,已停止(省性能)');
      stopInterruptWatcher(ctx);
    } else {
      ctx.sendLog('info', '[看门狗] 当前任务未勾选任何看门狗项,不启动(省性能)');
    }
    return;
  }
  // 配置没变且已在跑 → 不动
  if (ctx.interruptWatcher && ctx.interruptSignature === plan.signature) return;

  // 配置变化:先停旧的,再按新规则重建
  stopInterruptWatcher(ctx);

  const input = new DamooInputProvider() as any;
  input.bind(hwnd);

  const watcher = new InterruptWatcher(plan.rules, {
    input, // 大漠输入提供器
    intervalMs: 700, // 轮询间隔(毫秒)
    log: (level, msg) => ctx.sendLog(level, msg), // 日志回调
    onEvent: (event) => {
      // 结构化事件上报主进程(便于 UI 展示/统计);失败不阻断看门狗
      try {
        ctx.postMessage({ type: 'interrupt', event }); // 上报事件
      } catch {
        /* noop */
      }
    },
  });
  watcher.start();
  ctx.interruptWatcher = watcher; // 挂载到上下文,stop 命令时停
  ctx.interruptSignature = plan.signature;
  ctx.sendLog('info', `[看门狗] 已启动(分辨率档=${sizeKey},检查项=[${plan.rules.map((r) => r.type).join(', ')}])`);
}

export function stopInterruptWatcher(ctx: WorkerContext): void {
  if (!ctx.interruptWatcher) return;
  ctx.interruptWatcher.stop();
  ctx.interruptWatcher = null;
  ctx.interruptSignature = null;
}
