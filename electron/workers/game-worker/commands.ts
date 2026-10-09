// parentPort 命令分发:start-task / stop / pause / resume / screenshot / screenshot-test
// 以及 bootstrap 模式的启动闸门(waitForStartCommand)
// 消息解包:Electron 32.x UtilityProcess 把父进程消息包成 MessageEvent 形状,这里统一拆开

// 注:任务级 pause/resume/stop 不再操作战斗引擎(ctx.combat 已下线),
//   统一置位 ctx 上的运行标志(ctx.skill 缺省技能 / ctx.moveAttack 挂机打怪),
//   由各自的任务循环 await 解除暂停。
import { dmApi } from '../../../core/platform/damoo/dm-api';
import { DamooVisionProvider } from '../../../core/platform/vision/damoo/DamooProvider';
import { MapCoordReader } from '../../../core/perception/MapCoordReader';
import type { MapCoordConfig } from '../../../core/perception/types';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM } from '../../../core/constant-ocr/position';
import { COLOR_WHITE } from '../../../core/constant-ocr/color';
import type { WorkerContext } from './context';
import { handleScreenshot, takeAndSendThumbnailTest } from './thumbnail';
import { stopInterruptWatcher, syncInterruptWatcher, resolveWindowSizeKey } from './interrupts';

export function registerCommandHandlers(ctx: WorkerContext): void {
  process.parentPort!.on('message', (event: any) => {
    // Electron 32.x UtilityProcess 把父进程发来的消息包成 MessageEvent 形状
    //   { data: <payload>, ports: [] }
    // 这跟 Node 标准 worker_threads.parentPort API 不一致(Node 应当 unwrap),
    // 解包一下保持正常使用
    const msg = event && typeof event === 'object' && 'data' in event && 'ports' in event ? event.data : event;
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
          // 附属配置(城镇档案/对话配方/farm 地图名)以 start-task 下发的为准,与 taskConfig 同生命周期
          if (msg.auxConfigs) {
            ctx.init.auxConfigs = msg.auxConfigs;
            ctx.sendLog(
              'info',
              `覆盖 init.auxConfigs (townProfile=${msg.auxConfigs.townProfile?.mapName ?? '无'}, recipes=${msg.auxConfigs.recipes?.length ?? 0} 条, farmMapName=${msg.auxConfigs.farmMapName ?? '无'})`,
            );
          }
          // 配置(看门狗开关)以 start-task 下发的为准:重新同步一次看门狗
          syncInterruptWatcher(ctx);
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
          stopInterruptWatcher(ctx);
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
        case 'read-position':
          handleReadPosition(ctx).catch((e) => ctx.sendLog('error', `读取坐标失败: ${e.message}`));
          break;
        case 'screenshot-test':
          takeAndSendThumbnailTest(ctx, ctx.init.hwnd).catch((e) => ctx.sendLog('error', `测试截图失败: ${e.message}`));
          break;
      }
    }
  });
}

/**
 * 'read-position' 命令:读当前窗口的地图名/坐标,一次性回传 { type:'position', hwnd, position|error }
 * 坐标 ROI/颜色用现有 constant-ocr 常量(与移动测试 testMapCoordConfig 一致,按分辨率档位取);
 * 地图名把分辨率档位传给 MapCoordReader,由它按档位取内置 MAP_NAME_ROI 常量
 */
async function handleReadPosition(ctx: WorkerContext): Promise<void> {
  const hwnd = ctx.init.hwnd;
  const report = (payload: Record<string, unknown>) => ctx.postMessage({ type: 'position', hwnd, ...payload });
  try {
    const vision = new DamooVisionProvider();
    vision.bind(hwnd);
    const size = resolveWindowSizeKey(hwnd, ctx.init.settings?.resolution);
    const coordConfig: MapCoordConfig = {
      coordRoi: DEFAULT_ROLE_POSITION[size],
      coordColor: COLOR_WHITE,
      similarity: DEFAULT_SIM,
    };
    const position = await new MapCoordReader(vision, coordConfig, size).read();
    if (!position) {
      report({ error: '坐标 OCR 失败(检查设置里的分辨率与坐标区域/颜色是否匹配)' });
      return;
    }
    report({ position });
  } catch (e: any) {
    report({ error: e.message });
  }
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
