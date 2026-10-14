// 小退回城:Alt+O 打开系统菜单 → 点「选择角色」→ 停 3 秒 → 识别到「保护未成年人健康」→ 按 Enter
//   → 停顿(见 RELOGIN.enterSettleMs) → 等回到游戏(能读到地图名/坐标)→ 点掉「游戏IP登录提示」
//
// 为什么用这条路子:回城卷轴在野外被攻击时可能按不动,小退是"退出到选择角色再上线"的兜底方式。
// 上线后落在哪张图不用这里管 —— 与回城卷轴一样交给「回城补给」的城镇/跨境逻辑返程
// (见 tasks/farm.ts 的 runEndReturn → prepareFarmEntry)。
//
// 进入选择角色界面的判据(用户口径):点完「选择角色」先停 3 秒,再识别区域里的「保护未成年人健康」文案,
//   识别到就算进了选择角色界面,随即按 Enter 回到角色。地图名/坐标是否消失只当日志佐证(不当硬条件)。
// 回到游戏的判据:地图名或坐标能读出来。
// 诊断:地图名与坐标都消失了、文案却一直识别不到 —— 多半是字库缺字或区域/颜色不对,
//   这时把该区域的 OCR 原文打成一条 warn(每次尝试只打一条,不刷屏),方便实测时定位。
//
// ⚠️ 坐标/区域基准见 core/constant-ocr/relogin.ts:1280*800 按用户给的数值,1600*900 是按比例推算的(未实测)。
// 清怪前置(被攻击时小退不会成功)不在这里:由调用方负责(见 tasks/farm.ts 的 clearMobsAround),
//   本模块只管"小退"这一段流程。

import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import { RELOGIN_CLOSE_IP_TIP_POS, RELOGIN_HINT_ROI, RELOGIN_HINT_TEXT, RELOGIN_SELECT_CHAR_POS } from '../../../core/constant-ocr/relogin';
import { detectCharacterSelectHint } from '../../../core/perception/CharacterSelectDetector';
import type { CharacterSelectHint } from '../../../core/perception/CharacterSelectDetector';
import type { MapPosition } from '../../../core/perception/types';
import type { DamooClient } from '../../../core/platform/damoo/dm-api';
import type { IInputProvider } from '../../../core/platform/input/IInputProvider';
import { sleep } from '../../../core/utils/sleep';
import { pressGameHotkey } from '../../../shared/game-hotkeys';
import type { FarmEndReturnReloginConfig, ScreenRect } from '../../../shared/types';
import type { WorkerContext } from './context';

/** 默认清怪总超时(ms):配置缺省时的兜底,与 renderer 的默认值保持一致 */
const DEFAULT_CLEAR_TIMEOUT_MS = 120_000;

/** 默认最多尝试几次:超过这个数还没成功就报失败(别在游戏里反复小退) */
const DEFAULT_MAX_ATTEMPTS = 3;

/** 流程可调常量(真机调试基本就改这一段) */
const RELOGIN = {
  /** 按 Alt+O 后等系统菜单出现的等待(ms) */
  menuOpenDelayMs: 1000,
  /** 点「选择角色」前的鼠标就位等待(ms) */
  clickSettleMs: 200,
  /** 等进入选择角色界面的超时(ms) */
  selectScreenTimeoutMs: 20_000,
  /** 按 Enter 后等回到游戏的超时(ms) */
  backToGameTimeoutMs: 30_000,
  /** 轮询间隔(ms):一次 OCR 较慢,别太频繁 */
  pollMs: 500,
  /** 点完「选择角色」后固定等待的时间(ms):用户要求先停 3 秒,再开始识别「未成年人」文案 */
  selectHoldMs: 3000,
  /** 按 Enter 之后再停顿的时间(ms):用户要求停 7 秒才开始后面的动作(等回到游戏 / 点掉IP登录提示) */
  enterSettleMs: 7000,
  /** 点掉「游戏IP登录提示」之后的等待(ms) */
  ipTipAfterMs: 500,
  /** 一次尝试失败后、下一次尝试之前的等待(ms) */
  retryDelayMs: 3000,
};

/** 清怪的识别参数覆盖(只留"填了的项";留空的项由调用方沿用本任务「定点识别」的对应值) */
export interface ResolvedClearMobsFilter {
  /** 识别范围(客户区相对坐标;w/h 必须为正才算填了) */
  ocrRange?: ScreenRect;
  /** 怪名颜色(大漠颜色描述符;空数组 = 没填) */
  nameColors?: string[];
  /** 怪名关键字(空数组 = 没填) */
  nameKeywords?: string[];
}

/** 清洗后的小退回城参数(字段含义见 shared/types.ts 的 FarmEndReturnReloginConfig) */
export interface ResolvedRelogin {
  /** 小退前先清掉周围的怪(只有显式 false 才关闭) */
  clearMobs: boolean;
  /** 清怪总超时(ms) */
  clearTimeoutMs: number;
  /** 小退最多尝试几次(1~10) */
  maxAttempts: number;
  /**
   * 清怪的识别参数覆盖(null = 一项都没填,清怪直接沿用本任务的识别参数);
   * 填了的项在 tasks/farm.ts 的 clearMobsAround 里覆盖 conf 的对应值
   */
  mobFilter: ResolvedClearMobsFilter | null;
}

/** 清洗清怪的识别参数覆盖:逐项判"填了没",一项都没填返回 null */
function resolveClearMobsFilter(raw: FarmEndReturnReloginConfig['mobFilter']): ResolvedClearMobsFilter | null {
  if (!raw) return null;
  const range = raw.ocrRange;
  const colors = (raw.nameColors ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
  const keywords = (raw.nameKeywords ?? []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const out: ResolvedClearMobsFilter = {};
  // 宽高有一个不为正 = 没填(与「定点识别」的 OCR 范围同一口径)
  if (range && range.w > 0 && range.h > 0) {
    out.ocrRange = { x: Math.max(0, range.x | 0), y: Math.max(0, range.y | 0), w: range.w | 0, h: range.h | 0 };
  }
  if (colors.length > 0) out.nameColors = colors;
  if (keywords.length > 0) out.nameKeywords = keywords;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 清洗小退回城配置:
 *   clearMobs:只有显式 false 才关闭(界面默认勾选)
 *   clearTimeoutMs 夹 10s~600s;maxAttempts 夹 1~10
 *   mobFilter:清怪的识别参数覆盖(界面可独立配一份,见 shared/types.ts 的 FarmEndReturnReloginConfig.mobFilter)
 */
export function resolveReloginConfig(raw?: FarmEndReturnReloginConfig | null): ResolvedRelogin {
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    clearMobs: raw?.clearMobs !== false,
    clearTimeoutMs: clamp(raw?.clearTimeoutMs, 10_000, 600_000, DEFAULT_CLEAR_TIMEOUT_MS),
    maxAttempts: clamp(raw?.maxAttempts, 1, 10, DEFAULT_MAX_ATTEMPTS),
    mobFilter: resolveClearMobsFilter(raw?.mobFilter),
  };
}

/** 小退流程的运行依赖(由 farm 侧注入实物,与回城补给同一套约定) */
export interface ReloginDeps {
  ctx: WorkerContext;
  /** 该窗口的大漠入口(按键与感知层 client 共用这一份) */
  client: DamooClient;
  /** farm 主循环正在用的输入模拟(复用同一实例,不要新建) */
  input: IInputProvider;
  /** 该窗口的分辨率档位(点击坐标/判据区域按档位取) */
  size: WindowSizeKey;
  /** 日志前缀(与 farm 的 label 一致) */
  label: string;
  /** 读当前地图名(OCR 中文名,读不到返回空串) */
  readMapName: () => Promise<string>;
  /** 读当前坐标(读不到返回 null —— 不在游戏里时就是 null) */
  readPosition: () => Promise<MapPosition | null>;
  /** 最多尝试几次(来自 relogin.maxAttempts) */
  maxAttempts: number;
  /** 外部停止标志:返回 true 时尽快退出 */
  isStopped?: () => boolean;
}

export interface ReloginResult {
  ok: boolean;
  detail: string;
}

/** 一次信号读取:角色是否已经离开游戏(地图名与坐标都读不出来)+ 文案检测结果 */
interface SelectScreenReading {
  outOfGame: boolean;
  hint: CharacterSelectHint;
}

/**
 * 读一次判定信号。
 * 坐标读得到就直接认定"还在游戏里"(省一次地图名 OCR);坐标读不到再读地图名,两者都空 = 离开游戏了。
 */
async function readSignals(deps: ReloginDeps): Promise<SelectScreenReading> {
  const pos = await deps.readPosition();
  const map = pos ? '' : String((await deps.readMapName()) ?? '').trim();
  return { outOfGame: !pos && !map, hint: detectCharacterSelectHint(deps.client, deps.size) };
}

/** 现在是不是已经在选择角色界面:只认「未成年人」文案识别到(用户口径) */
async function isAtSelectScreen(deps: ReloginDeps): Promise<boolean> {
  const r = await readSignals(deps);
  return r.hint.present;
}

/**
 * 等进入选择角色界面(超时 RELOGIN.selectScreenTimeoutMs)。
 * 判据 = 识别到「保护未成年人健康」文案(用户口径:"识别到之后再按 enter");
 * 地图名/坐标是否消失只当日志佐证,不参与判定 —— 登录界面上这两个区域偶尔还能读到像素,当硬条件会一直不成立。
 * 一直没识别到时打一条 warn(带区域、期望文案、OCR 原文、地图/坐标状态),每次尝试只打一条。
 */
async function waitForSelectScreen(deps: ReloginDeps): Promise<ReloginResult> {
  const { ctx, label, size } = deps;
  const deadline = Date.now() + RELOGIN.selectScreenTimeoutMs;
  let warned = false;
  let lastHintText = '';

  while (Date.now() < deadline) {
    if (deps.isStopped?.()) return { ok: false, detail: '任务已停止(等选择角色界面途中)' };

    const r = await readSignals(deps);
    lastHintText = r.hint.text;

    if (r.hint.present) {
      ctx.sendLog(
        'info',
        `[${label}] 小退:已识别到选择角色界面「${r.hint.text}」(地图名/坐标${r.outOfGame ? '都已消失' : '还能读到,仅作参考'})`,
      );
      return { ok: true, detail: '已进入选择角色界面' };
    }

    if (!warned) {
      warned = true;
      const roi = RELOGIN_HINT_ROI[size];
      ctx.sendLog(
        'warn',
        `[${label}] 小退:还没识别到「${RELOGIN_HINT_TEXT}」` +
          `(区域 ${roi ? `(${roi.x1},${roi.y1})-(${roi.x2},${roi.y2})` : '这一档未配'} 颜色=不限;OCR 读到的原文「${r.hint.text}」;` +
          `地图名/坐标${r.outOfGame ? '都已消失' : '还能读到'})—— ` +
          `会继续等到超时;若一直等不到,多半是区域/字库/颜色对不上,核对 core/constant-ocr/relogin.ts 里这一档的坐标`,
      );
    }

    await sleep(RELOGIN.pollMs);
  }

  return {
    ok: false,
    detail: `等 ${Math.round(RELOGIN.selectScreenTimeoutMs / 1000)}s 没进入选择角色界面(最后 OCR 读到「${lastHintText}」)`,
  };
}

/** 等回到游戏:地图名或坐标能读出来(超时 RELOGIN.backToGameTimeoutMs) */
async function waitBackToGame(deps: ReloginDeps): Promise<ReloginResult> {
  const deadline = Date.now() + RELOGIN.backToGameTimeoutMs;

  while (Date.now() < deadline) {
    if (deps.isStopped?.()) return { ok: false, detail: '任务已停止(等回到游戏途中)' };

    const pos = await deps.readPosition();
    if (pos) return { ok: true, detail: `已回到游戏(坐标 ${pos.x},${pos.y} 地图「${pos.map ?? '未知'}」)` };
    const map = String((await deps.readMapName()) ?? '').trim();
    if (map) return { ok: true, detail: `已回到游戏(地图「${map}」,坐标未读到)` };

    await sleep(RELOGIN.pollMs);
  }

  return {
    ok: false,
    detail: `按 Enter 后 ${Math.round(RELOGIN.backToGameTimeoutMs / 1000)}s 内地图名/坐标都没读出来(角色可能还停在选择角色界面)`,
  };
}

/**
 * 关掉回到游戏后挡着的「游戏IP登录提示」:能读到地图名/坐标之后再点一下(用户实测坐标)。
 * 这条提示不是每次都有,点不到也不影响后续 —— 失败只记日志;缺分辨率档位直接跳过。
 */
async function closeIpLoginTip(deps: ReloginDeps): Promise<void> {
  const { ctx, label, input, size } = deps;
  const pos = RELOGIN_CLOSE_IP_TIP_POS[size];
  if (!pos) {
    ctx.sendLog('warn', `[${label}] 小退:分辨率 ${size} 没有「游戏IP登录提示」的关闭坐标(core/constant-ocr/relogin.ts 缺这一档),跳过`);
    return;
  }
  try {
    ctx.sendLog('info', `[${label}] 小退:点掉「游戏IP登录提示」@(${pos.x},${pos.y})`);
    await input.moveMouse({ x: pos.x, y: pos.y }, { kind: 'instant' });
    await input.delay(RELOGIN.clickSettleMs);
    await input.click('left');
    await sleep(RELOGIN.ipTipAfterMs);
  } catch (e: any) {
    ctx.sendLog('warn', `[${label}] 小退:点「游戏IP登录提示」失败(不影响后续):${e?.message ?? e}`);
  }
}

/**
 * 一次小退尝试:
 *   已经在选择角色界面(上一次尝试按了 Enter 却没进游戏)→ 跳过开菜单那两步
 *   否则:Alt+O 打开系统菜单 → 点「选择角色」→ 等进入选择角色界面
 *   → 停留 3s → 按 Enter → 停顿(见 RELOGIN.enterSettleMs) → 等回到游戏 → 点掉「游戏IP登录提示」
 */
async function reloginOnce(deps: ReloginDeps): Promise<ReloginResult> {
  const { ctx, label, input } = deps;
  const stopped = (): boolean => deps.isStopped?.() === true;

  if (await isAtSelectScreen(deps)) {
    ctx.sendLog('info', `[${label}] 小退:已经在选择角色界面,跳过开菜单`);
  } else {
    const pos = RELOGIN_SELECT_CHAR_POS[deps.size];
    if (!pos) {
      return { ok: false, detail: `分辨率 ${deps.size} 没有「选择角色」的点击坐标(core/constant-ocr/relogin.ts 缺这一档),无法小退` };
    }

    // Alt+O 打开系统菜单(键位只在 shared/game-hotkeys.ts 维护)
    await pressGameHotkey(deps.client, 'openSystemPanel');
    await sleep(RELOGIN.menuOpenDelayMs);
    if (stopped()) return { ok: false, detail: '任务已停止(小退途中)' };

    // 点「选择角色」:与 farm.ts 点聊天框同一套原语(moveMouse + click)
    ctx.sendLog('info', `[${label}] 小退:点击「选择角色」(${pos.x},${pos.y})`);
    await input.moveMouse({ x: pos.x, y: pos.y }, { kind: 'instant' });
    await input.delay(RELOGIN.clickSettleMs);
    await input.click('left');
  }

  // 用户口径:点完「选择角色」先固定停 3 秒等界面渲染,再识别「未成年人」文案,识别到才按 Enter 进入游戏
  await sleep(RELOGIN.selectHoldMs);
  if (stopped()) return { ok: false, detail: '任务已停止(小退途中)' };

  const entered = await waitForSelectScreen(deps);
  if (!entered.ok) return entered;

  ctx.sendLog('info', `[${label}] 小退:按 Enter 重新进入游戏`);
  await input.pressKey('Enter');

  // 用户要求:按 Enter 之后先停顿(见 RELOGIN.enterSettleMs),才开始后面的动作(等回到游戏 / 点掉IP登录提示)
  await sleep(RELOGIN.enterSettleMs);
  if (stopped()) return { ok: false, detail: '任务已停止(小退途中)' };

  const back = await waitBackToGame(deps);
  if (!back.ok) return back;

  // 进游戏后「游戏IP登录提示」会挡着:能读到地图名/坐标(即已回到游戏)之后再点一下关掉它
  await closeIpLoginTip(deps);
  return back;
}

/**
 * 小退回城(失败会自动重试,最多 maxAttempts 次):
 * 每次尝试失败都会打一条 warn 说明卡在哪一步(等界面超时 / 按 Enter 后回不到游戏),全部失败返回 ok:false。
 */
export async function returnViaRelogin(deps: ReloginDeps): Promise<ReloginResult> {
  const { ctx, label } = deps;
  const attempts = Math.max(1, Math.min(10, Math.round(deps.maxAttempts)));
  ctx.sendLog('info', `[${label}] 小退回城:最多尝试 ${attempts} 次`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (deps.isStopped?.()) return { ok: false, detail: '任务已停止(小退途中)' };

    const r = await reloginOnce(deps);
    if (r.ok) {
      ctx.sendLog('info', `[${label}] 小退回城成功(第 ${attempt}/${attempts} 次):${r.detail}`);
      return r;
    }
    ctx.sendLog('warn', `[${label}] 小退第 ${attempt}/${attempts} 次失败:${r.detail}`);

    if (deps.isStopped?.()) return { ok: false, detail: '任务已停止(小退途中)' };
    if (attempt < attempts) await sleep(RELOGIN.retryDelayMs);
  }

  return { ok: false, detail: `小退回城失败:重试 ${attempts} 次都没成功(详见上面的失败日志)` };
}
