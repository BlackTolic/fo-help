// 弹框中断处理框架:类型定义
//
// 核心思路(与 ffo-auto-tool 的 rolyer.ts 单轮询内联处理不同):
//   InterruptWatcher 是独立的并发看门狗循环,与任务主循环(farm 等)在同进程
//   事件循环上交错执行 —— 检测到弹框后 handler 异步执行(如 LLM 验证码要几秒),
//   期间任务主循环照常跑,实现"验证过程中自动打怪继续"。
//
// 扩展方式:新增一种弹框 = 实现 PopupDetector + PopupHandler,
//   在 worker 装配处(electron/workers/game-worker/interrupts.ts)注册一条 rule。

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { Point } from '../platform/vision/IVisionProvider';

/** 一次弹框检测结果 */
export interface PopupMatch {
  /** 弹框类型标识(如 'verify-code' / 'team-invite'),与 rule.type 一致 */
  type: string;
  /** 锚点屏幕坐标(弹框标题/特征文字的命中位置),handler 以此算相对位置 */
  anchor: Point;
}

/** 弹框检测器:同步调用大漠,快(单次数十 ms),返回 null = 没弹框 */
export interface PopupDetector {
  detect(): PopupMatch | null;
}

/** handler 执行时可用的依赖 */
export interface PopupHandlerContext {
  input: IInputProvider;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/** 弹框处理器:可异步(网络请求等),执行期间任务主循环继续 */
export interface PopupHandler {
  handle(match: PopupMatch, ctx: PopupHandlerContext): Promise<void>;
}

/** 一条完整的弹框处理规则 = 检测器 + 处理器 + 节流参数 */
export interface PopupRule {
  type: string;
  detector: PopupDetector;
  handler: PopupHandler;
  /** 同一类型两次触发处理的最小间隔(毫秒,默认 5000):防止弹框未消失时重复处理 */
  cooldownMs?: number;
}

/** watcher 对外的日志/事件回调 */
export interface InterruptWatcherCallbacks {
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** 检测/处理完成/失败时上报(用于 UI 展示与排查) */
  onEvent?: (event: {
    kind: 'detected' | 'handled' | 'failed';
    type: string;
    detail: string;
  }) => void;
}

export interface InterruptWatcherOptions extends InterruptWatcherCallbacks {
  input: IInputProvider;
  /** 轮询间隔(毫秒,默认 700) */
  intervalMs?: number;
}
