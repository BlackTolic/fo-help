// RouteTraveler: 沿路途经点行走 + 过图等待(死亡回城补给等"跨地图赶路"场景用)
//
// 背景:MovementController.moveTo 检测到「目标与当前不在同一地图」会直接返回 false(见
// MovementController.ts 跨图分支),跨图由上层处理 —— 本模块就是那个上层:
//   travelToExit    从当前位置(一般在城镇)依次途经若干路径点走到出城口,踩上出城口后
//                   游戏自动切到野外地图;轮询地图名确认切图成功
//   travelWithinMap 同图多点行走的薄封装(不做过图检测)
//
// 设计约束:本模块只依赖「原始参数」(movement 实例、地图名读取函数、坐标点),
// 不依赖任何任务配置类型(配置解析由调用方/后续任务注入);
// 地图名读取只依赖一个可注入的读取函数,同步/异步均可(MapCoordReader.read 是异步的,
// 调用方可以包一层缓存,如「上一次成功读到的地图名」)。
//
// 停止机制:MovementController.moveTo 本身没有停止机制,本模块通过 opts.isStopped
// 在「每个途经点之间 / 出城口移动前 / 切图轮询的每一轮」检查外部停止标志
// (如 farm 主循环的 ctx.moveAttack.running);moveTo 内部则靠其自然退出
// (到达 / noMoveTimeoutMs 卡住超时),要缩短停止响应时间可传 moveOptions.noMoveTimeoutMs。

import type { MapPosition } from '../perception/types';
import { createLogger } from '../logger';
import type { MovementController, MoveOptions } from './MovementController';

const log = createLogger('navigation.route-traveler');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 途经点/出城口的地图逻辑坐标(不是屏幕像素坐标) */
export interface RoutePoint {
  x: number;
  y: number;
}

/** 地图名读取函数:返回当前地图名(OCR 读不到时返回空串),同步或异步均可 */
export type MapNameReader = () => string | Promise<string>;

export interface TravelOptions {
  /** 整体超时(走路 + 等切图),默认 120000ms;超时返回 false */
  timeoutMs?: number;
  /** 踩上出城口后轮询地图名的间隔,默认 600ms */
  mapPollIntervalMs?: number;
  /** 传给每个途经点 moveTo 的移动参数(卡住超时/步距等);不传用 moveTo 默认值 */
  moveOptions?: MoveOptions;
  /** 外部停止标志:返回 true 时尽快退出并返回 false(如 () => !ctx.moveAttack.running) */
  isStopped?: () => boolean;
  /** 进度日志回调(途经点通过/失败、切图成功等),可选;不传只写内部日志 */
  onProgress?: (msg: string) => void;
}

/** 整体超时默认值:2 分钟 */
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
/** 踩上出城口后轮询地图名的默认间隔 */
const DEFAULT_MAP_POLL_INTERVAL_MS = 600;

/** 写内部日志,并透传给上层的进度回调 */
function report(opts: TravelOptions, msg: string): void {
  log.info(msg);
  opts.onProgress?.(msg);
}

/** 写内部警告日志,并透传给上层的进度回调 */
function reportWarn(opts: TravelOptions, msg: string): void {
  log.warn(msg);
  opts.onProgress?.(msg);
}

/** 读地图名并规整:去掉首尾空白,读不到(空串)返回 null(与 MapPosition.map 的语义对齐) */
async function readMapNameSafe(readMapName: MapNameReader): Promise<string | null> {
  const name = (await readMapName()).trim();
  return name || null;
}

/** 用出发地图名 + 坐标点构造 moveTo 的目标;出发图名为 null 时传 null(跳过跨图检查) */
function toMapPosition(map: string | null, p: RoutePoint): MapPosition {
  return { map, x: p.x, y: p.y };
}

/**
 * 沿路途经点走到出城口并等待切图(死亡回城后从城镇走去野外的典型流程)
 *
 * 流程:
 *   1. 记录出发地图名;
 *   2. 依次对每个途经点调 movement.moveTo —— 某点返回 false(卡住/意外跨图)不中断,
 *      记警告后继续下一个点;
 *   3. moveTo 走到出城口(exitPos);
 *   4. 轮询地图名:与出发图不同、或包含 targetMapName,视为切图成功,返回 true;
 *      整体超时仍未切图,返回 false。
 *
 * 途经点/出城口的目标都带出发地图名:这样 moveTo 的跨图分支生效 —— 走路途中意外
 * 踩到传送点切了图,moveTo 会立即返回 false(而不是在新地图上对着垃圾坐标一直点),
 * 随后第 4 步的轮询会直接确认切图结果。
 *
 * @param movement    移动控制器(与 MovementController 子类实例通用,基类类型即可)
 * @param readMapName 地图名读取函数(同步/异步均可;建议包一层"上次成功值"缓存)
 * @param points      途经点(出发图内,按顺序走;可为空数组 = 直接走去出城口)
 * @param exitPos     出城口坐标(踩上去游戏自动切图)
 * @param targetMapName 目标地图名(轮询读到的地图名包含它即视为切图成功)
 */
export async function travelToExit(
  movement: MovementController,
  readMapName: MapNameReader,
  points: RoutePoint[],
  exitPos: RoutePoint,
  targetMapName: string,
  opts?: TravelOptions,
): Promise<boolean> {
  const options: TravelOptions = opts ?? {};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mapPollIntervalMs = options.mapPollIntervalMs ?? DEFAULT_MAP_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const stopped = (): boolean => options.isStopped?.() === true;

  const startMap = await readMapNameSafe(readMapName);
  report(options, `出发地图:「${startMap ?? '未知'}」,途经 ${points.length} 个点去出城口 (${exitPos.x}, ${exitPos.y})`);

  // 依次走途经点:单个点失败(卡住/意外跨图)不中断,继续下一个
  for (let i = 0; i < points.length; i++) {
    if (stopped()) {
      reportWarn(options, '外部停止,放弃赶路');
      return false;
    }
    if (Date.now() >= deadline) {
      reportWarn(options, `赶路超时(${timeoutMs} ms),未走到出城口`);
      return false;
    }
    const wp = points[i];
    const ok = await movement.moveTo(toMapPosition(startMap, wp), options.moveOptions);
    if (!ok) {
      reportWarn(options, `途经点 ${i + 1}/${points.length} (${wp.x}, ${wp.y}) 未到达,继续下一个`);
    } else {
      report(options, `途经点 ${i + 1}/${points.length} (${wp.x}, ${wp.y}) 已到达`);
    }
  }

  // 走去出城口:踩上去游戏自动切图,moveTo 可能因"到达"或"读到跨图"退出,两种都继续等切图
  if (stopped()) {
    reportWarn(options, '外部停止,放弃赶去出城口');
    return false;
  }
  const exitArrived = await movement.moveTo(toMapPosition(startMap, exitPos), options.moveOptions);
  report(
    options,
    exitArrived
      ? `已到达出城口 (${exitPos.x}, ${exitPos.y}),等待切到「${targetMapName}」`
      : `未确认到达出城口 (${exitPos.x}, ${exitPos.y}),仍等待切图`,
  );

  // 轮询地图名等切图:与出发图不同(已经切走)或包含目标图名(明确切对)都算成功
  while (Date.now() < deadline) {
    if (stopped()) {
      reportWarn(options, '外部停止,放弃等待切图');
      return false;
    }
    const current = await readMapNameSafe(readMapName);
    if (current !== null && ((startMap !== null && current !== startMap) || current.includes(targetMapName))) {
      report(options, `已切图:「${startMap ?? '?'}」→「${current}」`);
      return true;
    }
    await sleep(mapPollIntervalMs);
  }

  reportWarn(options, `等待切图超时(${timeoutMs} ms):仍未从「${startMap ?? '?'}」切到「${targetMapName}」`);
  return false;
}

/**
 * 轮询等地图名变成目标图(与 travelToExit 第 4 步同一判定:地图名变了、或包含目标名即算成功)。
 * 供「与 NPC 对话后传送」(飞空艇等)这类不走传送点的切图使用 —— 配方跑完后地图会自己变。
 *
 * @param readMapName 地图名读取函数
 * @param startMap    出发地图名(读不到可传 null);用于"地图名变了"这一判据
 * @param targetMapName 目标地图名
 * @returns 超时前切到目标图 = true;超时 / 被外部停止 = false
 */
export async function waitForMapName(
  readMapName: MapNameReader,
  startMap: string | null,
  targetMapName: string,
  opts?: TravelOptions,
): Promise<boolean> {
  const options: TravelOptions = opts ?? {};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mapPollIntervalMs = options.mapPollIntervalMs ?? DEFAULT_MAP_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (options.isStopped?.() === true) {
      reportWarn(options, '外部停止,放弃等待切图');
      return false;
    }
    const current = await readMapNameSafe(readMapName);
    if (current !== null && ((startMap !== null && current !== startMap) || current.includes(targetMapName))) {
      report(options, `已切图:「${startMap ?? '?'}」→「${current}」`);
      return true;
    }
    await sleep(mapPollIntervalMs);
  }

  reportWarn(options, `等待切图超时(${timeoutMs} ms):仍未从「${startMap ?? '?'}」切到「${targetMapName}」`);
  return false;
}

/**
 * 轮询等地图名变化(用回城卷轴后不知道会落到哪张图,只能等"地图名变了")。
 * 与 waitForMapName 同源,区别是它不关心目标图名,只要求读到一张与 startMap 不同的图。
 *
 * @returns 在超时前读到一张不同的地图 = true;超时 / 被外部停止 = false
 */
export async function waitForMapChange(readMapName: MapNameReader, startMap: string | null, opts?: TravelOptions): Promise<boolean> {
  const options: TravelOptions = opts ?? {};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mapPollIntervalMs = options.mapPollIntervalMs ?? DEFAULT_MAP_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (options.isStopped?.() === true) {
      reportWarn(options, '外部停止,放弃等待切图');
      return false;
    }
    const current = await readMapNameSafe(readMapName);
    if (current !== null && (startMap === null || current !== startMap)) {
      report(options, `已切图:「${startMap ?? '?'}」→「${current}」`);
      return true;
    }
    await sleep(mapPollIntervalMs);
  }

  reportWarn(options, `等待切图超时(${timeoutMs} ms):地图名仍为「${startMap ?? '?'}」`);
  return false;
}

/**
 * 同图多点行走的薄封装(补给点之间、城内几个 NPC 之间走路用)
 *
 * 不做过图检测(目标 map 传 null,moveTo 的跨图分支不生效);逐点 moveTo,
 * 单点失败(卡住)记警告后继续走完剩余点;返回是否全部成功。
 * 配合 isStopped 可在点间及时响应外部停止(moveTo 内部靠自然超时退出)。
 */
export async function travelWithinMap(movement: MovementController, points: RoutePoint[], opts?: TravelOptions): Promise<boolean> {
  const options: TravelOptions = opts ?? {};
  let allOk = true;

  for (let i = 0; i < points.length; i++) {
    if (options.isStopped?.() === true) {
      reportWarn(options, '外部停止,中断多点行走');
      return false;
    }
    const wp = points[i];
    const ok = await movement.moveTo(toMapPosition(null, wp), options.moveOptions);
    if (!ok) {
      allOk = false;
      reportWarn(options, `点 ${i + 1}/${points.length} (${wp.x}, ${wp.y}) 未到达`);
    } else {
      report(options, `点 ${i + 1}/${points.length} (${wp.x}, ${wp.y}) 已到达`);
    }
  }

  return allOk;
}

/** 锚点间路线的一条记录(与 shared/types.ts 的 TownProfileRoute 结构兼容) */
export interface AnchoredRoute {
  /** 起点锚点 id */
  from: string;
  /** 终点锚点 id */
  to: string;
  waypoints: RoutePoint[];
}

/**
 * 按锚点 id 解析一条途经点序列(城镇档案 / 过图路线共用):
 *   1. 优先直接路线(from → to)
 *   2. 其次反向路线(to → from)的 waypoints 反序 —— 档案里只配一个方向是常态
 *   3. 都没有 → 空数组:调用方退化成"直接从当前位置走过去"
 */
export function resolveAnchoredRoute(routes: AnchoredRoute[], from: string, to: string): RoutePoint[] {
  const direct = routes.find((r) => r.from === from && r.to === to);
  if (direct) return direct.waypoints.map((p) => ({ x: p.x, y: p.y }));

  const reverse = routes.find((r) => r.from === to && r.to === from);
  if (reverse) return [...reverse.waypoints].reverse().map((p) => ({ x: p.x, y: p.y }));

  return [];
}
