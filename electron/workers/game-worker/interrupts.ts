// 弹框看门狗装配(worker 侧)
//   bootstrap 成功(大漠已绑窗)后启动,覆盖 worker 整个生命周期:
//   任务跑之前(pending 预览阶段)、任务运行中、暂停中 —— 弹框都照处理。
//   暂停时也保持运行:验证码超时会掉线,暂停 ≠ 不管号。
//   stop 命令时由 commands.ts 调 stopInterruptWatcher() 一并停掉。
//
// 新增弹框类型步骤:
//   1. core/constant-ocr/popup.ts 加识别区域常量
//   2. core/interrupt/detectors.ts / handlers.ts 加 detector/handler(或新建文件)
//   3. 在下面 buildPopupRules() 加一条 rule

import { dmApi } from '../../../core/platform/damoo/dm-api';
import { DamooInputProvider } from '../../../core/platform/input/damoo/DamooInputProvider';
import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import type { GameResolution } from '../../../shared/types';
import {
  InterruptWatcher,
  createVerifyCodeDetector,
  createTeamInviteDetector,
  createTeamInviteRejectHandler,
  createVerifyCodeHandler,
  type PopupRule,
} from '../../../core/interrupt';
import {
  DashScopeCaptchaSolver,
  StaticCaptchaSolver,
  type CaptchaSolver,
} from '../../../core/ai/captcha-solver';
import type { WorkerContext } from './context';

/**
 * 定分辨率档位(constant-ocr 常量按档位分)
 * 优先级:设置里选的档位(用户在设置面板显式指定)> hwnd 客户区实测尺寸 > '1280*800' 兜底
 * 用户在设置里指定档位是权威值:窗口客户区可能被缩放/带边框,实测尺寸未必等于坐标常量所依据的档位
 */
export function resolveWindowSizeKey(
  hwnd: number,
  preferred?: GameResolution | null,
): WindowSizeKey {
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
 * 创建验证码求解器:
 *   设置里的 dashscopeApiKey > profile.interrupt.dashscopeApiKey > 环境变量 DASHSCOPE_API_KEY
 *   > Mock(兜底点 I)
 * 没配 key 不打断流程,只是每次都走兜底策略,日志里会提示。
 */
function createSolver(ctx: WorkerContext): CaptchaSolver {
  const apiKey =
    ctx.init.settings?.dashscopeApiKey ||
    ctx.profile?.interrupt?.dashscopeApiKey ||
    process.env.DASHSCOPE_API_KEY ||
    '';
  if (!apiKey) {
    ctx.sendLog(
      'warn',
      '[弹框看门狗] 未配置大模型 API key(设置面板 / profile.interrupt.dashscopeApiKey / DASHSCOPE_API_KEY),' +
        '验证码将兜底点第一个选项',
    );
    return new StaticCaptchaSolver('I');
  }
  return new DashScopeCaptchaSolver({ apiKey });
}

/** 组装全部弹框规则(新增弹框类型在这里加) */
function buildPopupRules(ctx: WorkerContext, sizeKey: WindowSizeKey): PopupRule[] {
  const solver = createSolver(ctx);
  return [
    {
      type: 'verify-code',
      detector: createVerifyCodeDetector(sizeKey),
      handler: createVerifyCodeHandler(sizeKey, solver),
      // 验证码处理含 LLM 调用(数秒),single-flight 期间不会重复触发;
      // cooldown 兜底防处理失败后立即重试把接口打爆
      cooldownMs: 10000,
    },
    {
      type: 'team-invite',
      detector: createTeamInviteDetector(sizeKey),
      handler: createTeamInviteRejectHandler(sizeKey),
      cooldownMs: 3000,
    },
  ];
}

/**
 * 启动弹框看门狗。bootstrap 成功后调用一次,重复调用是 no-op。
 * watcher 实例挂在 ctx.interruptWatcher 上,stop 命令时停。
 */
export function startInterruptWatcher(ctx: WorkerContext): void {
  if (ctx.interruptWatcher) return;
  const hwnd = ctx.init.hwnd;
  const sizeKey = resolveWindowSizeKey(hwnd, ctx.init.settings?.resolution);

  const input = new DamooInputProvider() as any;
  input.bind(hwnd);

  const watcher = new InterruptWatcher(buildPopupRules(ctx, sizeKey), {
    input,
    intervalMs: 700,
    log: (level, msg) => ctx.sendLog(level, msg),
    onEvent: (event) => {
      // 结构化事件上报主进程(便于 UI 展示/统计);失败不阻断看门狗
      try {
        ctx.postMessage({ type: 'interrupt', event });
      } catch {
        /* noop */
      }
    },
  });
  watcher.start();
  ctx.interruptWatcher = watcher;
  ctx.sendLog('info', `[弹框看门狗] 已启动(分辨率档=${sizeKey})`);
}

export function stopInterruptWatcher(ctx: WorkerContext): void {
  if (!ctx.interruptWatcher) return;
  ctx.interruptWatcher.stop();
  ctx.interruptWatcher = null;
}
