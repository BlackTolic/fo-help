// 等 Vite dev server 就绪(替代 wait-on)
//
// wait-on 每次要花 ~2s:裸启动 node 1.2s + 默认 750ms "资源必须持续可用" 窗口,
// 而这里只需要一个 fetch 轮询,单次 ~100ms。
//
// 用法: node scripts/wait-for-dev-server.mjs [url] [timeoutMs]

const url = process.argv[2] || 'http://127.0.0.1:5174';
const timeoutMs = Number(process.argv[3]) || 30000;
const POLL_MS = 100;

const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

while (true) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`[wait] ${url} 就绪 (${Date.now() - startedAt}ms)`);
      process.exit(0);
    }
    // 端口有人监听但返回非 2xx(Vite 启动失败页)→ 继续轮询直到超时
  } catch {
    // 还没起来,忽略
  }

  if (Date.now() - startedAt > timeoutMs) {
    console.error(`[wait] 超时 ${timeoutMs}ms:${url} 仍未就绪`);
    process.exit(1);
  }
  await sleep(POLL_MS);
}
