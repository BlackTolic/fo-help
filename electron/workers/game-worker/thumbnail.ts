// 缩略图截图:正式(takeAndSendThumbnail)+ 测试(takeAndSendThumbnailTest)两路
// ⚠️ 失败语义必须保留:回传 dataUrl=null / error 的消息,不 setStatus('alert'),
//   让父进程 bootstrap/requestThumbnail 正常 resolve 而不是 reject

import { dmApi, getDamoo } from '../../../core/platform/damoo/dm-api';
import { dmErrorFull } from '../../../core/platform/damoo/dm-errors';
import { DamooVisionProvider } from '../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../core/platform/input/damoo/DamooInputProvider';
import { MapCoordReader } from '../../../core/perception/MapCoordReader';
import { MovementController, type Direction8 } from '../../../core/navigation/MovementController';
import type { MapCoordConfig, MapPosition } from '../../../core/perception/types';
import type { WorkerContext } from './context';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM } from '../../../core/constant-ocr/position';
import { COLOR_WHITE } from '../../../core/constant-ocr/color';

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

// ===== 移动测试配置 =====
// TODO: 按你的游戏实际情况填:
//   coordRoi    — 坐标文字在屏幕上的区域(大漠绑定后是窗口客户区相对坐标)
//   coordColor  — 坐标文字颜色 hex(dm 的颜色格式,如 'FFFFFF' 或 'FFFFFF-000000')
const TEST_MAP_COORD_CONFIG: MapCoordConfig = {
  coordRoi: DEFAULT_ROLE_POSITION['1280*800'], // TODO: 改成实际坐标区域
  coordColor: COLOR_WHITE, // TODO: 改成实际文字颜色
  similarity: DEFAULT_SIM,
};

/** 游戏画面中心(点击移动的基准点,1024x768 窗口即 512,384) */
const SCREEN_CENTER = { x: 512, y: 384 };
/** 每一步点击离中心多远(像素) */
const STEP_PIXELS = 200;

/** 方向 → 屏幕单位向量(x 东为正,y 南为正) */
const DIR_VECTOR: Record<Direction8, { x: number; y: number }> = {
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
};

/**
 * 测试用移动控制器:点击「画面中心 + 方向 × STEP_PIXELS」的地面来移动
 * (QQ幻想是点击地面移动的 2D 游戏;如果你的游戏操作不同,改 stepTowards 即可)
 */
class TestMovementController extends MovementController {
  protected async stepTowards(
    _current: MapPosition,
    _target: MapPosition,
    direction: Direction8,
  ): Promise<void> {
    const v = DIR_VECTOR[direction];
    const len = Math.hypot(v.x, v.y) || 1;
    const clickPos = {
      x: Math.round(SCREEN_CENTER.x + (v.x / len) * STEP_PIXELS),
      y: Math.round(SCREEN_CENTER.y + (v.y / len) * STEP_PIXELS),
    };
    await this.input.moveMouse(clickPos, { kind: 'instant' });
    await this.input.click('left');
  }
}

/** 移动测试:读当前坐标 → 向东走 20 个坐标单位 → 回报结果 */
export async function testMovement(ctx: WorkerContext, hwnd: number): Promise<void> {
  const report = (ok: boolean, detail: string) => {
    ctx.sendLog(ok ? 'info' : 'warn', `[移动测试] ${detail}`);
    ctx.postMessage({
      type: 'thumbnail-test',
      hwnd,
      ...(ok ? { info: detail } : { error: detail }),
    });
  };
  try {
    const vision = new DamooVisionProvider();
    const input = new DamooInputProvider();
    vision.bind(hwnd);
    input.bind(hwnd);

    const coordReader = new MapCoordReader(vision, TEST_MAP_COORD_CONFIG);
    const movement = new TestMovementController(input, coordReader);

    const current = await movement.readPosition();
    if (!current) {
      report(false, '读不到当前坐标(检查 TEST_MAP_COORD_CONFIG 的 coordRoi/coordColor)');
      return;
    }
    ctx.sendLog(
      'info',
      `[移动测试] 当前坐标: (${current.x}, ${current.y}) 地图=${current.map ?? '未知'}`,
    );

    const target: MapPosition = { map: current.map, x: current.x + 20, y: current.y };
    const arrived = await movement.moveTo(target, {
      arriveTolerance: 3,
      stepIntervalMs: 800,
      timeoutMs: 20000,
    });

    const after = await movement.readPosition();
    report(
      arrived,
      `目标 (${target.x}, ${target.y}) ${arrived ? '已到达' : '未到达(超时)'}，` +
        `当前 (${after ? `${after.x}, ${after.y}` : '读不到'})`,
    );
  } catch (e: any) {
    report(false, `异常: ${e.message}`);
  }
}

export async function takeAndSendThumbnailTest(ctx: WorkerContext, hwnd: number): Promise<void> {
  try {
    // ===== 移动测试:读坐标 → 向东走 20 单位 =====
    await testMovement(ctx, hwnd);

    // ===== 原截图测试(暂时注释,需要时恢复) =====
    const path = require('path');
    const fs = require('fs');
    const thumbsDir = ctx.init.thumbsDir;
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
    const ts = Date.now();
    const filePath = path.join(thumbsDir, `test-${hwnd}-${ts}.png`);
    const ret = dmApi.capture(1167, 39, 1218, 56, filePath);
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
