// 回城补给(resupply):确认位置 / 复活 → 检查耐久/药水 → (按需)找道具商人跑对话配方 → 前往挂机图
//
// 两个触发器(farm 侧注入 mode 区分,见 ResupplyOptions.mode):
//   death(缺省) = 死亡回城补给:复活 → 确认回到城镇 → 状态检查 → 商人 → 返程(触发点见 tasks/farm.ts 的 checkDeath)
//   start        = 开工补给:任务启动时跑一遍同一条流程(不复活;已在挂机地图则整段跳过,见 confirmStartPosition)
//   这里不判断"该不该补给",只负责把一次补给跑完并把结果(ok/detail)交回去。
//
// 依赖从 farm 侧注入(见 ResupplyDeps):dm client / 分辨率档位 / movement 实例 / 读地图名。
//   ⚠️ 不在这里新建 MovementController、也不重新 bindWindow:同一个窗口同一时刻只该有一个
//     移动控制器在操作鼠标 —— 复用 farm 主循环那个实例(否则两边抢鼠标、落点互相打架)。
//
// 配置来源(全部由 renderer 在 start-task 时下发):
//   taskConfig.resupply      开关 / 复活方式 / 超时 / 要检查什么 / 要不要开工补给
//   auxConfigs.townProfile   城镇档案(城镇地图名、商人、锚点路线、出城口)
//   auxConfigs.recipes       对话配方(按 npcKind='item-merchant' 取)
//   auxConfigs.farmMapName   回哪个野外图(与 exits[].toMap 对上;开工模式下也用它判断"已在挂机图")
//
// 中断:只认 ctx.moveAttack.running(stop 命令把它置 false),每个等待/每段行走之间都会检查;
//   pause 不阻塞本流程(pause 期间人卡在城镇更危险,补给一次跑完为止)。

import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import { isDead, findReviveButton } from '../../../../core/perception/DeathDetector';
import { isEquipmentDamaged } from '../../../../core/perception/EquipDamageDetector';
import { readPotionCount } from '../../../../core/perception/PotionCounter';
import { NpcDialog } from '../../../../core/perception/NpcDialog';
import { travelToExit, travelWithinMap } from '../../../../core/navigation/RouteTraveler';
import type { MovementController } from '../../../../core/navigation/MovementController';
import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import { sleep } from '../../../../core/utils/sleep';
import type { FarmResupplyConfig, TownProfileConfig, TownProfileNpc } from '../../../../shared/types';
import type { WorkerContext } from '../context';
import { runDialogRecipe } from './dialog-recipe';

/** 道具商人的 npc.kind(对话配方也按它取) */
const ITEM_MERCHANT_KIND = 'item-merchant';

/** 复活点锚点 id(与 shared/types.ts 的 TownProfileRoute.from 约定一致) */
const REVIVE_ANCHOR = 'revive';

/** 默认复活超时(ms):配置缺省时的兜底,与 renderer 的默认值保持一致 */
const DEFAULT_REVIVE_TIMEOUT_MS = 180_000;

/** 轮询/重试参数(防呆与容错,不是业务配置) */
const RESUPPLY = {
  /** 死亡弹框 / 复活状态轮询间隔(ms):一次 OCR 较慢,别太频繁 */
  pollMs: 500,
  /** 点「原地复活」前鼠标就位等待(ms) */
  clickSettleMs: 200,
  /** 点击复活后的稳定等待(ms):弹框收起 + 复活动画 */
  reviveSettleMs: 800,
  /** 地图名读取次数与间隔:OCR 偶发读空,连读几次再判 */
  mapNameAttempts: 5,
  mapNameRetryMs: 600,
  /** 走到附近后重试找 NPC 名字的次数与间隔(找字失败多半是还没走近/名字被 UI 挡住) */
  npcFindAttempts: 3,
  npcFindRetryMs: 800,
  /** 各段移动的兜底参数:卡住 15s 就放弃本点(比 MovementController 默认的 3 分钟短,别让补给拖死) */
  moveOptions: { arriveTolerance: 3, stepIntervalMs: 800, noMoveTimeoutMs: 15_000, moveEpsilon: 0.5 },
  /** 城内赶路 / 出城切图的整体超时(ms) */
  travelTimeoutMs: 120_000,
  /** 判定"路线终点已在目标附近"的容差(坐标单位):避免再走一次完全相同的点 */
  samePointTolerance: 5,
  /** 开工补给:当前位置离档案复活点超过这么多单位就提醒一句(地图坐标单位;只提醒,不阻断) */
  farFromReviveUnits: 30,
};

/** 清洗后的回城补给配置(farm 与补给流程共用同一份解析,见 resolveResupplyConfig) */
export interface ResolvedResupply {
  enabled: boolean;
  /** 城镇档案名(只用于日志:档案本体由 auxConfigs.townProfile 下发) */
  townProfileName: string;
  reviveMode: 'auto' | 'manual';
  reviveTimeoutMs: number;
  checkDurability: boolean;
  /** 红药低于该值触发购买;null = 不检查药水 */
  potionThreshold: number | null;
  /** 任务启动时先跑一次补给(只有 farm 主循环开工时读它,见 tasks/farm.ts 的 runStartupResupply) */
  runOnStart: boolean;
}

/** 补给流程的运行依赖(由 farm 侧注入实物) */
export interface ResupplyDeps {
  /** 该窗口的大漠入口(感知层 client,与 NpcDialog/DeathDetector 同一份) */
  client: DamooClient;
  /** 该窗口的分辨率档位:感知层区域常量按档位取 */
  size: WindowSizeKey;
  /** farm 主循环正在用的移动控制器(复用同一实例,不要新建) */
  movement: MovementController;
  /** 读当前地图名(OCR 中文名,读不到返回空串) */
  readMapName: () => Promise<string>;
}

export interface ResupplyOptions {
  /** 日志前缀(默认 '回城补给') */
  label?: string;
  /**
   * 触发模式(缺省 'death'):
   * - 'death' 死亡回城补给:先复活 → 确认在城镇,再走 状态检查 → 商人 → 返程
   * - 'start' 开工补给:任务启动时跑。不复活;先确认位置(已在挂机地图 = 整段跳过;
   *           不在城镇也不在挂机地图 = 直接失败),之后的 状态检查 → 商人 → 返程 完全复用
   */
  mode?: ResupplyMode;
}

/** 补给触发模式(见 ResupplyOptions.mode) */
export type ResupplyMode = 'death' | 'start';

export interface ResupplyResult {
  ok: boolean;
  detail?: string;
}

/**
 * 清洗回城补给配置:未配 / 字段缺失一律按"关闭 + 安全默认"处理
 * (enabled / runOnStart 缺省 false;reviveMode 缺省 auto;reviveTimeoutMs 缺省 180s;potionThreshold 非正数 = 不检查)
 * farm 的 resolveConfig 与补给流程都调它,避免两处默认值各写一套。
 */
export function resolveResupplyConfig(raw: FarmResupplyConfig | undefined | null): ResolvedResupply {
  const threshold = raw?.potionThreshold;
  const timeout = raw?.reviveTimeoutMs;
  return {
    enabled: raw?.enabled === true,
    townProfileName: String(raw?.townProfileName ?? '').trim(),
    reviveMode: raw?.reviveMode === 'manual' ? 'manual' : 'auto',
    reviveTimeoutMs: typeof timeout === 'number' && timeout >= 1000 ? Math.round(timeout) : DEFAULT_REVIVE_TIMEOUT_MS,
    checkDurability: raw?.checkDurability === true,
    potionThreshold: typeof threshold === 'number' && threshold > 0 ? Math.round(threshold) : null,
    runOnStart: raw?.runOnStart === true,
  };
}

/** 补给流程内部共用的上下文(把每个子步骤都要传的东西收在一起) */
interface ResupplyFlow {
  ctx: WorkerContext;
  deps: ResupplyDeps;
  label: string;
  /** 触发模式(决定要不要复活、位置怎么确认) */
  mode: ResupplyMode;
  cfg: ResolvedResupply;
  town: TownProfileConfig;
  farmMapName: string;
  /** 外部停止标志(stop 命令把 ctx.moveAttack.running 置 false) */
  stopped: () => boolean;
}

/**
 * 跑一次完整的补给(死亡回城 / 开工,见 ResupplyOptions.mode)。
 * 返回 ok=false 时 detail 是给用户看的原因(farm 会把它写进任务结束的 detail/日志)。
 */
export async function runResupplyFlow(ctx: WorkerContext, deps: ResupplyDeps, opts?: ResupplyOptions): Promise<ResupplyResult> {
  const label = opts?.label ?? '回城补给';
  const mode: ResupplyMode = opts?.mode ?? 'death';

  // 防重入:补给途中再触发一次(复活瞬间旧弹框还在、下次循环又判定死亡)直接拒绝,不递归
  if (ctx.resupply.running) {
    const detail = '上一次回城补给还没结束,忽略本次触发';
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }

  const cfg = resolveResupplyConfig(ctx.init.taskConfig?.resupply);
  const town: TownProfileConfig | undefined = ctx.init.auxConfigs?.townProfile;
  const farmMapName = String(ctx.init.auxConfigs?.farmMapName ?? '').trim();
  if (!cfg.enabled) {
    return { ok: false, detail: '回城补给未开启(taskConfig.resupply.enabled != true)' };
  }
  if (!town) {
    return { ok: false, detail: '缺少城镇档案(auxConfigs.townProfile 未下发),无法回城补给' };
  }

  ctx.resupply.running = true;
  // 开工模式不复活,状态文案直接说"确认位置"(第一步就是读地图名,见 confirmStartPosition)
  ctx.setStatus('resupply', `${label}:${mode === 'start' ? '确认位置' : cfg.reviveMode === 'auto' ? '自动复活' : '等待复活'}`);
  ctx.sendLog(
    'info',
    `[${label}] 开始(城镇=${town.mapName}${cfg.townProfileName ? `/${cfg.townProfileName}` : ''} ` +
      (mode === 'start' ? '开工:不复活' : `复活=${cfg.reviveMode} 复活超时=${Math.round(cfg.reviveTimeoutMs / 1000)}s`) +
      ` 检查:耐久=${cfg.checkDurability ? '是' : '否'} 药水=${cfg.potionThreshold ?? '不检查'})`,
  );

  const flow: ResupplyFlow = {
    ctx,
    deps,
    label,
    mode,
    cfg,
    town,
    farmMapName,
    stopped: () => !ctx.moveAttack.running,
  };

  let result: ResupplyResult = { ok: false, detail: '未执行' };
  try {
    result = await runResupplySteps(flow);
  } catch (e: any) {
    result = { ok: false, detail: `异常: ${e?.message ?? e}` };
  } finally {
    // 无论成功/失败/异常都要清掉标志,否则后续死亡再也触发不了补给
    ctx.resupply.running = false;
  }

  if (result.ok) {
    // 状态复位成"运行中":farm 主循环下一圈自己会再置 moving,这里给一个即时反馈
    ctx.setStatus('moving', mode === 'start' ? `${label}完成,开始挂机循环` : `${label}完成,继续挂机`);
    ctx.sendLog('info', `[${label}] ${result.detail ?? '完成'}`);
  } else {
    ctx.sendLog('warn', `[${label}] 失败:${result.detail ?? '未知原因'}`);
  }
  return result;
}

/** 主流程:复活(仅死亡模式) → 确认位置 → 状态检查 → (按需)商人 → 返程 */
async function runResupplySteps(flow: ResupplyFlow): Promise<ResupplyResult> {
  const { ctx, label, town, stopped, mode } = flow;

  if (mode === 'start') {
    // 开工补给:人一定活着(没有死亡弹框可等、也不能点原地复活),所以跳过第 1 步;
    // 但城镇档案里的路线都以复活点为起点锚点,得先确认角色到底站在哪张图(见 confirmStartPosition)
    ctx.setStatus('resupply', `${label}:确认位置`);
    // 确认位置:先读地图名,再确认是否在挂机地图(见 confirmStartPosition)
    const position = await confirmStartPosition(flow);
    if (!position.ok) return { ok: false, detail: position.detail };
    // 已在挂机地图:整段补给跳过 —— 没必要为了买药/修装备特意跑一趟城镇
    if (position.skipped) return { ok: true, detail: position.detail };
    if (stopped()) return { ok: false, detail: `任务已停止,放弃${label}` };
    // 位置离档案复活点太远只提醒不阻断:后面的寻路是"从当前位置按坐标走"(见 travelWithinMap)
    await warnIfFarFromRevivePoint(flow);
  } else {
    // 1) 复活
    const revived = await reviveCharacter(flow);
    if (!revived.ok) return revived;
    if (stopped()) return { ok: false, detail: '任务已停止,放弃回城补给' };

    // 2) 确认位置:复活点必须在本城镇(不等 = 档案配错城镇,后面所有路线坐标都没意义)
    ctx.setStatus('resupply', `${label}:确认位置`);
    const confirm = await confirmTownMap(flow);
    if (!confirm.matched) return { ok: false, detail: confirm.detail };
  }

  // 3) 状态检查:装备耐久 / 红药数量 —— 只有"装备红 或 药水低于阈值"才值得跑一趟商人
  ctx.setStatus('resupply', `${label}:检查状态`);
  const reasons = await inspectStatus(flow);
  if (stopped()) return { ok: false, detail: `任务已停止,放弃${label}` };

  let fromAnchor = REVIVE_ANCHOR;
  if (reasons.length === 0) {
    ctx.sendLog('info', `[${label}] 装备耐久与药水都没问题,不需要去商人,直接返程`);
  } else {
    const merchant = town.npcs.find((n) => n.kind === ITEM_MERCHANT_KIND);
    if (!merchant) {
      return {
        ok: false,
        detail: `城镇档案里没有 kind=${ITEM_MERCHANT_KIND} 的 NPC(触发原因:${reasons.join('、')}),无法补给`,
      };
    }
    const visit = await visitMerchant(flow, merchant, reasons);
    if (!visit.ok) return visit;
    fromAnchor = merchant.id;
  }

  // 4) 返程:出城口 → 等切回挂机图
  return travelBackToFarm(flow, fromAnchor);
}

/**
 * 复活:
 *   auto   = 等死亡弹框出现 → 找「原地复活」并点击 → 等弹框消失(复活生效)
 *   manual = 不点任何东西,只等玩家自己复活(死亡弹框消失)
 * 两种模式的总等待都不超过 cfg.reviveTimeoutMs,超时返回失败(交回 farm 结束任务)。
 */
async function reviveCharacter(flow: ResupplyFlow): Promise<ResupplyResult> {
  const { ctx, deps, label, cfg, stopped } = flow;
  const { client, size } = deps;
  const deadline = Date.now() + cfg.reviveTimeoutMs;
  const timeoutSec = Math.round(cfg.reviveTimeoutMs / 1000);

  if (cfg.reviveMode === 'auto') {
    // 等死亡弹框出现:从"检测到死亡"到流程启动之间隔着几次 OCR/命令往返,弹框可能还在淡入
    const dialogUp = await pollUntilDeadline(() => isDead(client, size), deadline, RESUPPLY.pollMs, stopped);
    if (!dialogUp) {
      return {
        ok: false,
        detail: stopped() ? '任务已停止,放弃复活' : `${timeoutSec}s 内没读到死亡弹框(「死亡」标题),无法自动复活`,
      };
    }

    ctx.sendLog('info', `[${label}] 检测到死亡弹框,找「原地复活」按钮`);
    let clicked = false;
    while (Date.now() < deadline) {
      if (stopped()) return { ok: false, detail: '任务已停止,放弃复活' };
      const btn = findReviveButton(client, size);
      if (btn) {
        client.moveTo(btn.x, btn.y);
        await sleep(RESUPPLY.clickSettleMs);
        client.leftClick();
        clicked = true;
        ctx.sendLog('info', `[${label}] 已点击「原地复活」@(${btn.x},${btn.y})`);
        break;
      }
      // 按钮文字可能还没渲染出来:继续轮询到超时
      await sleep(RESUPPLY.pollMs);
    }
    if (!clicked) {
      return { ok: false, detail: `${timeoutSec}s 内没找到「原地复活」按钮(核对 REVIVE_TEXT_ROI 的区域/颜色)` };
    }
    await sleep(RESUPPLY.reviveSettleMs);
  } else {
    ctx.sendLog('info', `[${label}] 复活方式=manual:等待玩家自行复活(最多 ${timeoutSec}s)`);
  }

  // 等复活生效:死亡弹框消失(manual 模式等价于"等玩家点了复活")
  const alive = await pollUntilDeadline(() => !isDead(client, size), deadline, RESUPPLY.pollMs, stopped);
  if (!alive) {
    return {
      ok: false,
      detail: stopped() ? '任务已停止,放弃复活' : `${timeoutSec}s 内仍是死亡状态(复活失败)`,
    };
  }
  ctx.sendLog('info', `[${label}] 已复活`);
  return { ok: true };
}

/** 地图名确认结果 */
interface TownConfirm {
  matched: boolean;
  detail: string;
}

/**
 * 确认当前地图 = 城镇档案的 mapName。
 * OCR 偶发读空很常见 → 连读 mapNameAttempts 次(每次间隔 mapNameRetryMs),读到非空就比对;
 * 全程读空或一直不符才返回失败(带上最后一次读到的值,便于分辨"没读到"还是"读错了")。
 */
async function confirmTownMap(flow: ResupplyFlow): Promise<TownConfirm> {
  const { ctx, deps, label, town } = flow;
  let last = '';

  for (let i = 0; i < RESUPPLY.mapNameAttempts; i++) {
    const name = String((await deps.readMapName()) ?? '').trim();
    if (name) {
      if (name === town.mapName) return { matched: true, detail: `已在「${name}」` };
      last = name;
      ctx.sendLog(
        'warn',
        `[${label}] 地图名读到「${name}」,与城镇档案「${town.mapName}」不符(第 ${i + 1}/${RESUPPLY.mapNameAttempts} 次),重读`,
      );
    } else {
      ctx.sendLog('warn', `[${label}] 地图名 OCR 读空(第 ${i + 1}/${RESUPPLY.mapNameAttempts} 次),重读`);
    }
    await sleep(RESUPPLY.mapNameRetryMs);
  }

  return {
    matched: false,
    detail: last
      ? `当前地图「${last}」与城镇档案「${town.mapName}」不符(复活点可能不在本城镇,或档案里的地图名没配对)`
      : `连续 ${RESUPPLY.mapNameAttempts} 次读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)`,
  };
}

/** 开工补给的位置确认结果 */
interface StartPositionConfirm {
  ok: boolean;
  /** true = 已在挂机地图:整个补给流程到此结束(不找商人、不返程),detail 带说明 */
  skipped?: boolean;
  detail: string;
}

/**
 * 开工补给的位置确认(替代死亡模式的「复活 + confirmTownMap」):
 *   已在挂机地图 → skipped:用户就是从挂机图里点的启动,没必要特意跑一趟城镇;
 *   已在城镇     → 继续往下走(状态检查 → 商人 → 返程);
 *   两者都不是   → 失败:角色既不在商人/出城口的锚点地图里,后面所有路线坐标都无从谈起。
 * 地图名 OCR 偶发读空,沿用 confirmTownMap 的重读次数与间隔。
 */
async function confirmStartPosition(flow: ResupplyFlow): Promise<StartPositionConfirm> {
  const { ctx, deps, label, town, farmMapName } = flow;
  let last = '';

  for (let i = 0; i < RESUPPLY.mapNameAttempts; i++) {
    const name = String((await deps.readMapName()) ?? '').trim();
    if (name) {
      // 已在挂机地图:地图名与 farmMapName 对上就算命中(没有 farmMapName 时这条判断跳过,只能按城镇判)
      if (farmMapName && name === farmMapName) {
        return { ok: true, skipped: true, detail: `已在挂机地图「${name}」,跳过开工补给` };
      }
      if (name === town.mapName) return { ok: true, detail: `已在城镇「${name}」` };
      last = name;
      ctx.sendLog(
        'warn',
        `[${label}] 地图名读到「${name}」,不在城镇「${town.mapName}」${farmMapName ? `也不在挂机地图「${farmMapName}」` : ''}` +
          `(第 ${i + 1}/${RESUPPLY.mapNameAttempts} 次),重读`,
      );
    } else {
      ctx.sendLog('warn', `[${label}] 地图名 OCR 读空(第 ${i + 1}/${RESUPPLY.mapNameAttempts} 次),重读`);
    }
    await sleep(RESUPPLY.mapNameRetryMs);
  }

  const elsewhere = farmMapName ? `也不在挂机地图「${farmMapName}」` : '';
  return {
    ok: false,
    detail: last
      ? `当前不在城镇「${town.mapName}」(读到「${last}」)${elsewhere},无法导航到商人/挂机点(开工补给需要角色站在城镇里再启动任务)`
      : `连续 ${RESUPPLY.mapNameAttempts} 次读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)`,
  };
}

/**
 * 开工补给在城镇里时:比一下当前坐标与档案里的复活点。
 * 城镇档案的路线锚点是复活点(见 REVIVE_ANCHOR),起点离它太远时途经点可能一路走不到;
 * 这里只 warn 不阻断 —— 后面每段寻路都是从当前位置按坐标走,走得到就走得到。
 */
async function warnIfFarFromRevivePoint(flow: ResupplyFlow): Promise<void> {
  const { ctx, deps, label, town } = flow;
  const pos = await deps.movement.readPosition();
  if (!pos) return;

  const dist = Math.hypot(pos.x - town.revivePoint.x, pos.y - town.revivePoint.y);
  if (dist <= RESUPPLY.farFromReviveUnits) return;
  ctx.sendLog(
    'warn',
    `[${label}] 当前位置 (${pos.x},${pos.y}) 离城镇档案复活点 (${town.revivePoint.x},${town.revivePoint.y}) 约 ${Math.round(dist)} 个单位:` +
      `路线锚点是复活点,若去商人/出城口途中走不到,先把角色停到复活点附近再启动任务`,
  );
}

/** 状态检查:返回触发补给的原因(空数组 = 不需要去商人) */
async function inspectStatus(flow: ResupplyFlow): Promise<string[]> {
  const { ctx, deps, label, cfg } = flow;
  const { client, size } = deps;
  const reasons: string[] = [];

  if (cfg.checkDurability) {
    // isEquipmentDamaged 自己负责开/关角色面板(C → 检测 → Esc)
    const damaged = await isEquipmentDamaged(client, size);
    ctx.sendLog('info', `[${label}] 装备耐久检查:${damaged ? '有装备见底(需要修理)' : '正常'}`);
    if (damaged) reasons.push('装备耐久见底');
  }

  if (cfg.potionThreshold !== null) {
    const count = readPotionCount(client, size);
    if (count === null) {
      // 读不到按"不触发"处理:宁可少跑一趟,也不要因为一次 OCR 抖动白跑(日志里留痕)
      ctx.sendLog('warn', `[${label}] 红药数量读不到(OCR 失败),本次跳过药水检查(核对药水数量区域/颜色)`);
    } else {
      ctx.sendLog('info', `[${label}] 红药数量 ${count}(阈值 ${cfg.potionThreshold})`);
      if (count < cfg.potionThreshold) reasons.push(`红药 ${count} < 阈值 ${cfg.potionThreshold}`);
    }
  }

  return reasons;
}

/**
 * 去道具商人并执行对话配方:
 *   1. 按城镇档案路线走到商人附近(没有路线 = 直接从当前位置走过去);
 *   2. 到了以后用 findNpc 找字精确定位(路线只负责"走近",最终点击以找字为准),找不到重试几次;
 *   3. openDialog 必须成功(用 '@X' 关闭钮反查);
 *   4. 按 npcKind='item-merchant' 取对话配方执行,跑完/失败都兜底关窗。
 */
async function visitMerchant(flow: ResupplyFlow, merchant: TownProfileNpc, reasons: string[]): Promise<ResupplyResult> {
  const { ctx, deps, label, town, stopped } = flow;
  const { client, size, movement } = deps;

  const route = resolveRoute(town, REVIVE_ANCHOR, merchant.id);
  const points = appendTarget(route, merchant.position);
  ctx.sendLog(
    'info',
    `[${label}] 触发补给(${reasons.join('、')}) → 去「${merchant.name}」(${merchant.position.x},${merchant.position.y})` +
      (route.length > 0 ? `,途经 ${route.length} 个点` : ',没配路线,直接从当前位置走过去'),
  );

  const arrived = await travelWithinMap(movement, points, {
    timeoutMs: RESUPPLY.travelTimeoutMs,
    moveOptions: RESUPPLY.moveOptions,
    isStopped: stopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (stopped()) return { ok: false, detail: '任务已停止(去商人的路上)' };
  if (!arrived) {
    // 没走到不算失败:找字可能仍能命中(途经点卡住但人已经在附近),交给下面的 findNpc 决定
    ctx.sendLog('warn', `[${label}] 有途经点没走到,继续尝试找 NPC「${merchant.name}」`);
  }

  const dialog = new NpcDialog(client, size);
  // 找字精确定位:路线只负责"走近",最终点击以找字为准,找不到重试几次
  let pos = await dialog.findNpc(merchant.name);
  for (let i = 1; !pos && i < RESUPPLY.npcFindAttempts; i++) {
    ctx.sendLog('warn', `[${label}] 没找到 NPC「${merchant.name}」,重试 ${i + 1}/${RESUPPLY.npcFindAttempts}`);
    await sleep(RESUPPLY.npcFindRetryMs);
    pos = await dialog.findNpc(merchant.name);
  }
  if (!pos) {
    return {
      ok: false,
      detail: `走到商人附近后仍找不到 NPC「${merchant.name}」(核对城镇档案里的 NPC 名字/坐标,以及绿色字扫描区 NPC_SCAN_BOX)`,
    };
  }
  ctx.sendLog('info', `[${label}] 找到 NPC「${merchant.name}」@(${pos.x},${pos.y}),打开对话`);

  if (!(await dialog.openDialog(pos))) {
    return {
      ok: false,
      detail: `打开「${merchant.name}」的对话失败(没读到 '@X' 关闭钮:对话框没弹出,或 DIALOG_CLOSE_BTN 的区域/颜色没配对)`,
    };
  }

  // 执行对话配方
  const recipe = (ctx.init.auxConfigs?.recipes ?? []).find((r) => r.npcKind === ITEM_MERCHANT_KIND);

  console.log(`visitMerchant ${merchant.name} ${JSON.stringify(recipe)}`);

  if (!recipe) {
    await dialog.closeDialog();
    return {
      ok: false,
      detail: `auxConfigs.recipes 里没有 npcKind=${ITEM_MERCHANT_KIND} 的对话配方(修理/买药步骤无处可取)`,
    };
  }

  const recipeResult = await runDialogRecipe({ ctx, client, dialog, label }, recipe);
  // 兜底关窗:配方跑完或中途失败都别把对话框留在屏幕上(否则后续移动点击都会先点到对话)
  await dialog.closeDialog();
  return recipeResult.ok ? { ok: true } : { ok: false, detail: recipeResult.detail };
}

/** 返程:按路线走到出城口,等游戏切回挂机图 */
async function travelBackToFarm(flow: ResupplyFlow, fromAnchor: string): Promise<ResupplyResult> {
  const { ctx, deps, label, town, farmMapName, stopped } = flow;

  if (!farmMapName) {
    return { ok: false, detail: '缺少 auxConfigs.farmMapName(挂机地图名),不知道要回哪张野外图' };
  }
  const exit = town.exits.find((e) => e.toMap === farmMapName);
  if (!exit) {
    return { ok: false, detail: `城镇档案里没有去「${farmMapName}」的出口(需要一条 exits[].toMap 与挂机地图名一致)` };
  }

  const points = resolveRoute(town, fromAnchor, exit.id);
  ctx.setStatus('resupply', `${label}:返程`);
  ctx.sendLog('info', `[${label}] 返程:${points.length} 个途经点 → 出城口 (${exit.position.x},${exit.position.y}) → 「${farmMapName}」`);

  const ok = await travelToExit(deps.movement, () => deps.readMapName(), points, exit.position, farmMapName, {
    timeoutMs: RESUPPLY.travelTimeoutMs,
    moveOptions: RESUPPLY.moveOptions,
    isStopped: stopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (!ok) {
    return {
      ok: false,
      detail: stopped() ? '任务已停止(返程途中)' : `返程失败:没能走到出城口并切回「${farmMapName}」(核对城镇档案的出口坐标与路线)`,
    };
  }
  return { ok: true, detail: `已切回「${farmMapName}」,${label}完成` };
}

/**
 * 锚点间路线解析(纯函数):
 *   1. 优先直接路线(from → to)
 *   2. 其次反向路线(to → from)的 waypoints 反序 —— 档案里只配一个方向是常态
 *   3. 都没有 → 空数组:调用方退化成"直接从当前位置走过去"(见 appendTarget)
 */
function resolveRoute(profile: TownProfileConfig, fromAnchor: string, toAnchor: string): { x: number; y: number }[] {
  const direct = profile.routes.find((r) => r.from === fromAnchor && r.to === toAnchor);
  if (direct) return direct.waypoints.map((p) => ({ x: p.x, y: p.y }));

  const reverse = profile.routes.find((r) => r.from === toAnchor && r.to === fromAnchor);
  if (reverse) return [...reverse.waypoints].reverse().map((p) => ({ x: p.x, y: p.y }));

  return [];
}

/** 路线 + 目标点:途经点只负责"到附近",最后再走一次目标点本身(已在目标附近就不重复走) */
function appendTarget(route: { x: number; y: number }[], target: { x: number; y: number }): { x: number; y: number }[] {
  const last = route[route.length - 1];
  if (last && Math.hypot(last.x - target.x, last.y - target.y) <= RESUPPLY.samePointTolerance) return route;
  return [...route, { x: target.x, y: target.y }];
}

/**
 * 轮询 cond 直到为真;到绝对截止时间 / 外部停止返回 false。
 * 先判 cond 再判超时:"当前已经满足"(如复活弹框已经不在)要立刻通过,不白等一轮。
 */
async function pollUntilDeadline(cond: () => boolean, deadline: number, intervalMs: number, isStopped?: () => boolean): Promise<boolean> {
  while (true) {
    if (cond()) return true;
    if (isStopped?.()) return false;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
