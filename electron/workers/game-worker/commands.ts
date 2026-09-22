// parentPort 命令分发:start-task / stop / pause / resume / screenshot / screenshot-test
// 以及 bootstrap 模式的启动闸门(waitForStartCommand)
// 消息解包:Electron 32.x UtilityProcess 把父进程消息包成 MessageEvent 形状,这里统一拆开

// 注:任务级 pause/resume/stop 不再操作战斗引擎(ctx.combat 已下线),
//   统一置位 ctx 上的运行标志(ctx.skill 缺省技能 / ctx.moveAttack 挂机打怪),
//   由各自的任务循环 await 解除暂停。
import { dmApi } from '../../../core/platform/damoo/dm-api';
import type { WorkerContext } from './context';
import { handleScreenshot, takeAndSendThumbnailTest } from './thumbnail';

export function registerCommandHandlers(ctx: WorkerContext): void {
  process.parentPort!.on('message', (event: any) => {
    // Electron 32.x UtilityProcess 把父进程发来的消息包成 MessageEvent 形状
    //   { data: <payload>, ports: [] }
    // 这跟 Node 标准 worker_threads.parentPort API 不一致(Node 应当 unwrap),
    // 解包一下保持正常使用
    const msg =
      event && typeof event === 'object' && 'data' in event && 'ports' in event
        ? event.data
        : event;
    if (msg?.type === 'command') {
      switch (msg.command) {
        case 'start-task':
          ctx.sendLog('info', `收到 start-task (taskType=${msg.taskType || '(未指定)'})`);
          // 覆盖 init 的 taskType + taskConfig — bootstrap 阶段 init.taskType 是 'farm' 兜底默认,
          //   真正任务类型由 dialog 保存后才确定,通过 start-task 命令告诉 worker
          if (msg.taskType) {
            ctx.init.taskType = msg.taskType;
            ctx.sendLog('info', `覆盖 init.taskType = ${ctx.init.taskType}`);
          }
          if (msg.taskConfig) {
            ctx.init.taskConfig = msg.taskConfig;
            ctx.sendLog('info', `覆盖 init.taskConfig = type=${ctx.init.taskConfig?.type}`);
          }
          if (ctx.startResolve) {
            // 正常路径: startResolve 已注册, 直接 resolve 让 main() 走完
            ctx.startResolve();
          } else if (ctx.waitForConfig) {
            // Race-condition: startResolve 还没注册, 暂存让 main() 创建 Promise 时自检
            ctx.pendingStart = true;
            ctx.sendLog('warn', 'start-task 在 _waitForConfig 早期到达, 暂存到 _pendingStart');
          } else {
            ctx.sendLog('warn', '收到 start-task,但 worker 未在等待状态(可能已启动)');
          }
          break;
        case 'stop':
          ctx.sendLog('info', '收到 stop');
          ctx.running = false;
          if (ctx.startResolve) {
            ctx.startResolve();
            ctx.startResolve = null;
          }
          // 缺省技能:让按键循环跳出(顺便解除暂停,避免卡在 await Promise)
          ctx.skill.running = false;
          ctx.skill.paused = false;
          if (ctx.skill.resumeResolve) {
            ctx.skill.resumeResolve();
            ctx.skill.resumeResolve = null;
          }
          // 移动攻击任务(farm 用):同样跳出循环 + 解除暂停
          ctx.moveAttack.running = false;
          ctx.moveAttack.paused = false;
          if (ctx.moveAttack.resumeResolve) {
            ctx.moveAttack.resumeResolve();
            ctx.moveAttack.resumeResolve = null;
          }
          // utilityProcess 子进程:dm.dll 进程级副作用不影响其他子进程
          //   每个子进程独立加载 dm.dll,UnBindWindow 只影响自己
          try {
            dmApi.unbindWindow();
            ctx.sendLog('info', '已 UnBindWindow');
          } catch (e: any) {
            ctx.sendLog('warn', `UnBindWindow 失败: ${e.message}`);
          }
          ctx.setStatus('idle', '已停止');
          // 给 in-flight 的 dm 调用留 300ms 完成
          setTimeout(() => process.exit(0), 300);
          break;
        case 'pause':
          ctx.sendLog('info', '收到 pause');
          if (ctx.startResolve) {
            ctx.startResolve();
            ctx.startResolve = null;
          }
          // 缺省技能:仅置位 paused,按键循环内部 await Promise 阻塞
          if (ctx.init.taskType === 'default-skill') {
            ctx.skill.paused = true;
          }
          // 移动攻击任务(farm 用):同样仅置位 paused,主循环内部 await Promise 阻塞
          ctx.moveAttack.paused = true;
          ctx.setStatus('paused', '用户暂停');
          break;
        case 'resume':
          ctx.sendLog('info', '收到 resume');
          // 缺省技能:清 paused + resolve 暂停 Promise
          if (ctx.init.taskType === 'default-skill') {
            ctx.skill.paused = false;
            if (ctx.skill.resumeResolve) {
              ctx.skill.resumeResolve();
              ctx.skill.resumeResolve = null;
            }
          }
          // 移动攻击任务(farm 用):同样清 paused + resolve
          ctx.moveAttack.paused = false;
          if (ctx.moveAttack.resumeResolve) {
            ctx.moveAttack.resumeResolve();
            ctx.moveAttack.resumeResolve = null;
          }
          break;
        case 'screenshot':
          handleScreenshot(ctx).catch((e) => ctx.sendLog('error', `截图失败: ${e.message}`));
          break;
        case 'screenshot-test':
          takeAndSendThumbnailTest(ctx, ctx.init.hwnd).catch((e) =>
            ctx.sendLog('error', `测试截图失败: ${e.message}`),
          );
          break;
      }
    }
  });
}

/**
 * bootstrap 模式(waitForConfig=true)的启动闸门:停在 'pending' 状态等 start-task
 * Race-condition 兜底:start-task 可能先于 startResolve 注册到达,
 * 由 pendingStart 暂存,下面 Promise executor 注册时自检补回
 */
export async function waitForStartCommand(ctx: WorkerContext): Promise<void> {
  if (!ctx.waitForConfig) return;
  ctx.sendLog('info', 'bootstrap 模式:等待 start-task 命令...');
  ctx.setStatus('pending', '等待启动');
  await new Promise<void>((resolve) => {
    ctx.startResolve = resolve;
    // Race-condition 自检: start-task 可能在 startResolve 注册前就到了
    if (ctx.pendingStart) {
      ctx.pendingStart = false;
      ctx.sendLog('info', '从 _pendingStart 取出暂存的 start-task,立即放行');
      resolve();
    }
  });
  ctx.startResolve = null;
  ctx.pendingStart = false;
  ctx.sendLog('info', '收到 start-task,开始执行任务');
}
