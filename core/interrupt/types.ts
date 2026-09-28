// 中断处理框架:类型定义
//
// 核心思路(与 ffo-auto-tool 的 rolyer.ts 单轮询内联处理不同):
//   InterruptWatcher 是独立的并发看门狗循环,与任务主循环(farm 等)在同进程
//   事件循环上交错执行 —— 检测命中后 handler 异步执行(如 LLM 验证码要几秒),
//   期间任务主循环照常跑,实现"验证过程中自动打怪继续"。
//
// 检查项不限于弹框:detector 命中后返回一个 PopupMatch(锚点只作 handler 的参考),
//   handler 决定做什么(点弹框选项 / 按快捷键用药 / 停止打怪)。
//
// 扩展方式:新增一种检查项 = 实现 PopupDetector + PopupHandler,
//   在 worker 装配处(electron/workers/game-worker/interrupts.ts)注册一条 rule。

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { Point } from '../platform/vision/IVisionProvider';

/** 一次检测命中结果 */
export interface PopupMatch {
  /** 检查项类型标识(如 'verify-code' / 'team-invite' / 'heal' / 'stop-level-up'),与 rule.type 一致 */
  type: string;
  /** 锚点屏幕坐标(弹框标题/特征区域的位置),handler 以此算相对位置 */
  anchor: Point;
}

/**
 * 弹框检测器:同步调用大漠,快(单次数十 ms)。
 * 每次轮询调用一次,返回 null = 本次没有可处理的弹框
 * (可能是真没弹框,也可能是弹框还在动、检测器在等它稳定,见 createVerifyCodeDetector)。
 * 需要跨轮询记住状态的检测器把状态存在自己的闭包里 —— 每个检测器实例只有一个调用方(看门狗)。
 */
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
  /**
   * 检测/处理完成/失败时上报(用于 UI 展示与排查)
   * 字段名与 shared/types.ts 的 InterruptEvent 对齐(popupType = 检查项类型)
   */
  onEvent?: (event: {
    kind: 'detected' | 'handled' | 'failed';
    popupType: string;
    detail: string;
  }) => void;
}

export interface InterruptWatcherOptions extends InterruptWatcherCallbacks {
  input: IInputProvider;
  /** 轮询间隔(毫秒,默认 700) */
  intervalMs?: number;
}
