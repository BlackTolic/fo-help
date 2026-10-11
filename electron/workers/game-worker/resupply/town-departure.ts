// 从城镇出发到某张目标图 / 回城卷轴回城 / 主城中转(启动跨图、开工与死亡返程共用)
//
// 城镇档案里的「出口」(TownProfileExit)有两种通行方式(见 shared/types.ts):
//   - walk(缺省):沿锚点路线走到出口坐标,踩上传送点,等切图(走 RouteTraveler.travelToExit)
//   - npc:沿锚点路线走到 NPC 跟前,跑一遍对话配方(飞空艇「使用传送」),再等地图名变成目标图
// 另外提供两个「起点恢复」原语(见 tasks/farm.ts 的 crossMapsOnStartup):
//   - returnViaScroll   起点在野外/任意地图时,按回城卷轴回到某个主城(回归前只知道"地图名变了")
//   - transitCityToTown 回城落在别的主城时,用该主城的飞空艇 NPC 传送回出发城镇
//
// 抽成独立模块是为了让 tasks/farm.ts 与 resupply-runner.ts 共用同一份逻辑(两边都不必 import 对方)。
// 只负责"离开/回到城镇"这一段:到达目标图后的后续(逐跳过图 / 走入图点)由调用方接管;
// 换图屏蔽(blockAllPlayers)也由调用方在成功后处理。

import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import type { IInputProvider } from '../../../../core/platform/input/IInputProvider';
import { pressSkillKey } from '../../../../core/platform/input/skill-key';
import type { SkillKey } from '../../../../core/platform/input/skill-key';
import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import type { MovementController, MoveOptions } from '../../../../core/navigation/MovementController';
import {
  resolveAnchoredRoute,
  travelToExit,
  travelWithinMap,
  waitForMapChange,
  waitForMapName,
} from '../../../../core/navigation/RouteTraveler';
import type { TownProfileConfig, TownTransitCity } from '../../../../shared/types';
import { sleep } from '../../../../core/utils/sleep';
import type { WorkerContext } from '../context';
import { talkToNpc } from './talk-npc';

/** 与 resupply-runner 的 RESUPPLY 同值(本模块自带一份,避免和 resupply-runner 互相 import 成环) */
const DEPARTURE = {
  /** 地图名读取次数与间隔:OCR 偶发读空,连读几次再判 */
  mapNameAttempts: 5,
  mapNameRetryMs: 600,
  /** 判定"路线终点已在目标附近"的容差(坐标单位):避免再走一次完全相同的点 */
  samePointTolerance: 5,
};

export interface DepartTownOptions {
  ctx: WorkerContext;
  client: DamooClient;
  size: WindowSizeKey;
  /** 移动控制器(必须是能读地图名的那份 travelMovement,跨图守卫与切图轮询才生效) */
  movement: MovementController;
  /** 读当前地图名(OCR 中文名) */
  readMapName: () => Promise<string>;
  /** 日志前缀(与 farm 的 label 一致) */
  label: string;
  /** 城镇档案 */
  town: TownProfileConfig;
  /** 起点锚点 id('revive' 或某个 npc/exit 的 id) */
  fromAnchor: string;
  /** 目标图名(游戏内 OCR 中文名) */
  targetMapName: string;
  /** 整体超时(走路 + 等切图) */
  timeoutMs: number;
  /** 移动参数(卡住超时 / 步距等);不传用 moveTo 默认值 */
  moveOptions?: MoveOptions;
  /** 外部停止标志:返回 true 时尽快退出 */
  isStopped?: () => boolean;
}

export interface DepartTownResult {
  ok: boolean;
  detail: string;
}

/** 路线 + 目标点:途经点只负责"到附近",最后再走一次目标点本身(已在目标附近就不重复走) */
function appendTarget(route: { x: number; y: number }[], target: { x: number; y: number }): { x: number; y: number }[] {
  const last = route[route.length - 1];
  if (last && Math.hypot(last.x - target.x, last.y - target.y) <= DEPARTURE.samePointTolerance) return route;
  return [...route, { x: target.x, y: target.y }];
}

/** 读地图名并规整(空串 → null),带重试;全程读空返回 null */
async function readMapNameRetry(readMapName: () => Promise<string>): Promise<string | null> {
  for (let i = 0; i < DEPARTURE.mapNameAttempts; i++) {
    const name = String((await readMapName()) ?? '').trim();
    if (name) return name;
    if (i < DEPARTURE.mapNameAttempts - 1) await sleep(DEPARTURE.mapNameRetryMs);
  }
  return null;
}

/** 「走到 NPC → 跑对话配方 → 等切到目标图」的公共实现(出发传送 / 主城中转共用) */
interface NpcDepartureOptions {
  ctx: WorkerContext;
  client: DamooClient;
  size: WindowSizeKey;
  movement: MovementController;
  readMapName: () => Promise<string>;
  label: string;
  /** 日志里的动作名(如 '出发传送' / '主城中转') */
  actionLabel: string;
  npcName: string;
  recipeName: string;
  /** 要走的点(含 NPC 位置) */
  points: { x: number; y: number }[];
  /** 出发图名(等待切图的基线;读不到可传 null) */
  startMap: string | null;
  targetMapName: string;
  timeoutMs: number;
  moveOptions?: MoveOptions;
  isStopped?: () => boolean;
}

async function runNpcDeparture(opts: NpcDepartureOptions): Promise<DepartTownResult> {
  const { ctx, client, size, movement, readMapName, label, actionLabel, npcName, recipeName, points, startMap, targetMapName } = opts;
  const stopped = (): boolean => opts.isStopped?.() === true;

  ctx.sendLog('info', `[${label}] ${actionLabel}:走到 NPC「${npcName}」执行配方「${recipeName}」→「${targetMapName}」`);
  await travelWithinMap(movement, points, {
    timeoutMs: opts.timeoutMs,
    moveOptions: opts.moveOptions,
    isStopped: opts.isStopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (stopped()) return { ok: false, detail: `任务已停止(${actionLabel}途中)` };

  const talk = await talkToNpc({ ctx, client, size, label, npcName, recipeName });
  if (!talk.ok) return { ok: false, detail: `${actionLabel}:与「${npcName}」对话失败:${talk.detail ?? '未知原因'}` };

  const ok = await waitForMapName(readMapName, startMap, targetMapName, {
    timeoutMs: opts.timeoutMs,
    isStopped: opts.isStopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (!ok) {
    return {
      ok: false,
      detail: stopped()
        ? `任务已停止(${actionLabel}等切图途中)`
        : `${actionLabel}:与「${npcName}」对话后没能切到「${targetMapName}」(核对配方里的目的地文字与确认按钮坐标)`,
    };
  }
  return { ok: true, detail: `已传送到「${targetMapName}」` };
}

/**
 * 从当前城镇出发到 targetMapName:
 *   1. 在城镇档案里按 toMap 找到对应出口(找不到 = 配置缺一条出口);
 *   2. 沿锚点路线从 fromAnchor 走到出口坐标(没配路线 = 直接从当前位置走过去);
 *   3. 出口 via='npc' → 与 NPC 对话跑配方 → 等地图名变成目标图;否则走到出口踩传送点等切图。
 */
export async function departTownTo(opts: DepartTownOptions): Promise<DepartTownResult> {
  const { ctx, client, size, movement, readMapName, label, town, fromAnchor, targetMapName } = opts;
  const stopped = (): boolean => opts.isStopped?.() === true;

  const exit = (town.exits ?? []).find((e) => (e.toMap ?? '').trim() === targetMapName);
  if (!exit) {
    const available = (town.exits ?? []).map((e) => (e.toMap ?? '').trim() || '(未填地图名)').join('、');
    return {
      ok: false,
      detail: `城镇档案「${town.mapName}」里没有去「${targetMapName}」的出口${available ? `(现有出口:${available})` : '(exits 是空的)'}`,
    };
  }

  const route = resolveAnchoredRoute(town.routes ?? [], fromAnchor, exit.id);

  if (exit.via === 'npc') {
    const npcName = String(exit.npcName ?? '').trim();
    const recipeName = String(exit.recipeName ?? '').trim();
    if (!npcName || !recipeName) {
      return {
        ok: false,
        detail: `出口「→${targetMapName}」选了「对话传送」但没填传送 NPC / 对话配方(去城镇档案编辑器的出城口补上)`,
      };
    }
    const startMap = await readMapNameRetry(readMapName);
    return runNpcDeparture({
      ctx,
      client,
      size,
      movement,
      readMapName,
      label,
      actionLabel: '出发传送',
      npcName,
      recipeName,
      points: appendTarget(route, exit.position),
      startMap,
      targetMapName,
      timeoutMs: opts.timeoutMs,
      moveOptions: opts.moveOptions,
      isStopped: opts.isStopped,
    });
  }

  ctx.sendLog(
    'info',
    `[${label}] 出发:从「${town.mapName}」走 ${route.length} 个途经点 → 出口 (${exit.position.x},${exit.position.y}) → 「${targetMapName}」`,
  );
  const ok = await travelToExit(movement, readMapName, route, exit.position, targetMapName, {
    timeoutMs: opts.timeoutMs,
    moveOptions: opts.moveOptions,
    isStopped: opts.isStopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  return ok
    ? { ok: true, detail: `已从「${town.mapName}」走到出口并切到「${targetMapName}」` }
    : {
        ok: false,
        detail: stopped() ? '任务已停止(出城途中)' : `从「${town.mapName}」走到出口并切到「${targetMapName}」失败(核对出口坐标与路线)`,
      };
}

// ===== 起点恢复:回城卷轴 / 主城中转 =====

export interface ReturnScrollOptions {
  ctx: WorkerContext;
  /** farm 主循环正在用的输入模拟(复用同一实例) */
  input: IInputProvider;
  readMapName: () => Promise<string>;
  label: string;
  /** 回城卷轴所在物品栏快捷栏的键位 */
  key: SkillKey;
  /** 按下后等切图的超时(ms) */
  timeoutMs: number;
  isStopped?: () => boolean;
}

export interface ReturnScrollResult {
  ok: boolean;
  detail: string;
  /** 回城后读到的地图名(读不到为 null) */
  map: string | null;
}

/**
 * 按回城卷轴回城:记下当前图名 → 按卷轴键 → 等地图名变化 → 返回落到的主城名。
 * 只做"回城",回城后落在哪张图由调用方(读到的 map)决定后续(已在出发城镇 / 需要主城中转)。
 */
export async function returnViaScroll(opts: ReturnScrollOptions): Promise<ReturnScrollResult> {
  const { ctx, input, readMapName, label, key, timeoutMs } = opts;
  const stopped = (): boolean => opts.isStopped?.() === true;

  const startMap = await readMapNameRetry(readMapName);
  ctx.sendLog('info', `[${label}] 使用回城卷轴(${key}):当前图「${startMap ?? '未知'}」,等待回城`);
  await pressSkillKey(input, key);
  if (stopped()) return { ok: false, detail: '任务已停止(回城途中)', map: null };

  const changed = await waitForMapChange(readMapName, startMap, {
    timeoutMs,
    isStopped: opts.isStopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (!changed) {
    return {
      ok: false,
      detail: stopped()
        ? '任务已停止(等回城切图途中)'
        : `按回城卷轴后 ${Math.round(timeoutMs / 1000)}s 内地图名没变化(核对卷轴键位是否放在物品栏快捷栏)`,
      map: null,
    };
  }

  const map = await readMapNameRetry(readMapName);
  if (!map) return { ok: false, detail: '回城后读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)', map: null };
  ctx.sendLog('info', `[${label}] 回城卷轴:已回到「${map}」`);
  return { ok: true, detail: `已回到「${map}」`, map };
}

export interface TransitCityOptions {
  ctx: WorkerContext;
  client: DamooClient;
  size: WindowSizeKey;
  movement: MovementController;
  readMapName: () => Promise<string>;
  label: string;
  /** 中转主城(来自出发城镇档案的 transitFrom) */
  city: TownTransitCity;
  /** 目标城镇名(= 出发城镇的 mapName) */
  targetMapName: string;
  timeoutMs: number;
  moveOptions?: MoveOptions;
  isStopped?: () => boolean;
}

/**
 * 在别的主城坐飞空艇中转回出发城镇:走到该城的飞空艇 NPC → 跑配方 → 等地图名变成出发城镇。
 */
export async function transitCityToTown(opts: TransitCityOptions): Promise<DepartTownResult> {
  const { ctx, label, city, targetMapName } = opts;
  const npcName = String(city.npcName ?? '').trim();
  const recipeName = String(city.recipeName ?? '').trim();
  if (!npcName || !recipeName) {
    return { ok: false, detail: `主城中转「${city.mapName}」没填飞空艇 NPC / 对话配方(见城镇档案的「其它主城中转」)` };
  }
  ctx.sendLog('info', `[${label}] 主城中转:在「${city.mapName}」找飞空艇「${npcName}」传送到「${targetMapName}」`);
  return runNpcDeparture({
    ctx: opts.ctx,
    client: opts.client,
    size: opts.size,
    movement: opts.movement,
    readMapName: opts.readMapName,
    label,
    actionLabel: '主城中转',
    npcName,
    recipeName,
    points: appendTarget(city.waypoints ?? [], city.position),
    startMap: city.mapName,
    targetMapName,
    timeoutMs: opts.timeoutMs,
    moveOptions: opts.moveOptions,
    isStopped: opts.isStopped,
  });
}
