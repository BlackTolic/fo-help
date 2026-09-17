// Race-condition 探测脚本:
// 模拟"点启动"快过 bootstrap 完成的事件序列 — 在 spawn 完 utility process 后
// 同步立刻发出 start-task,看 worker 是真的进战斗还是卡 warn/pending。

const { app, utilityProcess } = require('electron');
const path = require('path');

const WORKER_PATH = path.resolve(
  __dirname,
  '..',
  'dist-electron',
  'electron',
  'workers',
  'game-utility-worker.js',
);

console.log('[TEST] app.ready, worker path =', WORKER_PATH);

app.whenReady().then(() => {
  const initData = JSON.stringify({
    hwnd: 999999,
    characterName: 'race-probe',
    taskType: 'farm',
    profile: null,
    taskConfig: null,
    waitForConfig: true,
    thumbsDir: path.resolve(__dirname, '..', 'thumbnails'),
  });

  const worker = utilityProcess.fork(WORKER_PATH, [initData], {
    serviceName: 'race-probe',
    stdio: 'pipe',
  });

  const receivedStates = [];
  const receivedLogs = [];

  worker.stdout?.on('data', (b) => process.stdout.write('[WORKER-OUT] ' + b.toString()));
  worker.stderr?.on('data', (b) => process.stdout.write('[WORKER-ERR] ' + b.toString()));

  worker.on('message', (event) => {
    const msg =
      event && typeof event === 'object' && 'data' in event && 'ports' in event
        ? event.data
        : event;
    console.log('[RECV]', JSON.stringify(msg).slice(0, 300));
    if (msg.type === 'state') receivedStates.push(msg.state);
    if (msg.type === 'log') receivedLogs.push(msg);
  });

  worker.on('spawn', () => {
    console.log('[TEST] utilityProcess spawned pid=' + worker.pid + ', RACING now...');
    // 关键:spawn 后用 setImmediate (下一个事件循环 tick) 立刻发 start-task,
    // 比 main() 里 reach await Promise 几乎一定要快(后者要走 dm getVer+bindWindow+OCR)
    setImmediate(() => {
      console.log('[TEST] >>> posting start-task at tick=' + Date.now());
      worker.postMessage({ type: 'command', command: 'start-task' });
    });
  });

  worker.on('exit', (code) => {
    console.log('[TEST] worker exited code=' + code);
    printVerdict(receivedStates, receivedLogs, false);
    app.exit(code ?? 0);
  });

  // 兜底:15s 后强制结束 + 评估
  setTimeout(() => {
    console.log('[TEST] 15s timeout reached, killing worker');
    try {
      worker.kill();
    } catch (_) {}
    setTimeout(() => app.exit(1), 1000);
  }, 15000);

  setTimeout(() => {
    printVerdict(receivedStates, receivedLogs, true);
  }, 14500);
});

function printVerdict(states, logs, forced) {
  const lastState = states[states.length - 1];
  const lastLog = logs[logs.length - 1];
  console.log('---');
  console.log('[VERDICT] forced=' + forced);
  console.log(
    '[VERDICT] total state msgs:',
    states.length,
    '— sequence:',
    states.map((s) => s.state?.status || s.status).join(' → '),
  );
  console.log('[VERDICT] last state:', JSON.stringify(lastState?.state || lastState));
  console.log('[VERDICT] last log:', lastLog?.msg);
  const isPending = lastState?.state?.status === 'pending' || lastState?.status === 'pending';
  const isMoving =
    lastState?.state?.status === 'moving' ||
    lastState?.state?.status === 'combat' ||
    lastState?.status === 'moving' ||
    lastState?.status === 'combat';
  if (isMoving) {
    console.log('[VERDICT] ✅ 进了战斗循环 — race 不可达 OR unwrap 后 _startResolve 已注册');
  } else if (isPending) {
    console.log('[VERDICT] ❌ 卡 pending — race-condition 触发,start-task 已被丢,UI 会卡住');
  } else {
    console.log('[VERDICT] ⚠️ 状态未明,看日志');
  }
}
