// 回城补给(resupply):确认位置 / 复活 → 检查耐久/药水 → (按需)按档案顺序访问 NPC 跑对话配方 → 前往挂机图
//
// 两个触发器(farm 侧注入 mode 区分,见 ResupplyOptions.mode):
//   death(缺省) = 死亡回城补给:复活 → 确认回到城镇 → 状态检查 → 访问 NPC → 返程(触发点见 tasks/farm.ts 的 checkDeath)
//   start        = 开工补给:任务启动时跑一遍同一条流程(不复活;已在挂机地图则整段跳过,见 confirmStartPosition)
//   这里不判断"该不该补给",只负责把一次补给跑完并把结果(ok/detail)交回去。
//
// 依赖从 farm 侧注入(见 ResupplyDeps):dm client / 分辨率档位 / movement 实例 / 读地图名。
//   ⚠️ 不在这里新建 MovementController、也不重新 bindWindow:同一个窗口同一时刻只该有一个
//     移动控制器在操作鼠标 —— 复用 farm 主循环那个实例(否则两边抢鼠标、落点互相打架)。
//
// 配置来源(全部由 renderer 在 start-task 时下发):
//   taskConfig.resupply      开关 / 复活方式(立即复活 / 回魂娃娃 / 替身娃娃) / 超时 / 要检查什么 / 要不要开工补给
//   auxConfigs.townProfile   城镇档案(城镇地图名、NPC 列表、锚点路线、出城口)
//   auxConfigs.recipes       全部对话配方;每个 NPC 用它的 recipeName 指名要跑哪一份(见 shared/types.ts)
//   auxConfigs.farmMapName   回哪个野外图(与 exits[].toMap 对上;开工模式下也用它判断"已在挂机图")
//
// 中断:只认 ctx.moveAttack.running(stop 命令把它置 false),每个等待/每段行走之间都会检查;
//   pause 不阻塞本流程(pause 期间人卡在城镇更危险,补给一次跑完为止)。

import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import { detectDeath, isDead } from '../../../../core/perception/DeathDetector';
import type { DeathSignal } from '../../../../core/perception/DeathDetector';
import type { Point } from '../../../../core/platform/vision/IVisionProvider';
import type { IInputProvider } from '../../../../core/platform/input/IInputProvider';
import { isEquipmentDamaged } from '../../../../core/perception/EquipDamageDetector';
import { readPotionCount } from '../../../../core/perception/PotionCounter';
import { resolveAnchoredRoute, travelWithinMap } from '../../../../core/navigation/RouteTraveler';
import { crossMapProfiles } from '../../../../core/navigation/MapCrossing';
import type { MapCrossingProfile } from '../../../../core/navigation/MapCrossing';
import type { MovementController } from '../../../../core/navigation/MovementController';
import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import { REVIVE_BUTTON_POS, REVIVE_CANCEL_CASH_POS, REVIVE_MODE_LABEL } from '../../../../core/constant-ocr/death';
import { sleep } from '../../../../core/utils/sleep';
import type { FarmResupplyConfig, FarmReviveMode, TownProfileConfig, TownProfileNpc } from '../../../../shared/types';
import type { WorkerContext } from '../context';
import { mountPet } from '../pet-ride';
import type { ResolvedPetRide } from '../pet-ride';
import { talkToNpc } from './talk-npc';
import { departTownTo } from './town-departure';

/** 复活点锚点 id(与 shared/types.ts 的 TownProfileRoute.from 约定一致) */
export const REVIVE_ANCHOR = 'revive';

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
  /** 复活方式(见 shared/types.ts 的 FarmReviveMode) */
  reviveMode: FarmReviveMode;
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
  /** farm 主循环正在用的输入模拟(复用同一实例;上骑/下骑按技能键用) */
  input: IInputProvider;
  /** 宠物骑乘配置(回到城里检查宠物激活并上骑;缺省关闭,见 shared/types.ts 的 FarmPetRideConfig) */
  petRide: ResolvedPetRide;
  /** 读当前地图名(OCR 中文名,读不到返回空串) */
  readMapName: () => Promise<string>;
  /**
   * 入图路径点(挂机地图坐标,按顺序;空 = 不配):
   * 返程切回挂机地图后,角色只是落在入口,离挂机点还有一段路(地形/走廊挡着,直线走会被卡住),
   * 沿这些点走过去再恢复挂机循环。来自 farm 的 type='entry' 路径点。
   */
  entryPath?: { x: number; y: number }[];
  /**
   * 地图跨越链路(中间地图档案,按穿越顺序;空 = 不跨图,直接返程回挂机图):
   * 返程时先走城镇出口到链首那张图,再逐跳穿越到挂机图(见 core/navigation/MapCrossing.ts)。
   * 来自 farm 的 mapCrossings(renderer 已按顺序解析成 auxConfigs.mapProfiles)。
   */
  mapProfiles?: MapCrossingProfile[];
  /**
   * 换图检查回调(可选):补给流程每次确认"角色到达一张新图"就调它一次
   * (死亡重生回到城镇 / 返程切回挂机图 / 跨图链每穿过一张中间图)。
   * 是否真的换图、要不要按屏蔽快捷键由 farm 侧统一判断(见 tasks/farm.ts 的 blockAllPlayersIfMapChanged)。
   */
  onMapMaybeChanged?: () => Promise<void>;
}

export interface ResupplyOptions {
  /** 日志前缀(默认 '回城补给') */
  label?: string;
  /**
   * 触发模式(缺省 'death'):
   * - 'death' 死亡回城补给:先复活 → 确认在城镇,再走 状态检查 → 访问 NPC → 返程
   * - 'start' 开工补给:任务启动时跑。不复活;先确认位置(已在挂机地图 = 整段跳过;
   *           不在城镇也不在挂机地图 = 直接失败),之后的 状态检查 → 访问 NPC → 返程 完全复用
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
 * 复活方式清洗:只认三种新值,其余(含旧配置的 'auto' / 'manual' 与未配)一律回退 immediate。
 * 与 renderer 的 FarmResupplySection.normalizeReviveMode 保持同一套迁移规则。
 */
function normalizeReviveMode(raw: unknown): FarmReviveMode {
  return raw === 'huihun' || raw === 'tishen' || raw === 'immediate' ? raw : 'immediate';
}

/**
 * 清洗回城补给配置:未配 / 字段缺失一律按"关闭 + 安全默认"处理
 * (enabled / runOnStart 缺省 false;reviveMode 缺省 immediate;reviveTimeoutMs 缺省 180s;potionThreshold 非正数 = 不检查)
 * farm 的 resolveConfig 与补给流程都调它,避免两处默认值各写一套。
 */
export function resolveResupplyConfig(raw: FarmResupplyConfig | undefined | null): ResolvedResupply {
  const threshold = raw?.potionThreshold;
  const timeout = raw?.reviveTimeoutMs;
  return {
    // 是否开启回城补给(缺省 false):
    enabled: raw?.enabled === true,
    // 城镇档案名(只用于日志:档案本体由 auxConfigs.townProfile 下发)
    townProfileName: String(raw?.townProfileName ?? '').trim(),
    // 复活模式(缺省 immediate):旧配置的 'auto'(原地复活)迁到 immediate,'manual'(等玩家复活)已取消也迁到 immediate
    reviveMode: normalizeReviveMode(raw?.reviveMode),
    // 复活超时(ms):配置缺省时的兜底,与 renderer 的默认值保持一致
    reviveTimeoutMs: typeof timeout === 'number' && timeout >= 1000 ? Math.round(timeout) : DEFAULT_REVIVE_TIMEOUT_MS,
    // 是否检查装备耐久见底(缺省 false):
    checkDurability: raw?.checkDurability === true,
    // 红药低于该值触发购买;null = 不检查药水
    potionThreshold: typeof threshold === 'number' && threshold > 0 ? Math.round(threshold) : null,
    // 任务启动时先跑一次补给(只有 farm 主循环开工时读它,见 tasks/farm.ts 的 runStartupResupply)
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
  //
  const mode: ResupplyMode = opts?.mode ?? 'death';

  // 防重入:补给途中再触发一次(复活瞬间旧弹框还在、下次循环又判定死亡)直接拒绝,不递归
  if (ctx.resupply.running) {
    const detail = '上一次回城补给还没结束,忽略本次触发';
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }

  // 解析配置
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
  ctx.setStatus('resupply', `${label}:${mode === 'start' ? '确认位置' : REVIVE_MODE_LABEL[cfg.reviveMode]}`);
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
    // 主流程:复活(仅死亡模式) → 确认位置 → 状态检查 → (按需)访问 NPC → 返程
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

/** 主流程:复活(仅死亡模式) → 确认位置 → 状态检查 → (按需)访问 NPC → 返程 */
async function runResupplySteps(flow: ResupplyFlow): Promise<ResupplyResult> {
  const { ctx, deps, label, town, stopped, mode } = flow;
  // 开工模式不复活,状态文案直接说"确认位置"(第一步就是读地图名,见 confirmStartPosition)
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
    // 人在城镇:检查宠物是否激活并上骑,骑着回挂机图更快(到挂机点主循环再下骑)
    await mountPetOnCity(flow);
  } else {
    // 1) 复活
    const revived = await reviveCharacter(flow);
    if (!revived.ok) return revived;
    if (stopped()) return { ok: false, detail: '任务已停止,放弃回城补给' };

    // 2) 确认位置:复活点必须在本城镇(不等 = 档案配错城镇,后面所有路线坐标都没意义)
    ctx.setStatus('resupply', `${label}:确认位置`);
    const confirm = await confirmTownMap(flow);
    if (!confirm.matched) return { ok: false, detail: confirm.detail };
    // 死亡重生把角色从野外送回了城镇 = 换图:让 farm 侧按开关决定要不要重新屏蔽所有人
    await deps.onMapMaybeChanged?.();
    // 回到城里:检查宠物是否激活并上骑(见 pet-ride.ts)
    await mountPetOnCity(flow);
  }

  // 3) 状态检查:装备耐久 / 红药数量 —— 只有"装备红 或 药水低于阈值"才值得跑一趟商人
  ctx.setStatus('resupply', `${label}:检查状态`);
  // 检查装备耐久/药水是否需要补给
  const reasons = await inspectStatus(flow);
  if (stopped()) return { ok: false, detail: `任务已停止,放弃${label}` };

  let fromAnchor = REVIVE_ANCHOR;
  // 按档案里的顺序访问所有"引用了对话配方"的 NPC;没引用的只当路线锚点
  const targets = town.npcs.filter((n) => (n.recipeName ?? '').trim());
  if (reasons.length === 0) {
    ctx.sendLog('info', `[${label}] 装备耐久与药水都没问题,不访问任何 NPC,直接返程`);
  } else if (targets.length === 0) {
    return {
      ok: false,
      detail: `触发了补给(${reasons.join('、')}),但城镇档案里没有任何 NPC 引用对话配方,不知道该做什么`,
    };
  } else {
    ctx.sendLog(
      'info',
      `[${label}] 触发补给(${reasons.join('、')}) → 计划访问 ${targets.length} 个 NPC:${targets.map((n) => n.name).join(' → ')}`,
    );
    for (const npc of targets) {
      const visit = await visitNpc(flow, npc, fromAnchor);
      if (!visit.ok) return visit;
      fromAnchor = npc.id;
    }
  }

  // 4) 返程:出城口 → 等切回挂机图
  return travelBackToFarm(flow, fromAnchor);
}

/**
 * 回到城里后的宠物骑乘:检查宠物是否激活 → 释放「上骑」技能(最多 3 次,见 pet-ride.ts)。
 * 成功骑上时把 ctx.petMounted 置位,挂机主循环到达挂机点后会据此释放「下骑」再开始打怪。
 * 骑乘未开启 / 宠物未激活(会先自动激活)/ 上骑失败都只是记日志,不阻断补给流程。
 */
async function mountPetOnCity(flow: ResupplyFlow): Promise<void> {
  const { ctx, deps, label } = flow;
  if (!deps.petRide.enabled) return;
  ctx.setStatus('resupply', `${label}:上骑`);
  ctx.petMounted = await mountPet(ctx, deps, deps.petRide, label);
}

/**
 * 复活:等死亡弹框出现 → 点掉「彩玉」勾选(避免消耗付费道具)→ 点配置的复活按钮
 * (立即复活 / 回魂娃娃 / 替身娃娃,坐标见 core/constant-ocr/death.ts 的 REVIVE_BUTTON_POS)→ 等弹框消失。
 * 总等待不超过 cfg.reviveTimeoutMs,超时返回失败(交回 farm 结束任务)。
 *
 * 判死复用 detectDeath(见 core/perception/DeathDetector):找字「原地复活」既证明弹框在、
 * 又说明按钮已经渲染出来(拿到它的坐标才动手,避免弹框还在淡入就点空)。
 * 点击位置不用找字得到的坐标,而是按复活方式取固定按钮坐标 —— 三个按钮只有一处不同,固定值最省识别。
 */
async function reviveCharacter(flow: ResupplyFlow): Promise<ResupplyResult> {
  const { ctx, deps, label, cfg, stopped } = flow;
  const { client, size } = deps;
  const deadline = Date.now() + cfg.reviveTimeoutMs;
  const timeoutSec = Math.round(cfg.reviveTimeoutMs / 1000);

  // 当前分辨率的复活按钮坐标:没实测过 1600*900,缺了就报错结束,不拿别的档位坐标乱点
  const buttons = REVIVE_BUTTON_POS[size];
  if (!buttons) {
    return { ok: false, detail: `当前分辨率 ${size} 没有配置复活按钮坐标(见 core/constant-ocr/death.ts),无法自动复活` };
  }
  const button = buttons[cfg.reviveMode];

  // 等死亡弹框 + 按钮出现:从"检测到死亡"到流程启动之间隔着几次 OCR/命令往返,弹框可能还在淡入
  let revive: Point | undefined;
  /** 命中的信号(日志用);null = 到超时为止两个信号都没命中 */
  let via: DeathSignal | null = null;
  while (Date.now() < deadline) {
    if (stopped()) return { ok: false, detail: '任务已停止,放弃复活' };
    const death = detectDeath(client, size);
    if (death.dead) {
      via = death.via;
      // 找字命中就带坐标,拿到即动手;只有标题 OCR 兜底命中(没有坐标)时继续轮询到拿到坐标为止
      if (death.revive) {
        revive = death.revive;
        break;
      }
    }
    await sleep(RESUPPLY.pollMs);
  }
  if (!via) {
    return {
      ok: false,
      detail: stopped()
        ? '任务已停止,放弃复活'
        : `${timeoutSec}s 内没读到死亡弹框(找字「原地复活」和 OCR「死亡」标题都没命中),无法自动复活`,
    };
  }
  if (!revive) {
    return { ok: false, detail: `${timeoutSec}s 内没找到「原地复活」按钮(核对 REVIVE_TEXT_ROI 的区域/颜色)` };
  }

  ctx.sendLog(
    'info',
    `[${label}] 检测到死亡弹框(${via === 'revive-text' ? '找字「原地复活」' : 'OCR「死亡」标题'}命中),复活方式=「${REVIVE_MODE_LABEL[cfg.reviveMode]}」`,
  );

  // 1) 先点掉「彩玉」勾选:不点掉默认会用彩玉复活,消耗付费道具(旧逻辑就有的这一步)
  const cancelCash = REVIVE_CANCEL_CASH_POS[size];
  if (cancelCash) {
    client.moveTo(cancelCash.x, cancelCash.y);
    await sleep(400);
    client.leftClick();
  }

  // 2) 点配置的复活按钮
  ctx.sendLog('info', `[${label}] 点「${REVIVE_MODE_LABEL[cfg.reviveMode]}」@(${button.x},${button.y})`);
  client.moveTo(button.x, button.y);
  await sleep(RESUPPLY.clickSettleMs);
  client.leftClick();
  await sleep(RESUPPLY.reviveSettleMs);

  // 等复活生效:死亡弹框消失
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
 *   已在过图链路 → skipped:不在城镇没商人可找,交给 farm 的「地图跨越」直接前进;
 *   已在城镇     → 继续往下走(状态检查 → 商人 → 返程);
 *   以上都不是   → skipped:交给 farm 的「地图跨越/回城卷轴」处理(只有它知道出发城镇与回城卷轴)。
 * 只有地图名连续读不到才失败(OCR 失败时无从判断起点)。
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
      // 已在过图链路上:不补给了(不在城镇,没商人可找),跳过开工补给,交给 farm 的「地图跨越」直接前进
      if ((deps.mapProfiles ?? []).some((p) => p.mapName === name)) {
        return { ok: true, skipped: true, detail: `已在过图链路「${name}」上,跳过开工补给,直接按「地图跨越」前往挂机图` };
      }
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

  // 读到地图名、但既不在城镇也不在挂机图/过图链路:开工补给无从下手 → 跳过它,
  // 交给 farm 的「地图跨越」(它掌握出发城镇 / 回城卷轴 / 主城中转,能把角色带到挂机图)。
  // 不能在这里直接判失败:否则「从任意地图启动 + 回城卷轴自动回城」会被开工补给提前打死。
  const elsewhere = farmMapName ? `也不在挂机地图「${farmMapName}」` : '';
  if (last) {
    return {
      ok: true,
      skipped: true,
      detail: `当前在「${last}」(不在城镇「${town.mapName}」${elsewhere}),跳过开工补给,交给「地图跨越/回城卷轴」前往挂机图`,
    };
  }
  return { ok: false, detail: `连续 ${RESUPPLY.mapNameAttempts} 次读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)` };
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
    // isEquipmentDamaged 自己负责开/关人物面板(Alt+C,见 shared/game-hotkeys.ts → 检测 → Esc)
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
 * 去某个 NPC 并执行它引用的对话配方:
 *   1. 按城镇档案路线从上一步的锚点走到它附近(没有路线 = 直接从当前位置走过去);
 *   2. 到了以后交给 talkToNpc:找字定位 → 开对话 → 跑配方 → 兜底关窗(见 talk-npc.ts)。
 */
async function visitNpc(flow: ResupplyFlow, npc: TownProfileNpc, fromAnchor: string): Promise<ResupplyResult> {
  const { ctx, deps, label, town, stopped } = flow;
  const { client, size, movement } = deps;

  const recipeName = (npc.recipeName ?? '').trim();
  const recipe = (ctx.init.auxConfigs?.recipes ?? []).find((r) => r.name === recipeName);
  if (!recipe) {
    const available = (ctx.init.auxConfigs?.recipes ?? []).map((r) => r.name);
    return {
      ok: false,
      detail:
        `NPC「${npc.name}」引用的对话配方「${recipeName}」不存在(可能已被删除或改名)。` +
        (available.length > 0 ? `当前可用配方:${available.join('、')}` : '当前没有任何对话配方'),
    };
  }

  const route = resolveRoute(town, fromAnchor, npc.id);
  const points = appendTarget(route, npc.position);
  ctx.sendLog(
    'info',
    `[${label}] 去「${npc.name}」(${npc.position.x},${npc.position.y}) 执行配方「${recipeName}」` +
      (route.length > 0 ? `,途经 ${route.length} 个点` : ',没配路线,直接从当前位置走过去'),
  );

  const arrived = await travelWithinMap(movement, points, {
    timeoutMs: RESUPPLY.travelTimeoutMs,
    moveOptions: RESUPPLY.moveOptions,
    isStopped: stopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
  if (stopped()) return { ok: false, detail: `任务已停止(去「${npc.name}」的路上)` };
  if (!arrived) {
    // 没走到不算失败:找字可能仍能命中(途经点卡住但人已经在附近),交给下面的 findNpc 决定
    ctx.sendLog('warn', `[${label}] 有途经点没走到,继续尝试找 NPC「${npc.name}」`);
  }

  const talk = await talkToNpc({ ctx, client, size, label, npcName: npc.name, recipeName });
  return talk.ok ? { ok: true } : { ok: false, detail: talk.detail ?? `与「${npc.name}」的对话失败` };
}

/**
 * 返程:先从城镇出发到「链首图」(有地图跨越时;没有则直接切回挂机图) ——
 * 出城口走过去,或与传送 NPC 对话后传送(见 town-departure.ts 的 departTownTo),
 * 再沿过图链路逐跳穿越回挂机图,最后走入图点。
 */
async function travelBackToFarm(flow: ResupplyFlow, fromAnchor: string): Promise<ResupplyResult> {
  const { ctx, deps, label, town, farmMapName, stopped } = flow;
  const profiles = deps.mapProfiles ?? [];

  if (!farmMapName) {
    return { ok: false, detail: '缺少 auxConfigs.farmMapName(挂机地图名),不知道要回哪张野外图' };
  }

  // 第一跳目标:配了地图跨越 = 链首那张中间图;否则 = 挂机图(旧行为)
  const firstTarget = profiles[0]?.mapName ?? farmMapName;
  ctx.setStatus('resupply', `${label}:返程`);
  ctx.sendLog(
    'info',
    `[${label}] 返程:从城镇「${town.mapName}」前往「${firstTarget}」` +
      (profiles.length > 0 ? `,再穿越 ${profiles.map((p) => p.mapName).join(' → ')} 回「${farmMapName}」` : ''),
  );

  // 离城:走到出城口踩传送点,或与传送 NPC(飞空艇等)对话后传送(见 town-departure.ts)
  const depart = await departTownTo({
    ctx,
    client: deps.client,
    size: deps.size,
    movement: deps.movement,
    readMapName: deps.readMapName,
    label,
    town,
    fromAnchor,
    targetMapName: firstTarget,
    timeoutMs: RESUPPLY.travelTimeoutMs,
    moveOptions: RESUPPLY.moveOptions,
    isStopped: stopped,
  });
  if (!depart.ok) {
    return { ok: false, detail: stopped() ? '任务已停止(返程途中)' : `返程失败:${depart.detail}` };
  }
  // 切到链首图(或挂机图)= 换图:让 farm 侧按开关决定要不要重新屏蔽所有人(先屏蔽,入图路上也生效)
  await deps.onMapMaybeChanged?.();

  // 中间地图逐跳穿越(链首那张已在上一步到达,所以从这里开始)
  if (profiles.length > 0) {
    ctx.setStatus('resupply', `${label}:跨图`);
    const cross = await crossMapProfiles(deps.movement, () => deps.readMapName(), profiles, farmMapName, {
      timeoutMs: RESUPPLY.travelTimeoutMs,
      moveOptions: RESUPPLY.moveOptions,
      isStopped: stopped,
      onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
      onArriveMap: async () => {
        await deps.onMapMaybeChanged?.();
      },
      runNpc: (npc) => talkToNpc({ ctx, client: deps.client, size: deps.size, label, npcName: npc.name, recipeName: npc.recipeName }),
    });
    if (!cross.ok) {
      return { ok: false, detail: stopped() ? '任务已停止(跨图途中)' : `返程跨图失败:${cross.detail}` };
    }
  }

  // 落点在挂机地图入口,离挂机点还有一段路:沿入图点走过去,再交给主循环
  const entryOk = await walkEntryPath(flow);
  if (!entryOk) {
    // 入图点没走全(卡住/被挡):不硬失败,交给主循环的卡住处理,但要让用户看到
    ctx.sendLog('warn', `[${label}] 入图路径没走完(可能有卡住的点),直接进入挂机循环`);
  }
  return { ok: true, detail: `已切回「${farmMapName}」,${entryOk ? '' : '入图路径未走完,'}${label}完成` };
}

/**
 * 返程入图:从挂机地图入口沿 entryPath 走到挂机点。
 * 没配入图点(或只有 0 个)时直接跳过 —— 老配置行为不变。
 * 返回是否全部点都走到了(单点卡住不算致命,交给调用方决定提示)。
 */
async function walkEntryPath(flow: ResupplyFlow): Promise<boolean> {
  const { ctx, deps, label, stopped } = flow;
  const points = deps.entryPath ?? [];
  if (points.length === 0) return true;

  ctx.setStatus('resupply', `${label}:入图`);
  ctx.sendLog('info', `[${label}] 已进入挂机地图,按入图路径走 ${points.length} 个点回到挂机点`);
  return travelWithinMap(deps.movement, points, {
    timeoutMs: RESUPPLY.travelTimeoutMs,
    moveOptions: RESUPPLY.moveOptions,
    isStopped: stopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
  });
}

/**
 * 锚点间路线解析(城镇档案):
 *   1. 优先直接路线(from → to)
 *   2. 其次反向路线(to → from)的 waypoints 反序 —— 档案里只配一个方向是常态
 *   3. 都没有 → 空数组:调用方退化成"直接从当前位置走过去"(见 appendTarget)
 * 逻辑已提取为 core/navigation/RouteTraveler.ts 的 resolveAnchoredRoute,这里只做类型适配。
 */
function resolveRoute(profile: TownProfileConfig, fromAnchor: string, toAnchor: string): { x: number; y: number }[] {
  return resolveAnchoredRoute(profile.routes ?? [], fromAnchor, toAnchor);
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
