// 缩略图截图:正式(takeAndSendThumbnail)+ 测试(takeAndSendThumbnailTest)两路
// ⚠️ 失败语义必须保留:回传 dataUrl=null / error 的消息,不 setStatus('alert'),
//   让父进程 bootstrap/requestThumbnail 正常 resolve 而不是 reject

import { dmApi, getDamoo } from '../../../core/platform/damoo/dm-api';
import { dmErrorFull } from '../../../core/platform/damoo/dm-errors';
import type { WorkerContext } from './context';

export async function takeAndSendThumbnail(ctx: WorkerContext, hwnd: number): Promise<boolean> {
  // 截图失败不阻断流程:回传 dataUrl=null 的 thumbnail 消息,
  // 让父进程 bootstrap/requestThumbnail 正常 resolve,而不是 setStatus('alert') 导致 reject
  const notifyFailure = (detail: string): void => {
    ctx.sendLog('error', detail);
    ctx.postMessage({ type: 'thumbnail', hwnd, dataUrl: null, error: detail });
  };
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = ctx.init.thumbsDir || path.join(require('os').tmpdir(), 'fo-help-thumbnails');
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const filePath = path.join(thumbsDir, `${hwnd}.png`);
    // dmApi.capture 也是同步原生调用,加了步骤标记方便 hang 定位
    ctx.stepStart(`capture(hwnd=${hwnd})`);
    const ret = dmApi.capture(0, 0, 192, 108, filePath);
    ctx.stepEnd('capture', ret === 1, `ret=${ret}`);
    if (ret !== 1) {
      const code = dmApi.getLastError();
      const { message, advice } = dmErrorFull(code);
      // code=0 时大漠自身无错误码,最常见原因是窗口大部分位于屏幕外/被遮挡:
      // dx.graphic.2d 靠 hook D3D 渲染取图,屏幕外区域不渲染,Capture 返回 0
      const extra = code === 0 ? ' | 建议:将当前游戏模式设置为软件模式' : '';
      notifyFailure(
        `截图失败: dmApi.capture 返回 ${ret}, code=${code} ${message}${advice ? ' | 建议:' + advice : ''}${extra}`,
      );
      return false;
    }
    if (!fs.existsSync(filePath)) {
      notifyFailure(`截图失败: dmApi.capture 返回 1 但文件未生成 (${filePath})`);
      return false;
    }
    const stat = fs.statSync(filePath);
    ctx.postMessage({
      type: 'thumbnail',
      hwnd,
      dataUrl: `thumb://image/${hwnd}`,
      filePath,
      size: stat.size,
    });
    ctx.sendLog('info', `缩略图已写入 (${(stat.size / 1024).toFixed(0)}KB) → ${filePath}`);
    return true;
  } catch (e: any) {
    notifyFailure(`截图异常: ${e.message}`);
    return false;
  }
}

export async function takeAndSendThumbnailTest(ctx: WorkerContext, hwnd: number): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = ctx.init.thumbsDir;
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const ts = Date.now();
    const filePath = path.join(thumbsDir, `test-${hwnd}-${ts}.png`);
    const ret = dmApi.capture(0, 0, 100, 100, filePath);
    dmApi.getFullScreenData(path.join(thumbsDir, `testscreen-${hwnd}-${ts}.png`));
    if (ret !== 1) {
      ctx.sendLog('warn', `测试截图 Capture 返回 ${ret}`);
      ctx.postMessage({
        type: 'thumbnail-test',
        hwnd,
        error: `Capture 返回 ${ret}`,
      });
      return;
    }
    if (!fs.existsSync(filePath)) {
      ctx.postMessage({ type: 'thumbnail-test', hwnd, error: '文件未生成' });
      return;
    }
    const stat = fs.statSync(filePath);
    ctx.postMessage({ type: 'thumbnail-test', hwnd, filePath, size: stat.size });
    ctx.sendLog('info', `测试截图已写入 (${(stat.size / 1024).toFixed(0)}KB) → ${filePath}`);
  } catch (e: any) {
    ctx.postMessage({ type: 'thumbnail-test', hwnd: ctx.init.hwnd, error: e.message });
    ctx.sendLog('warn', `测试截图失败: ${e.message}`);
  }
}

export async function handleScreenshot(ctx: WorkerContext): Promise<void> {
  if (!ctx.dm) {
    try {
      ctx.dm = getDamoo();
    } catch {
      /* noop */
    }
  }
  if (ctx.dm) {
    await takeAndSendThumbnail(ctx, ctx.init.hwnd);
  } else {
    ctx.sendLog('warn', '截图失败:大漠未加载');
  }
}
