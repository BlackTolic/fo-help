// MapCrossing:沿「过图路线」档案逐跳穿越中间地图(挂机打怪开工 / 死亡返程的跨图赶路用)
//
// 背景:MovementController.moveTo 遇到「目标图与当前图不同」直接返回 false;跨图的搬运工是
// RouteTraveler.travelToExit(走过去 → 踩上出城口 → 轮询地图名等切图)。本模块把它串成"多跳":
//   - 每跳:读当前地图名 → 在链路里找到对应档案 → 按方向(去程/返程)取途经点与目标口
//   - 方向:目标下一站等于档案的 exit.toMap → 去程(正向走 waypoints);等于 entrance.toMap → 返程(反向)
//   - 途经点自己走(而不是交给 travelToExit):因为途经点可能挂 NPC —— 走到后先对话,对话成功才走下一个点
//   - 途经点走完再 travelToExit 走到出口并等切图;读到 targetMapName 即结束
//
// 只依赖原语(movement / readMapName / 档案数据)与注入的 NPC 交互回调,不依赖任何任务配置类型;与 RouteTraveler 同层。

import { createLogger } from '../logger';
import type { MapProfileNpc, MapProfileWaypoint } from '../../shared/types';
import { travelToExit } from './RouteTraveler';
import type { MapNameReader, RoutePoint, TravelOptions } from './RouteTraveler';
import type { MovementController } from './MovementController';

const log = createLogger('navigation.map-crossing');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 一张中间地图的过图档案(字段含义见 shared/types.ts 的 MapProfileConfig) */
export interface MapCrossingProfile {
  mapName: string;
  entrance: { position: RoutePoint; toMap: string };
  exit: { position: RoutePoint; toMap: string };
  /** 途经点(可挂 NPC);去程按原顺序、返程按反序 */
  waypoints: MapProfileWaypoint[];
}

export interface CrossMapOptions extends TravelOptions {
  /** 最多允许几跳(默认 profiles.length + 2);超过说明配置成环 */
  maxHops?: number;
  /** 读地图名的重试次数与间隔(OCR 偶发读空),默认 5 次 / 600ms */
  mapNameAttempts?: number;
  mapNameRetryMs?: number;
  /** 每成功切到一张新图后回调(如 farm 的「进入新地图屏蔽所有人」);第 1 张图由调用方自己处理 */
  onArriveMap?: (map: string) => void | Promise<void>;
  /** 途经点上的 NPC 交互(档案里该点配了 npc 时调用);返回 ok=false 会中断本次跨图 */
  runNpc?: (npc: MapProfileNpc) => Promise<{ ok: boolean; detail?: string }>;
}

export interface CrossMapResult {
  ok: boolean;
  detail: string;
  /** 结束时读到的地图名(null = 一直没读到) */
  map: string | null;
}

const DEFAULT_MAP_NAME_ATTEMPTS = 5;
const DEFAULT_MAP_NAME_RETRY_MS = 600;
/** 每一跳(走途经点 + 走到出口等切图)的兜底超时 */
const DEFAULT_HOP_TIMEOUT_MS = 120_000;

/** 读地图名并规整(空串 → null),带重试 */
async function readMapNameRetry(readMapName: MapNameReader, attempts: number, retryMs: number): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const name = String((await readMapName()) ?? '').trim();
    if (name) return name;
    if (i < attempts - 1) await sleep(retryMs);
  }
  return null;
}

/**
 * 沿 profiles 逐跳穿越,直到读到 targetMapName。
 *
 * @param movement    移动控制器(必须是 reader 带分辨率档位、能读地图名的那份,否则跨图守卫与切图轮询不生效)
 * @param readMapName 地图名读取函数
 * @param profiles    中间地图档案,按穿越顺序(不含出发城镇、不含目标图)
 * @param targetMapName 目标图名(挂机地图名)
 */
export async function crossMapProfiles(
  movement: MovementController,
  readMapName: MapNameReader,
  profiles: MapCrossingProfile[],
  targetMapName: string,
  opts?: CrossMapOptions,
): Promise<CrossMapResult> {
  const attempts = opts?.mapNameAttempts ?? DEFAULT_MAP_NAME_ATTEMPTS;
  const retryMs = opts?.mapNameRetryMs ?? DEFAULT_MAP_NAME_RETRY_MS;
  const hopTimeoutMs = opts?.timeoutMs ?? DEFAULT_HOP_TIMEOUT_MS;
  const maxHops = opts?.maxHops ?? profiles.length + 2;
  const chainDesc = [...profiles.map((p) => p.mapName), targetMapName].join(' → ');

  let cur = await readMapNameRetry(readMapName, attempts, retryMs);
  if (cur === null) {
    return { ok: false, detail: `连续 ${attempts} 次读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)`, map: null };
  }

  for (let hop = 0; hop < maxHops; hop++) {
    if (cur === targetMapName) return { ok: true, detail: `已到达「${targetMapName}」`, map: cur };
    if (opts?.isStopped?.() === true) return { ok: false, detail: '任务已停止,放弃跨图', map: cur };

    const idx = profiles.findIndex((p) => p.mapName === cur);
    if (idx < 0) {
      return { ok: false, detail: `当前在「${cur}」,不在过图链路上(链路:${chainDesc})`, map: cur };
    }
    const profile = profiles[idx];
    const next = profiles[idx + 1]?.mapName ?? targetMapName;

    let orderedWps: MapProfileWaypoint[];
    let portal: { position: RoutePoint; toMap: string };
    let dirLabel: string;
    if (profile.exit.toMap === next) {
      orderedWps = profile.waypoints;
      portal = profile.exit;
      dirLabel = '去程';
    } else if (profile.entrance.toMap === next) {
      orderedWps = [...profile.waypoints].reverse();
      portal = profile.entrance;
      dirLabel = '返程';
    } else {
      return {
        ok: false,
        detail:
          `「${cur}」的出口/入口都对不上下一站「${next}」` +
          `(出口→${profile.exit.toMap || '未填'},入口→${profile.entrance.toMap || '未填'};链路:${chainDesc})`,
        map: cur,
      };
    }

    log.info(
      `跨图:在「${cur}」按${dirLabel}走 ${orderedWps.length} 个途经点 → 口子 (${portal.position.x},${portal.position.y}) → 「${next}」`,
    );

    // 1) 依次走途经点:配了 NPC 的点,走到后先对话,对话成功才继续下一个点
    const deadline = Date.now() + hopTimeoutMs;
    for (let i = 0; i < orderedWps.length; i++) {
      if (opts?.isStopped?.() === true) return { ok: false, detail: '任务已停止(跨图途中)', map: cur };
      if (Date.now() >= deadline) {
        return { ok: false, detail: `穿越「${cur}」超时(${hopTimeoutMs} ms,未走完途经点)`, map: cur };
      }
      const wp = orderedWps[i];
      const arrived = await movement.moveTo({ map: cur, x: wp.x, y: wp.y }, opts?.moveOptions);
      opts?.onProgress?.(
        arrived
          ? `途经点 ${i + 1}/${orderedWps.length} (${wp.x},${wp.y}) 已到达`
          : `途经点 ${i + 1}/${orderedWps.length} (${wp.x},${wp.y}) 未到达,继续`,
      );

      if (wp.npc) {
        if (!opts?.runNpc) {
          return {
            ok: false,
            detail: `「${cur}」的途经点 (${wp.x},${wp.y}) 配了 NPC「${wp.npc.name}」,但当前流程不支持 NPC 交互`,
            map: cur,
          };
        }
        opts?.onProgress?.(`途经点 ${i + 1} 与 NPC「${wp.npc.name}」对话`);
        const talk = await opts.runNpc(wp.npc);
        if (!talk.ok) {
          return { ok: false, detail: `在「${cur}」与 NPC「${wp.npc.name}」对话失败:${talk.detail ?? '未知原因'}`, map: cur };
        }
      }
    }

    // 2) 途经点已自己走完,这里只走出口并等切图
    const ok = await travelToExit(movement, readMapName, [], portal.position, next, {
      timeoutMs: hopTimeoutMs,
      moveOptions: opts?.moveOptions,
      isStopped: opts?.isStopped,
      onProgress: opts?.onProgress,
    });
    if (!ok) {
      return {
        ok: false,
        detail: opts?.isStopped?.() === true ? '任务已停止(跨图途中)' : `穿越「${cur}」失败:没能走到出口并切到「${next}」`,
        map: cur,
      };
    }

    const after = await readMapNameRetry(readMapName, attempts, retryMs);
    if (after === null) return { ok: false, detail: `穿越「${cur}」后读不到地图名(OCR 失败)`, map: null };
    cur = after;
    await opts?.onArriveMap?.(after);
  }

  return { ok: false, detail: `跨图跳数超过 ${maxHops} 次(可能配置成环):最后停在「${cur}」`, map: cur };
}
