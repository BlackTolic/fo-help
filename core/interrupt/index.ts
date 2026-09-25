// 弹框中断处理框架入口
// 用法(worker 侧装配见 electron/workers/game-worker/interrupts.ts):
//   const watcher = new InterruptWatcher(
//     [
//       { type: 'verify-code', detector, handler, cooldownMs: 8000 },
//       { type: 'team-invite', detector, handler, cooldownMs: 3000 },
//     ],
//     { input, intervalMs: 700, log, onEvent },
//   );
//   watcher.start();  // 并发看门狗,与任务主循环互不阻塞

export * from './types';
export { InterruptWatcher } from './InterruptWatcher';
export { createVerifyCodeDetector, createTeamInviteDetector } from './detectors';
export { createTeamInviteRejectHandler, createVerifyCodeHandler } from './handlers';
