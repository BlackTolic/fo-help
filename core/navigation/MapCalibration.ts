// MapCalibration: 地图坐标 ↔ 屏幕坐标 的换算(点地移动类游戏,如 QQ 幻想)
//
// 模型:角色始终显示在画面固定的 selfScreen 上(默认 = 游戏画面中心),点击屏幕某点 =
//       命令角色走到「该点在当前视角下对应的地图坐标」。所以「地图坐标 → 屏幕坐标」
//       是以角色为原点、以当前读数为锚点的线性映射:
//         anchor = 点击瞬间角色所在地图坐标(= 此刻画面中心对应的地图坐标)
//         screen = selfScreen + M × (map - anchor)
//         map    = anchor + M⁻¹ × (screen - selfScreen)
//       M 是 2×2 矩阵:对角线是「每个地图坐标单位对应多少像素」,非对角线是两轴之间的耦合
//       (视角不是正对、有轻微旋转/剪切时不为 0;本项目实测 b≈-0.8、c≈-0.2 px/单位)。
//
// M 怎么标定:用真实点击反推 ——「从 from 起,点屏幕 screen,角色实际走到 to」给出两条方程:
//         M × (to - from) = screen - selfScreen        (屏幕 x / 屏幕 y 各一条)
//       四个参数 a/b/c/d 至少要两组不共线的样本才解得出来;样本多了就用最小二乘拟合,
//       并打印每个样本的残差,一眼看出标定准不准。本项目 7 组实测拟合出
//       a=39.45 b=-0.84 c=-0.21 d=39.89,锚点反推 ≈(644,396),最大残差 32.7px(0.82 单位)。
//       注意:一次点击只在「有位移的那个方向」提供信息 —— 只点正右方,只能定 a。
//       (地图坐标是整数读数,量化误差 ±1 单位 ≈40px,残差基本落在这一档内。)
//
// 单独成文件的原因:换算和「怎么走」(点击/按住/寻路)是两件事,移动控制器只调用它。

import type { Point, Rect } from '../platform/vision/IVisionProvider';
import type { MapPosition } from '../perception/types';
import { createLogger } from '../logger';

const log = createLogger('navigation.calibration');

/** 默认游戏画面区域:窗口客户区;本工具按 1280x800 目标分辨率,窗口不同就配 gameRect */
const DEFAULT_GAME_RECT: Rect = { x: 0, y: 0, w: 1280, h: 800 };
/** 点击点离画面边界至少留几像素(避免点到窗口边框/窗口外) */
const DEFAULT_MARGIN = 4;
/** 样本/显式比例都没有时用的兜底比例(本项目实测:水平 38、竖直 40) */
const DEFAULT_PX_PER_UNIT = 40;
/** 判断「样本够不够解出矩阵」的阈值(相对值,见 fitRow) */
const RANK_EPS = 1e-6;

/**
 * 一次标定点击:从 from(点击前角色地图坐标)点屏幕 screen,角色实际走到 to。
 * map 字段只影响日志,不参与换算。
 */
export interface CalibrationSample {
  from: MapPosition;
  screen: Point;
  to: MapPosition;
}

/** 地图坐标差 → 屏幕偏移 的线性映射(2×2 矩阵) */
export interface MapMatrix {
  /** 地图 x 单位 → 屏幕 x 像素 */
  a: number;
  /** 地图 y 单位 → 屏幕 x 像素(轴间耦合/剪切) */
  b: number;
  /** 地图 x 单位 → 屏幕 y 像素(轴间耦合/剪切) */
  c: number;
  /** 地图 y 单位 → 屏幕 y 像素 */
  d: number;
}

export interface MapCalibrationConfig {
  /** 角色脚下(当前地图坐标在屏幕上的位置):默认 gameRect 的中心 */
  selfScreen?: Point;
  /** 游戏画面区域(窗口客户区,大漠绑定后是客户区相对坐标):默认 {0,0,1280,800} */
  gameRect?: Rect;
  /** 点击点离画面边界的最小像素:默认 4 */
  margin?: number;
  /** 直接指定映射矩阵(优先于样本与下面的对角比例) */
  matrix?: MapMatrix;
  /** 标定点击样本:拟合出映射矩阵(优先于 scaleX/scaleY/pxPerUnit) */
  samples?: CalibrationSample[];
  /** 只按轴对齐标定时的水平比例(样本定不出 a 时兜底) */
  scaleX?: number;
  /** 只按轴对齐标定时的垂直比例(样本定不出 d 时兜底) */
  scaleY?: number;
  /** 以上都没有时的默认比例:默认 40 */
  pxPerUnit?: number;
}

/**
 * 拟合用的一行:样本的地图坐标差(dx/dy)与点击落点相对「假定锚点」的偏移(vx/vy)
 * 以及落点的绝对屏幕坐标(ax/ay,拟合锚点用)。
 */
interface SampleRow {
  sample: CalibrationSample;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
}

/** 拟合锚点至少要几组样本:6 个未知量要 8 条方程才有余量,3 组会"刚好解出"、残差恒为 0,不可信 */
const ANCHOR_MIN_SAMPLES = 4;

/**
 * 用样本最小二乘拟合「映射矩阵 + 角色锚点」,并算出每个样本的残差。
 *
 * 为什么连锚点一起拟合:模型是 click = 锚点 + M × 地图差,锚点(角色脚下到底在屏幕哪个像素)
 * 本身是未知量。锚点假设错了不会变成残差噪声,而是**每次点击都同样偏这么多**的固定偏差;
 * 样本够(≥4 组)时把它一起解出来,残差能从「固定偏差 + 噪声」降到纯噪声。
 *
 * 某一行信息不足时(样本只沿一条线分布,例如只点过正右方)退回:本轴用拟合值、
 * 轴间项取 0;本轴也定不出来时用 fallback 的兜底比例。
 */
export function deriveMatrixFromSamples(
  samples: CalibrationSample[],
  selfScreen: Point,
  fallback: Point,
): {
  matrix: MapMatrix;
  /** 角色锚点(样本够时是拟合值,否则是传入的假定值) */
  selfScreen: Point;
  /** 锚点是否来自样本拟合 */
  anchorFitted: boolean;
  residuals: { sample: CalibrationSample; errPx: number }[];
} {
  // 没有位移的样本提供不了信息(方程两边都是 0),直接跳过
  const rows: SampleRow[] = samples
    .map((s) => ({
      sample: s,
      dx: s.to.x - s.from.x,
      dy: s.to.y - s.from.y,
      vx: s.screen.x - selfScreen.x,
      vy: s.screen.y - selfScreen.y,
      ax: s.screen.x,
      ay: s.screen.y,
    }))
    .filter((r) => r.dx !== 0 || r.dy !== 0);

  const fitAnchor = rows.length >= ANCHOR_MIN_SAMPLES;
  const xRow = fitRow(
    rows,
    (r) => r.vx,
    (r) => r.ax,
    fallback.x,
    fitAnchor,
  );
  const yRow = fitRow(
    rows,
    (r) => r.vy,
    (r) => r.ay,
    fallback.y,
    fitAnchor,
  );
  const matrix: MapMatrix = { a: xRow.own, b: xRow.cross, c: yRow.own, d: yRow.cross };
  const anchorFitted = xRow.anchor !== null && yRow.anchor !== null;
  const anchor: Point = { x: xRow.anchor ?? selfScreen.x, y: yRow.anchor ?? selfScreen.y };

  const residuals = rows.map((r) => ({
    sample: r.sample,
    errPx: Math.hypot(
      anchor.x + matrix.a * r.dx + matrix.b * r.dy - r.ax,
      anchor.y + matrix.c * r.dx + matrix.d * r.dy - r.ay,
    ),
  }));
  return { matrix, selfScreen: anchor, anchorFitted, residuals };
}

/**
 * 拟合矩阵的一行:own = 本轴比例(如 a),cross = 另一轴的耦合(如 b)。
 * withAnchor 时先用 [1, dx, dy] 三元拟合(多解出锚点),退化再退回 [dx, dy] 二元。
 */
function fitRow(
  rows: SampleRow[],
  pick: (r: SampleRow) => number,
  pickAbs: (r: SampleRow) => number,
  fallbackOwn: number,
  withAnchor: boolean,
): { own: number; cross: number; anchor: number | null } {
  if (withAnchor) {
    const c = solveLeastSquares(rows, [(r) => 1, (r) => r.dx, (r) => r.dy], pickAbs);
    if (c) return { anchor: c[0], own: c[1], cross: c[2] };
  }

  const c = solveLeastSquares(rows, [(r) => r.dx, (r) => r.dy], pick);
  if (c) return { own: c[0], cross: c[1], anchor: null };

  // 样本都沿「本轴」方向(如全是正右方点击)→ 只能定 own,cross 取 0
  const sxx = rows.reduce((t, r) => t + r.dx * r.dx, 0);
  if (sxx > RANK_EPS) {
    const sxs = rows.reduce((t, r) => t + r.dx * pick(r), 0);
    return { own: sxs / sxx, cross: 0, anchor: null };
  }
  // 连本轴位移都没有(只有另一轴的样本)→ cross 用拟合,own 用兜底比例
  const syy = rows.reduce((t, r) => t + r.dy * r.dy, 0);
  const sys = rows.reduce((t, r) => t + r.dy * pick(r), 0);
  return { own: fallbackOwn, cross: syy > RANK_EPS ? sys / syy : 0, anchor: null };
}

/**
 * 最小二乘解 cols·x = pick(r);样本不够分散(法方程退化)时返回 null,由调用方退回低阶模型
 */
function solveLeastSquares(
  rows: SampleRow[],
  cols: ((r: SampleRow) => number)[],
  pick: (r: SampleRow) => number,
): number[] | null {
  const k = cols.length;
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const B = new Array<number>(k).fill(0);
  for (const r of rows) {
    for (let i = 0; i < k; i++) {
      B[i] += cols[i](r) * pick(r);
      for (let j = 0; j < k; j++) A[i][j] += cols[i](r) * cols[j](r);
    }
  }
  // 高斯消元(列主元);主元过小 = 样本在几何上退化(共线/重合)
  const M = A.map((row, i) => [...row, B[i]]);
  const scale = Math.max(...M.map((row) => Math.max(...row.slice(0, k).map(Math.abs))), 1);
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    if (Math.abs(M[p][i]) < RANK_EPS * scale) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let j = i + 1; j < k; j++) {
      const f = M[j][i] / M[i][i];
      for (let c = i; c <= k; c++) M[j][c] -= f * M[i][c];
    }
  }
  const x = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = M[i][k];
    for (let c = i + 1; c < k; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

export class MapCalibration {
  /** 角色脚下(当前地图坐标对应的屏幕点) */
  readonly selfScreen: Point;
  /** 游戏画面区域 */
  readonly gameRect: Rect;
  /** 点击点离画面边界的最小像素 */
  readonly margin: number;
  /** 地图坐标差 → 屏幕偏移 */
  readonly matrix: MapMatrix;

  constructor(config: MapCalibrationConfig = {}) {
    this.gameRect = config.gameRect ?? { ...DEFAULT_GAME_RECT };
    const assumedSelf: Point = config.selfScreen ?? {
      x: this.gameRect.x + Math.round(this.gameRect.w / 2),
      y: this.gameRect.y + Math.round(this.gameRect.h / 2),
    };
    this.margin = config.margin ?? DEFAULT_MARGIN;

    const fallback: Point = {
      x: config.scaleX ?? config.pxPerUnit ?? DEFAULT_PX_PER_UNIT,
      y: config.scaleY ?? config.pxPerUnit ?? DEFAULT_PX_PER_UNIT,
    };
    const { matrix, selfScreen, anchorFitted, residuals } = deriveMatrixFromSamples(
      config.samples ?? [],
      assumedSelf,
      fallback,
    );
    // 样本够时锚点取拟合值:角色脚下未必正好在假定位置(实测偏 10px),不修就会变成每次点击的固定偏差
    this.selfScreen = selfScreen;
    this.matrix = config.matrix ?? matrix;

    const { a, b, c, d } = this.matrix;
    const fit = config.matrix
      ? '显式指定'
      : residuals.length === 0
        ? '兜底比例'
        : `样本拟合(${residuals.length} 组)`;
    const maxErr = residuals.reduce((m, r) => Math.max(m, r.errPx), 0);
    log.info(
      `地图标定: 角色=${this.selfScreen.x.toFixed(1)},${this.selfScreen.y.toFixed(1)}` +
        (anchorFitted
          ? `(样本反推;配置的 ${assumedSelf.x},${assumedSelf.y} 是假定值)`
          : '(配置值)') +
        ` 画面=${this.gameRect.w}x${this.gameRect.h}` +
        ` 矩阵=[a=${a.toFixed(2)} b=${b.toFixed(2)} c=${c.toFixed(2)} d=${d.toFixed(2)}]` +
        ` 来源=${fit}` +
        (residuals.length > 0
          ? ` 最大残差=${maxErr.toFixed(1)}px(${(maxErr / Math.max(a, d)).toFixed(2)} 单位)`
          : ''),
    );
  }

  /** 地图坐标 → 屏幕坐标(anchor = 当前角色所在地图坐标) */
  mapToScreen(map: MapPosition, anchor: MapPosition): Point {
    const dx = map.x - anchor.x;
    const dy = map.y - anchor.y;
    const { a, b, c, d } = this.matrix;
    return {
      x: this.selfScreen.x + a * dx + b * dy,
      y: this.selfScreen.y + c * dx + d * dy,
    };
  }

  /** 屏幕坐标 → 地图坐标(mapToScreen 的反算,用于校验标定/调试) */
  screenToMap(screen: Point, anchor: MapPosition): MapPosition {
    const { a, b, c, d } = this.matrix;
    const sx = screen.x - this.selfScreen.x;
    const sy = screen.y - this.selfScreen.y;
    let det = a * d - b * c;
    // 矩阵退化(比例没标出来的极端情况)时按轴对齐近似,至少不返回 NaN
    if (Math.abs(det) < 1e-9) det = 1e-9;
    return {
      map: anchor.map,
      x: anchor.x + (d * sx - b * sy) / det,
      y: anchor.y + (-c * sx + a * sy) / det,
    };
  }

  /**
   * 把「角色 → 该点」的连线裁到游戏画面内(方向不变,只缩短距离)。
   * 目标太远时落点会跑到窗口外(点到桌面/别的程序上),所以沿该方向取最近的边界作为落点。
   * @returns clamped=true 表示落点被边界截短过(角色还没到目标,下一轮会重新算)
   */
  clampToView(point: Point): { point: Point; clamped: boolean } {
    const { x: minX, y: minY, w, h } = this.gameRect;
    const left = minX + this.margin;
    const top = minY + this.margin;
    const right = minX + w - this.margin;
    const bottom = minY + h - this.margin;

    const dx = point.x - this.selfScreen.x;
    const dy = point.y - this.selfScreen.y;
    const EPS = 1e-6;
    let t = 1;
    if (dx > EPS) t = Math.min(t, (right - this.selfScreen.x) / dx);
    else if (dx < -EPS) t = Math.min(t, (left - this.selfScreen.x) / dx);
    if (dy > EPS) t = Math.min(t, (bottom - this.selfScreen.y) / dy);
    else if (dy < -EPS) t = Math.min(t, (top - this.selfScreen.y) / dy);
    t = Math.max(0, Math.min(1, t));

    return {
      point: {
        x: Math.round(this.selfScreen.x + dx * t),
        y: Math.round(this.selfScreen.y + dy * t),
      },
      clamped: t < 1,
    };
  }
}
