// MovementController: 根据地图坐标控制角色移动
//
// 输入:目标 MapPosition(来自任务配置,如"跑到 (350, 420) 交任务")
// 原理:循环「读当前坐标 → 和目标比较 → 走一小步」,直到到达或超时。
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
  /** 整体超时(ms),超时返回 false */
  timeoutMs?: number;
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
   * @returns true=到达,false=超时/读不到坐标
   */
  async moveTo(target: MapPosition, opts?: MoveOptions): Promise<boolean> {
    const arriveTolerance = opts?.arriveTolerance ?? 5;
    const stepIntervalMs = opts?.stepIntervalMs ?? 500;
    const deadline = Date.now() + (opts?.timeoutMs ?? 60000);

    while (Date.now() < deadline) {
      const current = await this.readPosition();
      if (!current) {
        log.warn('读不到当前坐标,原地等待重试');
        await sleep(stepIntervalMs);
        continue;
      }
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

      const dir = this.directionTo(current, target);
      log.debug(`移动中: (${current.x},${current.y}) → (${target.x},${target.y}) 方向=${dir} 距离=${dist.toFixed(1)}`);
      await this.stepTowards(current, target, dir);
      await sleep(stepIntervalMs);
    }

    log.warn(`移动到 (${target.x}, ${target.y}) 超时`);
    return false;
  }

  /**
   * 朝目标走一小步(每个游戏操作不同,在这里实现)
   * TODO: 用 this.input 实现,例如:
   *   - input.moveMouse(目标在屏幕上的位置) + input.click('left')
   *   - 或按方向键:keyDown → holdMs → keyUp
   */
  protected async stepTowards(
    _current: MapPosition,
    _target: MapPosition,
    _direction: Direction8,
  ): Promise<void> {
    void this.input;
    log.debug('MovementController.stepTowards 待实现');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
