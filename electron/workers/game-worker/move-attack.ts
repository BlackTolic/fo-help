// 移动攻击测试(screenshot-test 命令)入口
//
// 循环逻辑与「挂机打怪」任务完全共用:tasks/farm.ts 的 runFarmLoop 是唯一实现
// (路径点循环 → 到点站稳 → 扫怪/兜底点 → 释放 CD 已好的技能),
// 这里只做两件不同的事:
//   1. label 传 '移动攻击'(日志前缀 / 卡片状态文案)
//   2. 结果用 thumbnail-test 消息回报给主进程(测试按钮的提示文案),
//      而不是像任务那样把卡片状态复位成 idle

import type { WorkerContext } from './context';
import { runFarmLoop } from './tasks/farm';

export async function runMoveAttackTest(ctx: WorkerContext, hwnd: number): Promise<void> {
  const r = await runFarmLoop(ctx, hwnd, { label: '移动攻击' });
  ctx.postMessage({
    type: 'thumbnail-test',
    hwnd,
    ...(r.ok ? { info: r.detail } : { error: r.detail }),
  });
}
