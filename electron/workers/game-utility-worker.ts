// game-utility-worker.ts: utilityProcess 子进程入口
//
// ⚠️ 为什么用 utilityProcess 而不是 worker_threads?
//   dm.dll v7.2543 是 in-process COM dll,内部维护进程级:
//     - 全局绑定表(最近一次 BindWindow 的窗口)
//     - Win32 低级鼠标/键盘 hook(user32.dll 维护,跨线程共享)
//   多 worker_threads 在同一进程内同时绑多个窗口会:
//     - 互相踩 hook → 鼠标/键盘操作不生效 / 段错误 → 主进程闪退
//     - "上次未正常解绑"标记污染下次 BindWindow → code=-16
//   utilityProcess 是独立 OS 进程,每个子进程有自己的 dm.dll 实例,
//   完全隔离,真正支持多窗口多开
//
// 通信协议与 game-worker.ts 完全一致(parentPort.on/postMessage),
// init data 通过 process.argv 传入(JSON 字符串)
//
// 模块拆分(纯结构重构,行为不变):
//   game-worker/context.ts    共享上下文:init 数据、运行期状态、sendLog/setStatus/stepStart/stepEnd
//   game-worker/bootstrap.ts  启动流程:大漠加载 → 绑窗 → 字库 → OCR → 缩略图 → 组装战斗引擎
//   game-worker/commands.ts   parentPort 命令分发(start-task/stop/pause/resume/screenshot/-test)
//   game-worker/thumbnail.ts  缩略图截图(正式 + 测试两路)
//   game-worker/tasks/        任务注册表(taskType → TaskController),新增任务 = 加文件 + 注册一行

import { WorkerContext } from './game-worker/context';
import { bootstrap } from './game-worker/bootstrap';
import { registerCommandHandlers, waitForStartCommand } from './game-worker/commands';
import { runTask } from './game-worker/tasks';

// 构造上下文:写 [DEBUG] 启动标记 → 校验 parentPort → 注册兜底异常处理 → 解析 init
const ctx = new WorkerContext();

async function main(): Promise<void> {
  // bootstrap 失败(大漠未加载 / 绑定失败)时已 setStatus('alert'),直接结束
  if (!(await bootstrap(ctx))) return;
  await waitForStartCommand(ctx);
  await runTask(ctx);
  ctx.sendLog('info', 'UtilityWorker 主循环结束');
}

// 先注册命令监听,再启动 main(),最后发 ready —— 顺序与重构前一致
registerCommandHandlers(ctx);

main().catch((e) => {
  ctx.sendLog('error', `UtilityWorker 异常: ${e.message}`);
  ctx.setStatus('alert', e.message);
});

// 子进程初始化完成,发 'ready' 信号给父进程,告诉它 message listener 已注册
// ⚠️ 必须在顶层代码末尾立即发(不等 main() 完成!)
//   之前用 main().then(() => postMessage 'ready') 是 bug:
//   main() 是 async 且永不 resolve(战斗循环常驻),ready 信号永远不发 → startTask 一直超时
//   修复:在顶层代码末尾,所有 listener 注册后,立即 postMessage 'ready'
try {
  process.stderr.write(
    `[READY-DEBUG] 即将发 ready 信号, init.hwnd=${ctx.init?.hwnd}, process.argv.length=${process.argv.length}, process.argv[last]=${process.argv[process.argv.length - 1]?.slice(0, 100)}\n`,
  );
} catch {}
try {
  process.parentPort!.postMessage({ type: 'ready', hwnd: ctx.init.hwnd });
  try {
    process.stderr.write(`[READY-DEBUG] ✓ ready 信号 postMessage 成功\n`);
  } catch {}
} catch (e: any) {
  try {
    process.stderr.write(`[READY-DEBUG] ✗ ready 信号 postMessage 失败: ${e.message}\n`);
  } catch {}
}
