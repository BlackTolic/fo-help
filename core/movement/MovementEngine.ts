// MovementEngine: QQ幻想 2.5D 移动
// 关键:点地面 = 寻路走过去(由游戏自己算路径)

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { WorldPoint, CoordinateReader } from '../state/CoordinateReader';

export interface ArriveOpts {
  /** 距离阈值(像素),小于此值视为到达 */
  threshold: number;
  /** 总超时(ms) */
  timeoutMs: number;
  /** 轮询间隔(ms) */
  pollMs: number;
  /** 卡死判定:连续 N 次位置不变视为卡死 */
  stuckTicks: number;
}

export type ArriveStatus = 'arrived' | 'timeout' | 'stuck' | 'cancelled';

export class MovementEngine {
  private cancelled = false;

  constructor(
    private input: IInputProvider,
    private coord: CoordinateReader,
  ) {}

  /** 取消正在进行的移动 */
  cancel() {
    this.cancelled = true;
  }

  reset() {
    this.cancelled = false;
  }

  /**
   * 移动到目标世界坐标
   * 策略:把世界坐标转屏幕坐标(简化:用地图比例,中心为当前角色)
   * 然后点击地面,等到达
   *
   * 简化版:小地图中心是"我",目标 = 当前点 + (target - current) 缩放到小地图
   */
  async moveTo(target: WorldPoint, opts: Partial<ArriveOpts> = {}): Promise<ArriveStatus> {
    this.reset();
    const cfg: ArriveOpts = {
      threshold: 8,
      timeoutMs: 30000,
      pollMs: 500,
      stuckTicks: 6,
      ...opts,
    };

    // 1. 计算目标在小地图上的屏幕坐标
    // 简化:把小地图中心当作"我",目标按比例偏移
    // 真实实现应该用 player_arrow 模板定位"我"在小地图上的位置
    const mm = this.coord.profile.regions.minimap;
    const center = { x: mm.x + mm.w / 2, y: mm.y + mm.h / 2 };
    // TODO: 用 player_arrow 找到自己位置,然后算偏移
    // 现在先用中心点近似
    const screenPos = center;

    // 2. 拟人化移动到该屏幕点 + 点击
    await this.input.moveMouse(screenPos, { kind: 'human', durationMs: 300 });
    await this.wait(80);
    await this.input.click('left', 1);

    // 3. 等待到达
    return this.waitForArrive(target, cfg);
  }

  /**
   * 轮询等待到达目标点
   */
  async waitForArrive(target: WorldPoint, opts: ArriveOpts): Promise<ArriveStatus> {
    const start = Date.now();
    let lastPos: WorldPoint | null = null;
    let stuck = 0;

    while (Date.now() - start < opts.timeoutMs) {
      if (this.cancelled) return 'cancelled';

      const cur = await this.coord.readPlayerPosition();
      if (cur) {
        const dist = distance(cur, target);
        if (dist < opts.threshold) return 'arrived';

        // 卡死检测
        if (lastPos && distance(lastPos, cur) < 1) {
          stuck++;
          if (stuck >= opts.stuckTicks) return 'stuck';
        } else {
          stuck = 0;
        }
        lastPos = cur;
      }
      await this.wait(opts.pollMs);
    }
    return 'timeout';
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
