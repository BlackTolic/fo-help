// MovementController: 根据地图坐标控制角色移动
//
// 输入:目标 MapPosition(来自任务配置,如"跑到 (350, 420) 交任务")
// 原理:循环「读当前坐标 → 和目标比较 → 走一小步」,直到到达;
//      若坐标长时间(默认 3 分钟)没有变化则视为卡住,退出返回 false。
//
// "走一小步"的具体操作因游戏而异,集中在 stepTowards() 里实现:
//   - 点击大地图/小地图上的目标点(需要 地图坐标 → 屏幕坐标 的换算,配 mapCalibration)
//   - 或直接点地面朝目标方向移动
//   - 或调用游戏内自动寻路(如果有)
//
// 坐标系假设:x 向东递增,y 向南递增(2D 游戏惯例;不对就改 directionTo)

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { MapCoordReader } from '../perception/MapCoordReader';
import type { MapPosition } from '../perception/types';
import { createLogger } from '../logger';

const log = createLogger('navigation.movement');

/** 八方向(directionTo 的返回值) */
export type Direction8 = 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE';

export interface MoveOptions {
  /** 到达判定:与目标的曼哈顿距离 ≤ 该值视为到达(坐标单位) */
  arriveTolerance?: number;
  /** 每走一步后等多久再读坐标(ms) */
  stepIntervalMs?: number;
  /** 多久没移动就放弃(ms),默认 3 分钟:坐标一直无变化视为卡住 */
  noMoveTimeoutMs?: number;
  /** 移动判定阈值:两次读坐标距离 > 该值才算"在移动"(防止坐标抖动不断重置计时) */
  moveEpsilon?: number;
}

export class MovementController {
  constructor(
    protected input: IInputProvider,
    private coords: MapCoordReader,
  ) {}

  /** 读当前坐标(MapCoordReader 的透传,方便上层只依赖本类) */
  async readPosition(): Promise<MapPosition | null> {
    return this.coords.read();
  }

  /** 到目标的坐标差 */
  deltaTo(from: MapPosition, to: MapPosition): { dx: number; dy: number; dist: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return { dx, dy, dist: Math.hypot(dx, dy) };
  }

  /** 坐标差 → 八方向(纯函数,便于单测) */
  directionTo(from: MapPosition, to: MapPosition): Direction8 {
    // atan2 角度:0=东,逆时针为负;屏幕/地图 y 轴向南,所以直接用 dy
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    const dirs: Direction8[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    const idx = Math.round(((angle % 360) + 360) % 360 / 45) % 8;
    return dirs[idx];
  }

  /**
   * 移动到目标坐标
   * @returns true=到达,false=卡住(超过 noMoveTimeoutMs 坐标无变化)/读不到坐标/跨地图
   */
  async moveTo(target: MapPosition, opts?: MoveOptions): Promise<boolean> {
    const arriveTolerance = opts?.arriveTolerance ?? 5;
    const stepIntervalMs = opts?.stepIntervalMs ?? 500;
    const noMoveTimeoutMs = opts?.noMoveTimeoutMs ?? 3 * 60 * 1000;
    const moveEpsilon = opts?.moveEpsilon ?? 1;
    let lastPos: MapPosition | null = null;
    let lastMovedAt = Date.now();

    while (true) {
      const current = await this.readPosition();
      if (!current) {
        log.warn('读不到当前坐标,原地等待重试');
        await sleep(stepIntervalMs);
      } else {
        // 跨地图:坐标没有可比性,由上层(任务流程)处理传送/过图
        if (current.map !== null && target.map !== null && current.map !== target.map) {
          log.warn(`当前在「${current.map}」,目标在「${target.map}」,需要先过图`);
          return false;
        }

        const { dist } = this.deltaTo(current, target);
        if (dist <= arriveTolerance) {
          log.info(`已到达 (${target.x}, ${target.y})`);
          return true;
        }

        // 坐标有明显变化 → 认为还在移动,重置「没移动」计时
        if (!lastPos || this.deltaTo(lastPos, current).dist > moveEpsilon) {
          lastPos = current;
          lastMovedAt = Date.now();
        }

        const dir = this.directionTo(current, target);
        log.debug(`移动中: (${current.x},${current.y}) → (${target.x},${target.y}) 方向=${dir} 距离=${dist.toFixed(1)}`);
        // 这里可以设计两种移动方式:
        // 1. 点击目标点(需要 地图坐标 → 屏幕坐标 的换算,配 mapCalibration)
        // 2. 直接点地面朝目标方向移动
        await this.stepTowards(current, target, dir);
        await sleep(stepIntervalMs);
      }

      // 退出判断:坐标超过 noMoveTimeoutMs 没有变化,视为卡住
      if (Date.now() - lastMovedAt >= noMoveTimeoutMs) {
        log.warn(`移动到 (${target.x}, ${target.y}) 失败:${Math.round(noMoveTimeoutMs / 60000)} 分钟没有移动`);
        return false;
      }
    }
  }

  /**
   * 朝目标走一小步(每个游戏操作不同,在这里实现)
   * TODO: 用 this.input 实现,例如:
   *   - input.moveMouse(目标在屏幕上的位置) + input.click('left')
   *   - 或按方向键:keyDown → holdMs → keyUp
   */
  protected async stepTowards(
    current: MapPosition,
    target: MapPosition,
    direction: Direction8,
  ): Promise<void> {
    void this.input;
    log.debug('MovementController.stepTowards 待实现');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 移动方式一：通过点击八个方向进行移动
 * 测试用移动控制器:点击「画面中心 + 方向 × STEP_PIXELS」的地面来移动
 * (QQ幻想是点击地面移动的 2D 游戏;如果你的游戏操作不同,改 stepTowards 即可)\
 */
/** 游戏画面中心(点击移动的基准点,1024x768 窗口即 512,384) */
const SCREEN_CENTER = { x: 512, y: 384 };
/** 每一步点击离中心多远(像素) */
const STEP_PIXELS = 300;

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

// 通过点击八个方向进行移动的控制器实现
export class MovementControllerByDirection8 extends MovementController {
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
    await this.input.delay(300);
    await this.input.click('left');
  }
}