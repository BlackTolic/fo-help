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
// 到达/退出时的收尾(如释放按住的鼠标键)用 onArrived()/onMoveEnd() 钩子,不要覆写 moveTo。
//
// 坐标系假设:x 向东递增,y 向南递增(2D 游戏惯例;不对就改 directionTo)

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { Point } from '../platform/vision/IVisionProvider';
import type { MapCoordReader } from '../perception/MapCoordReader';
import type { MapPosition } from '../perception/types';
import { createLogger } from '../logger';

const log = createLogger('navigation.movement');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
    const idx = Math.round((((angle % 360) + 360) % 360) / 45) % 8;
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

    try {
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
            await this.onArrived(target);
            return true;
          }

          // 坐标有明显变化 → 认为还在移动,重置「没移动」计时
          if (!lastPos || this.deltaTo(lastPos, current).dist > moveEpsilon) {
            lastPos = current;
            lastMovedAt = Date.now();
          }

          const dir = this.directionTo(current, target);
          log.debug(
            `移动中: (${current.x},${current.y}) → (${target.x},${target.y}) 方向=${dir} 距离=${dist.toFixed(1)}`,
          );
          // 这里可以设计两种移动方式:
          // 1. 点击目标点(需要 地图坐标 → 屏幕坐标 的换算,配 mapCalibration)
          // 2. 直接点地面朝目标方向移动
          await this.stepTowards(current, target, dir);
          await sleep(stepIntervalMs);
        }

        // 退出判断:坐标超过 noMoveTimeoutMs 没有变化,视为卡住
        if (Date.now() - lastMovedAt >= noMoveTimeoutMs) {
          log.warn(
            `移动到 (${target.x}, ${target.y}) 失败:${Math.round(noMoveTimeoutMs / 60000)} 分钟没有移动`,
          );
          return false;
        }
      }
    } finally {
      // 到达/卡住/跨图/异常等任何退出路径,都给子类一次清理机会(如释放按住的鼠标键)
      await this.onMoveEnd();
    }
  }

  /** 到达目标后的钩子(如:松开按键、点脚下让角色停住),默认空实现 */
  protected async onArrived(_target: MapPosition): Promise<void> {
    // 默认无收尾操作;由子类按需覆写
  }

  /** moveTo 无论以何种路径退出(到达/卡住/跨图/异常)都会调用的清理钩子,默认空实现 */
  protected async onMoveEnd(): Promise<void> {
    // 默认无收尾操作;由子类按需覆写
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

/**
 * 移动方式二：随机圆点按住移动（参考 ffo-auto-tool 的 move 实现并修复其问题）
 *
 * 每步:
 *   1. 算「当前坐标 → 目标坐标」的精确角度(连续角,不做八方向量化)
 *   2. 在角度上叠加随机抖动、在半径上随机缩短,得到「画面中心 + 圆上随机落点」
 *   3. 鼠标移到落点并按住左键,角色朝鼠标方向持续走;每步重算角度,自动纠偏
 *
 * 相对参考实现的修复:
 *   - 参考实现 `!fromPos.x || !fromPos.y` 会把合法坐标 0 当成"未识别"而拒绝移动;这里不做该判断
 *   - 参考实现 getCirclePoint 对弧度/cos/sin 提前 toFixed(2),白白丢精度;这里全程浮点,最后才取整像素
 *   - 参考实现每 300ms 重复 LeftDown 且不配对释放,只靠外层手动停止/到达补丁;这里维护 holding 状态,
 *     并借助基类 onArrived/onMoveEnd 钩子,保证到达/卡住/跨图/异常任何退出路径都释放左键
 */
export interface RandomMoveConfig {
  /** 圆心(角色脚下 = 画面中心),默认 SCREEN_CENTER;窗口不是 1024x768 时按实际中心传 */
  center?: Point;
  /** 鼠标落点离圆心的距离(px),默认 STEP_PIXELS */
  radius?: number;
  /** 角度随机抖动范围(±度,默认 15);0 = 关闭抖动(等价参考实现的精确角度) */
  angleJitterDeg?: number;
  /** 半径随机抖动比例(0~1,默认 0.3):落点距离在 radius×[1-jitter, 1] 之间 */
  radiusJitter?: number;
  /** 鼠标就位后多久按下(ms,同参考实现,默认 300) */
  pressDelayMs?: number;
}

export class MovementControllerByRandom extends MovementController {
  private readonly center: Point; // 圆心(角色脚下 = 画面中心)
  private readonly radius: number; // 鼠标落点离圆心的距离(px)
  private readonly angleJitterRad: number; // 角度随机抖动范围(弧度)
  private readonly radiusJitter: number; // 半径随机抖动比例(0~1,默认 0.3):落点距离在 radius×[1-jitter, 1] 之间
  private readonly pressDelayMs: number; // 鼠标就位后多久按下(ms,同参考实现,默认 300)
  /** 左键是否处于按住状态:避免重复 LeftDown,也是释放回调的判据 */
  private holding = false;

  constructor(input: IInputProvider, coords: MapCoordReader, config: RandomMoveConfig = {}) {
    super(input, coords);
    this.center = config.center ?? { ...SCREEN_CENTER };
    this.radius = config.radius ?? STEP_PIXELS;
    this.angleJitterRad = ((config.angleJitterDeg ?? 15) * Math.PI) / 180;
    this.radiusJitter = config.radiusJitter ?? 0.3;
    this.pressDelayMs = config.pressDelayMs ?? 300;
  }

  /**
   * 朝目标走一小步:鼠标落到「中心 + 随机角度/半径」的圆上并按住左键
   * @_direction 基类按八方向量化后的方向,本实现用连续精确角,故忽略
   */
  protected async stepTowards(
    current: MapPosition,
    target: MapPosition,
    _direction: Direction8,
  ): Promise<void> {
    // 地图坐标 y 轴向南 = 屏幕 y 轴向南,atan2 角可直接映射到屏幕圆上落点
    const exactAngle = Math.atan2(target.y - current.y, target.x - current.x);
    const angle = exactAngle + (Math.random() * 2 - 1) * this.angleJitterRad;
    const r = this.radius * (1 - Math.random() * this.radiusJitter);
    // 全程浮点,最后才取整(避免参考实现多层 toFixed 造成的落点偏差)
    const x = Math.round(this.center.x + r * Math.cos(angle));
    const y = Math.round(this.center.y + r * Math.sin(angle));

    await this.input.moveMouse({ x, y }, { kind: 'instant' });
    await this.input.delay(this.pressDelayMs);
    if (!this.holding) {
      await this.input.mouseDown('left');
      this.holding = true;
    }
    const jitterDeg = ((angle - exactAngle) * 180) / Math.PI;
    const { dist } = this.deltaTo(current, target);
    log.debug(`随机移动: 落点 (${x},${y}) 抖动 ${jitterDeg.toFixed(1)}° 距目标 ${dist.toFixed(1)}`);
  }

  /** 到达:先松左键,再点一下圆心(角色脚下),让角色停在目标位置(基类循环到达时调用) */
  protected override async onArrived(_target: MapPosition): Promise<void> {
    await this.releaseLeft();
    await this.input.moveMouse(this.center, { kind: 'instant' });
    await this.input.delay(this.pressDelayMs);
    await this.input.click('left');
  }

  /** moveTo 任何退出路径(到达/卡住/跨图/异常):释放左键,避免"卡住按下状态" */
  protected override async onMoveEnd(): Promise<void> {
    await this.releaseLeft();
  }

  private async releaseLeft(): Promise<void> {
    if (!this.holding) return;
    await this.input.mouseUp('left');
    this.holding = false;
  }
}

export default MovementController;
