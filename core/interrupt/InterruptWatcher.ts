// InterruptWatcher: 弹框看门狗
//   独立异步轮询循环,与任务主循环并发(事件循环交错),不打断打怪/任务
//
// 并发模型说明:
//   - 检测(detector.detect)是同步大漠调用,与任务循环天然互斥(单线程),安全
//   - 处理(handler.handle)是异步的,执行期间任务循环继续跑 —— 这正是
//     "验证码 LLM 验证期间自动打怪继续"的实现方式
//   - 同类型弹框 single-flight:上一个 handler 没跑完时不再触发,防止验证码重复提交
//   - cooldown:handler 跑完后弹框若仍未消失(处理失败),间隔期内不再触发
//
// 已知边界(与参考工程行为一致,属可接受范围):
//   弹框处理器的点击与任务循环的施法点击共享同一鼠标,极端情况下一次点击
//   可能落在弹框上。要避免需引入"输入互斥 + 任务让位",会牺牲"打怪不中断",
//   当前按需求优先保证打怪继续。

import type { PopupHandlerContext, PopupRule, InterruptWatcherOptions } from './types';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class InterruptWatcher {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly rules: PopupRule[];
  private readonly opts: InterruptWatcherOptions;
  /** 各类型上次触发时间戳(冷却计时) */
  private lastTrigger = new Map<string, number>();
  /** 正在处理中的类型(single-flight) */
  private inflight = new Set<string>();

  constructor(rules: PopupRule[], opts: InterruptWatcherOptions) {
    this.rules = rules;
    this.opts = opts;
  }

  /** 启动看门狗(不阻塞调用方,内部自旋) */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.opts.log?.(
      'info',
      `[弹框看门狗] 启动,检测类型=[${this.rules.map((r) => r.type).join(', ')}] 轮询=${this.opts.intervalMs ?? 700}ms`,
    );
    const loop = async () => {
      while (this.running) {
        try {
          this.pollOnce();
        } catch (e: any) {
          // 单个检测器抛错不能打死看门狗
          this.opts.log?.('warn', `[弹框看门狗] 轮询异常: ${e?.message || e}`);
        }
        await sleep(this.opts.intervalMs ?? 700);
      }
    };
    // fire-and-forget:看门狗生命周期独立于任务循环
    loop().catch((e) => this.opts.log?.('error', `[弹框看门狗] 循环退出: ${e?.message || e}`));
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.opts.log?.('info', '[弹框看门狗] 已停止');
  }

  isRunning(): boolean {
    return this.running;
  }

  // 轮询一次,检测所有弹框
  // 每个弹框检测器独立运行,互不干扰
  private pollOnce(): void {
    const now = Date.now();
    for (const rule of this.rules) {
      // 验证码弹框单类型,不支持并发处理
      if (this.inflight.has(rule.type)) continue;
      // 单类型弹框 single-flight:上一个 handler 没跑完时不再触发
      const cooldown = rule.cooldownMs ?? 5000;
      const last = this.lastTrigger.get(rule.type) || 0;
      // 冷却期未到,不触发
      if (now - last < cooldown) continue;
      let match;
      try {
        match = rule.detector.detect();
      } catch (e: any) {
        this.opts.log?.('warn', `[弹框看门狗] 检测器 ${rule.type} 异常: ${e?.message || e}`);
        continue;
      }
      if (!match) continue;

      this.lastTrigger.set(rule.type, now);
      this.inflight.add(rule.type);
      // 上报事件
      this.opts.onEvent?.({
        kind: 'detected',
        type: rule.type,
        detail: `anchor=(${match.anchor.x}, ${match.anchor.y})`,
      });
      this.opts.log?.(
        'info',
        `[弹框看门狗] 检测到弹框: ${rule.type} @(${match.anchor.x}, ${match.anchor.y})`,
      );

      const handlerCtx: PopupHandlerContext = {
        input: this.opts.input,
        log: (level, msg) => this.opts.log?.(level, `[${rule.type}] ${msg}`),
      };
      Promise.resolve()
        .then(() => rule.handler.handle(match, handlerCtx))
        .then(() => {
          this.opts.onEvent?.({ kind: 'handled', type: rule.type, detail: '处理完成' });
        })
        .catch((e: any) => {
          const detail = e?.message || String(e);
          this.opts.onEvent?.({ kind: 'failed', type: rule.type, detail });
          this.opts.log?.('warn', `[弹框看门狗] ${rule.type} 处理失败: ${detail}`);
        })
        .finally(() => {
          this.inflight.delete(rule.type);
        });
    }
  }
}
