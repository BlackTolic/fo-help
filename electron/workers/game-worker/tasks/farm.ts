// 挂机打怪(farm)任务:沿路径点循环移动,到挂机点按绑定的技能释放
//
// 模式(2026-09 改版):
//   fixed        定点打怪:到挂机点不做识别,技能打在固定方向固定距离(移动反方向)
//   fixed-detect 定点识别:到挂机点 → OCR/找字识别怪物名称 → 左键点击怪名锁定 → 攻击,
//                直到该点再也识别不到怪才离开(识别不到怪后原地再等 DETECT.idleMs=3s,等刷新)
//                · 没配技能 = 普通攻击:识别到怪 → 左键点一下(游戏自动攻击),怪名消失后再识别下一只
//                · 配了 + 智能施法 = 循环释放「全部已配置技能」(各自按 CD,排除物品使用),直到怪死
//                · 配了 + 自定义施法 = 循环释放该点绑定的 skillIds(含显式绑定的物品使用),直到怪死
//                识别范围/颜色/关键字来自 taskConfig.mobFilter(OCR 范围不配 = 整个游戏画面);
//                「怪死/丢失锁定」以「已锁定怪物名称」HUD 为准(默认 x95,y109,105x35,见
//                core/constant-ocr/position.ts),HUD 读不到时退回「识别范围里还能否找到该名字」兜底
//   move-detect  移动识别(尚未实现,UI 未开放):移动途中识别,识别到怪停下打
//
// 技能释放方式(按 taskConfig.castMode):
//   smart  智能施法(默认):
//           fixed        = 到每个挂机点,状态施法(self)技能不占名额——CD 已好的
//                          一次性全部释放;其余技能选一个没进 CD 的释放,多个可释放时选
//                          cooldownMs 最长的;全部冷却中则不释放,留到下一个挂机点
//           fixed-detect = 不挑技能,循环释放全部已配置技能(排除「物品使用」),直到怪死
//   custom 自定义施法:按各挂机点绑定的 skillIds 释放(不选 = 全部),逐个点技能
// 每个技能按 method 施法:
//   quick  快捷施法:只按技能键 → 等吟唱时间
//   target 缺省施法:按技能键 → 等吟唱时间 → 左键点击目标坐标
//                   (定点打怪=移动反方向「施法距离」处,未配则默认 300px,并夹到画面内;
//                    定点识别=重新定位到的怪名坐标,怪名找不到/超出施法距离则跳过)
//   self   状态施法:左键点击角色自身(屏幕中心)→ 按技能键 → 等吟唱时间
//   item   物品使用:只按技能键(快捷栏物品/药品),由「生命回复」看门狗按血量自动使用
// 技能字段:cooldownMs(技能时间间隔)/ castMs(吟唱时间)/ rangePx(施法距离,0=见上默认)
// 技能 CD(含物品)统一记在 ctx.lastCast,与看门狗的生命回复共用,避免两边抢用同一个物品
// 智能施法不会把 item 技能当成"输出技能"放出去(否则药品会被每个挂机点白白吃掉);
//   自定义施法下用户显式绑定到挂机点的 item 技能照常使用
// 路径点:farm-spot 挂机点(自定义施法绑定 skillIds,不选=全部技能;定点识别下不配技能=普通攻击)/
//   rest 休息点 / path 路径中间点(后两种不放技能)
//
// 结束条件:stop 命令 / 跑满最大圈数 / 检测到角色死亡(isCharacterDead)
//
// 配置来源:优先读 ctx.init.taskConfig(WindowCard「挂机打怪」弹窗点"确认/保存"后
//   经 start-task 命令下发);字段缺失时回退到下面的内置默认值。
// 兼容旧配置:mode single/patrol/aoe → fixed;旧技能无 method/castMs/rangePx
//   时按 target/400ms/不限距离处理;旧路径点无 skillIds → 挂机点释放全部技能。
//
// 暂停/继续/停止:主循环只认 ctx.moveAttack 标志,由 commands.ts 的
//   pause/resume/stop 命令维护(标志放 ctx 上:命令可能在任务 start() 之前到达)
//
// 为什么"到点才释放"而不是移动中释放:
//   QQ 幻想是点地移动,移动本身就是鼠标左键操作(精确点移动:每步单击地面;
//   随机圆点法:按住左键不放),而指向性技能需要"按技能键 → 左键点击怪物"。
//   移动中放技能,点击会被当成移动指令,所以必须等 moveTo 到达(arriveTolerance 内)、
//   角色停下来之后再释放。
//
// screenshot-test 命令(thumbnail.ts → move-attack.ts)复用同一个 runFarmLoop 做移动攻击测试
//   (传 opts.label='移动攻击';两条路径只有日志前缀 / 结果上报方式不同,循环逻辑只此一份)。

// 223,56 -> 182,68 -> 151,74 -> 198,107 -> 230,82 ->223,56
// 6s 0.5s /5s 0.75s/10s   ->F7:1S

// 精确移动
// 223/56 -- 209/57 -- 208/70 -- 206/73 -- 217/78 -- 220/86 -- 232/83 -- 240/78  --- 227/73 -- 219/63  --- 223/56
// 无泪南郊： 229/53 -- 215/51 -- 202/50--192/56 --182/61 ---185 /69----184/76 --187/85 -- 199/90 --208/84 --- 219/82 ---225/74 ---217/65 --225/58

import { DamooVisionProvider } from '../../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../../core/platform/input/damoo/DamooInputProvider';
import { MapCoordReader } from '../../../../core/perception/MapCoordReader';
import { MonsterNameDetector } from '../../../../core/perception/MonsterNameDetector';
import { MovementControllerByPrecisePoint } from '../../../../core/navigation/MovementController';
import type { PrecisePointConfig } from '../../../../core/navigation/MovementController';
import { CoordinateReader } from '../../../../core/state/CoordinateReader';
import type { Point, Rect } from '../../../../core/platform/vision/IVisionProvider';
import type { MapPosition, MapCoordConfig } from '../../../../core/perception/types';
import type { WorkerContext } from '../context';
import { resolveWindowSizeKey, syncInterruptWatcher, stopInterruptWatcher } from '../interrupts';
import type { FarmTaskConfig, GameResolution } from '../../../../shared/types';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM, DEFAULT_LOCKED_MONSTER_NAME } from '../../../../core/constant-ocr/position';
import { COLOR_WHITE } from '../../../../core/constant-ocr/color';
import type { TaskController, TaskFactoryContext } from './types';

// ===== 内置默认值(taskConfig 里没配对应字段时用;按你的游戏实际情况改)=====

/**
 * 游戏画面几何:窗口客户区 + 角色脚下(客户区中心)
 * 按设置里的分辨率取档(1600*900 / 1280*800),未设置时按 1280x800
 */
interface ViewGeometry {
  /** 画面区域(大漠绑定后是窗口客户区相对坐标) */
  roi: Rect;
  /** 角色脚下 = 画面中心 */
  center: Point;
}

// 游戏画面几何:窗口客户区 + 角色脚下(客户区中心)
function viewGeometry(resolution?: GameResolution | null): ViewGeometry {
  const roi: Rect = resolution === '1600*900' ? { x: 0, y: 0, w: 1600, h: 900 } : { x: 0, y: 0, w: 1280, h: 800 };
  return { roi, center: { x: Math.round(roi.w / 2), y: Math.round(roi.h / 2) } };
}

/** 默认路径点(地图坐标):从 A 出发依次经过 B/C/D/E,一圈结束后自动回到 A 再循环 */
// const DEFAULT_PATH_POINTS = [
//   { x: 100, y: 100 }, // A 起点,每圈终点也回到这里
//   { x: 130, y: 100 }, // B
//   { x: 130, y: 130 }, // C
//   { x: 100, y: 130 }, // D
//   { x: 85, y: 115 }, // E
// ];

/** 默认技能列表(taskConfig 未配技能时用;字段同 MoveAttackSkill) */
// const DEFAULT_SKILLS: MoveAttackSkill[] = [
//   { id: 'default-f1', key: 'F1', cooldownMs: 3000, castMs: 400, rangePx: 0, method: 'target' },
//   { id: 'default-f2', key: 'F2', cooldownMs: 5000, castMs: 400, rangePx: 0, method: 'target' },
//   { id: 'default-f3', key: 'F3', cooldownMs: 8000, castMs: 400, rangePx: 0, method: 'target' },
//   { id: 'default-f4', key: 'F4', cooldownMs: 10000, castMs: 400, rangePx: 0, method: 'target' },
// ];

/** 默认找怪配置 */
const DEFAULT_MONSTER_KEYWORDS = ['野狼', '野猪'];
const DEFAULT_MONSTER_COLOR = 'FFFFFF-FFFFFF';

// /** 两个技能释放之间的间隔(避免按键/点击冲突;按键到点击的等待已由技能 castMs 取代旧固定值) */
// const BETWEEN_SKILLS_MS = 300;
// /** 到达路径点后,站稳多久再扫描/释放 */
// const SETTLE_MS = 200;

/** 定点识别的识别配置(搜索区域/颜色/关键字来自 taskConfig.mobFilter) */
const DETECT = {
  similarity: 0.85,
  /** 识别/判定循环的轮询间隔(OCR 较慢,别太频繁) */
  pollMs: 800,
  /** 普通攻击:锁定后游戏会自动攻击;名字超过这么久还在则补点一次,避免丢失锁定 */
  reclickMs: 5000,
  /** 识别不到怪后仍原地等待的时间(ms),连续这么久没怪才前往下一个挂机点(等刷新) */
  idleMs: 2000,
  /** 左键点击怪名后,等游戏把「已锁定怪物名称」写进 HUD 的时间(ms) */
  lockMs: 300,
};

/**
 * 固定施法方向/距离(定点打怪用:不做识别,缺省施法技能就打在角色的这个方向上)
 * - behind = 移动的反方向(引怪场景:怪在身后追着你跑)
 * - fixed  = 固定角度(fixedAngleDeg,0=正右,90=正下,180=正左)
 * - distance = 未配「施法距离」的技能,落点离屏幕中心(角色)的默认距离(px)
 */
const FIXED_AIM = {
  mode: 'behind' as 'behind' | 'fixed',
  fixedAngleDeg: 0,
  distance: 300,
};

/** 点击点离画面边界至少留这么多像素(避免点到窗口边框/窗口外) */
const CLICK_MARGIN = 4;

/** 结束条件(taskConfig 未配时用) */
const END_CONDITIONS = {
  /** 最多跑多少圈 */
  maxLoops: null,
  /** 血量低于该值结束;0 = 不检查(需要 profile.regions.selfHp 已配置) */
  minSelfHpPercent: 0,
  /** 连续多少个路径点未到达(卡住)就结束 */
  // maxStuckPoints: 3,
};

/** 地图坐标读取配置(坐标区域按设置里的分辨率取档) */
function mapCoordConfig(ctx: WorkerContext): MapCoordConfig {
  return {
    coordRoi: DEFAULT_ROLE_POSITION[resolveWindowSizeKey(ctx.init.hwnd, ctx.init.settings?.resolution)],
    coordColor: COLOR_WHITE,
    similarity: DEFAULT_SIM,
  };
}

/**
 * 地图坐标 → 屏幕坐标 的标定(精确点移动 MovementControllerByPrecisePoint 用)
 *
 * 模型与标定方法见 core/navigation/MapCalibration.ts 顶部注释。
 * 下面 7 组样本是重新实测的:每组 from = 点击前角色地图坐标、screen = 点击的屏幕点、
 * to = 点击后角色实际走到(坐标读数)的地图坐标;每组给两条方程(屏幕 x/y 各一条)。
 * 7 组最小二乘拟合(连角色锚点一起解)得到:
 *   矩阵 a=39.45 b=-0.84 c=-0.21 d=39.89,锚点反推 ≈(644,396),最大残差 32.7px(0.82 单位)。
 * 结论:两轴比例都 ≈40(水平 39.45 / 竖直 39.89,pxPerUnit 兜底 40 仍然合适),
 * 轴间耦合很小(b/c 都接近 0);残差落在「地图坐标整数读数的量化误差(±1 单位 ≈40px)」内。
 *
 * ⚠️ 样本里的 screen 是 1280x800 下实测的。换分辨率时按「画面中心差」整体平移样本
 *    (见 buildCalibration):角色恒在画面中心,窗口变大时锚点跟着中心走同一段位移。
 *    位移量 = 该分辨率的画面中心 − CALIBRATION_BASE_CENTER。
 */
const MAP_CALIBRATION: Omit<PrecisePointConfig, 'selfScreen' | 'gameRect'> = {
  /**
   * 点击点离画面各边的最小边距:路径点换算出的屏幕坐标超出该范围时,
   * 沿「角色 → 目标」方向裁回边距内(避免点到窗口外/上下方游戏 UI 上)
   */
  margin: { top: 100, bottom: 70, left: 10, right: 10 },
  /** 样本定不出某轴时的兜底比例(实测水平 ≈39 / 竖直 ≈40) */
  pxPerUnit: 40,
  samples: [
    // 点 (970,53) → (221,47)
    {
      from: { map: null, x: 213, y: 55 },
      screen: { x: 970, y: 53 },
      to: { map: null, x: 221, y: 47 },
    },
    // 点 (1148,645) → (234,53)
    {
      from: { map: null, x: 221, y: 47 },
      screen: { x: 1148, y: 645 },
      to: { map: null, x: 234, y: 53 },
    },
    // 点 (231,608) → (223,58)
    {
      from: { map: null, x: 234, y: 53 },
      screen: { x: 231, y: 608 },
      to: { map: null, x: 223, y: 58 },
    },
    // 点 (282,137) → (214,51)
    {
      from: { map: null, x: 223, y: 58 },
      screen: { x: 282, y: 137 },
      to: { map: null, x: 214, y: 51 },
    },
    // 点 (656,651) → (215,58)
    {
      from: { map: null, x: 214, y: 51 },
      screen: { x: 656, y: 651 },
      to: { map: null, x: 215, y: 58 },
    },
    // 点 (1094,370) → (226,57)
    {
      from: { map: null, x: 215, y: 58 },
      screen: { x: 1094, y: 370 },
      to: { map: null, x: 226, y: 57 },
    },
    // 点 (90,349) → (212,56)
    {
      from: { map: null, x: 226, y: 57 },
      screen: { x: 90, y: 349 },
      to: { map: null, x: 212, y: 56 },
    },
  ],
};

/** 标定样本实测时的画面中心(1280x800):换分辨率时按画面中心差整体平移样本 */
const CALIBRATION_BASE_CENTER: Point = { x: 640, y: 400 };

/**
 * 按当前分辨率组装精确点标定:锚点/画面区用该分辨率的几何,
 * 样本 screen 坐标按「画面中心差」平移(角色恒在画面中心,窗口变大时锚点跟着中心走)。
 * ⚠️ 假设换分辨率后镜头缩放不变(px/单位 仍 ≈40);若实测点击偏差明显,需在该分辨率下重新采样。
 */
function buildCalibration(view: ViewGeometry): PrecisePointConfig {
  const dx = view.center.x - CALIBRATION_BASE_CENTER.x;
  const dy = view.center.y - CALIBRATION_BASE_CENTER.y;
  return {
    ...MAP_CALIBRATION,
    selfScreen: view.center,
    gameRect: view.roi,
    samples: MAP_CALIBRATION.samples?.map((s) => ({
      ...s,
      screen: { x: s.screen.x + dx, y: s.screen.y + dy },
    })),
  };
}

// ===== 运行时配置(由 taskConfig + 默认值合成)=====

interface MoveAttackSkill {
  /** 技能配置 id(冷却记录按 id,key 可能重复配置) */
  id: string;
  key: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10';
  /** 技能名称(日志展示用) */
  name?: string;
  /** 技能时间间隔(毫秒,两次释放的最短间隔) */
  cooldownMs: number;
  /** 吟唱时间(毫秒):target=按键后等多久点鼠标;quick/self=按键后等多久放下一个 */
  castMs: number;
  /** 施法距离(屏幕像素,以角色为圆心);target 技能:怪超出距离则跳过;0 = 不限制 */
  rangePx: number;
  /** 施法方式:quick=只按键 / target=按键+左键点目标 / self=点自己+按键 / item=按键使用快捷栏物品 */
  method: 'quick' | 'target' | 'self' | 'item';
}

/** 解析后的路径点 */
interface ResolvedWaypoint {
  x: number;
  y: number;
  /** farm-spot 挂机点(放技能) / rest 休息点 / path 路径中间点(都不放技能) */
  type: 'farm-spot' | 'rest' | 'path';
  /** 该点绑定的技能(仅 farm-spot 用;空数组 = 不放) */
  skills: MoveAttackSkill[];
}

interface ResolvedConfig {
  /** 打怪模式:fixed=定点打怪 / fixed-detect=定点识别 / move-detect=移动识别 */
  mode: 'fixed' | 'fixed-detect' | 'move-detect';
  /** 施法方式:smart=智能施法(每个挂机点选一个 CD 最长的可释放技能) / custom=按路径点绑定的技能释放 */
  castMode: 'smart' | 'custom';
  waypoints: ResolvedWaypoint[]; // 解析后的路径点
  skills: MoveAttackSkill[]; // 任务级技能列表
  /** 怪名字关键字;定点识别下为空 = 纯 OCR(范围内任意文字都算怪名) */
  monsterKeywords: string[];
  /** 怪名字颜色(大漠颜色格式,如 'FFFFFF-FFFFFF';可选值见 core/constant-ocr/color.ts) */
  monsterColor: string;
  /** 定点识别的 OCR 识别范围(客户区相对坐标;不配 = 整个游戏画面) */
  ocrRange: Rect;
  /** 定点识别:已锁定怪物名称的显示区域(客户区相对坐标;默认 x95,y109,w105,h35) */
  lockedNameRoi: Rect;
  /** 定点识别:点击怪名时的偏移(默认 0,0 = 点在名字上) */
  clickOffset: Point;
  /** 移动步进间隔(ms),来自 taskConfig.movementSpeed */
  stepIntervalMs: number;
  maxLoops: number | null;
}

/** runFarmLoop 的运行结果(任务 start() 与 screenshot-test 测试路径共用) */
export interface FarmLoopResult {
  ok: boolean;
  detail: string;
}

/** runFarmLoop 的调用方标识:日志前缀 + 卡片状态文案里的任务名 */
export interface FarmLoopOptions {
  /** 默认 '挂机打怪';screenshot-test 测试路径传 '移动攻击' */
  label?: string;
}

const VALID_SKILL_KEYS = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);

/** 旧配置模式 → 新模式(本期只实现定点打怪,旧模式统一迁移过去) */
const LEGACY_MODE_MAP: Record<string, ResolvedConfig['mode']> = {
  single: 'fixed',
  patrol: 'fixed',
  aoe: 'fixed',
};

/** 定点打怪:缺省施法技能没配「施法距离」时,落点用 FIXED_AIM.distance(300px) */

/**
 * 从 ctx.init.taskConfig(FarmTaskConfig)解析挂机打怪配置,缺失字段用内置默认值兜底
 */
function resolveConfig(ctx: WorkerContext): ResolvedConfig {
  const cfg = ctx.init.taskConfig as FarmTaskConfig;
  const isFarm = cfg?.type === 'farm';

  // 打怪模式:定点打怪(当前实现)/定点识别/移动识别(旧值自动迁移,见 LEGACY_MODE_MAP)
  const rawMode = isFarm && cfg.mode ? cfg.mode : 'fixed';
  const mode: ResolvedConfig['mode'] =
    (LEGACY_MODE_MAP[rawMode] as ResolvedConfig['mode'] | undefined) ?? (rawMode as ResolvedConfig['mode']);

  // 施法方式:缺省 = 智能施法
  const castMode: ResolvedConfig['castMode'] = isFarm && cfg.castMode === 'custom' ? 'custom' : 'smart';

  // 任务级技能:配置了至少 1 个启用技能则用(过滤非法键/负 CD)
  let skills: MoveAttackSkill[] = [];
  if (isFarm && cfg.skills && cfg.skills.some((s) => s.enabled !== false)) {
    skills = cfg.skills
      .filter((s) => s.enabled !== false)
      .filter((s) => VALID_SKILL_KEYS.has(s.key))
      .map((s) => ({
        id: s.id,
        key: s.key as MoveAttackSkill['key'],
        name: s.name,
        cooldownMs: Math.max(0, s.cooldownMs | 0),
        castMs: Math.max(0, s.castMs ?? 400),
        rangePx: Math.max(0, s.rangePx ?? 0),
        method: (s.method ?? 'target') as MoveAttackSkill['method'],
      }));
  }

  // 路径点:waypoints 非空则用
  // 智能施法:挂机点不绑定技能,到点从全部任务技能里自动选,这里直接挂全部技能
  const waypoints: ResolvedWaypoint[] = cfg.waypoints.map((w) => {
    const type = (w.type ?? 'farm-spot') as ResolvedWaypoint['type'];
    let wpSkills: MoveAttackSkill[] = [];
    if (type === 'farm-spot') {
      if (castMode === 'smart') {
        wpSkills = skills;
      } else {
        const ids = w.skillIds && w.skillIds.length > 0 ? w.skillIds : skills.map((s) => s.id);
        wpSkills = skills.filter((s) => ids.includes(s.id));
      }
    }
    return { x: w.x, y: w.y, type, skills: wpSkills };
  });

  // 找怪关键字/颜色
  const rawKeywords = (isFarm && Array.isArray(cfg.mobFilter?.nameKeywords) ? cfg.mobFilter.nameKeywords : [])
    .map((k) => String(k ?? '').trim())
    .filter(Boolean);
  // 识别模式(定点/移动识别):关键字是可选白名单,留空 = 纯 OCR,不做默认兜底
  // 定点打怪的兜底关键字只给「移动攻击测试」用
  const monsterKeywords =
    mode === 'fixed-detect' || mode === 'move-detect' ? rawKeywords : rawKeywords.length > 0 ? rawKeywords : DEFAULT_MONSTER_KEYWORDS;
  const monsterColor = isFarm && cfg.mobFilter?.nameColor?.trim() ? cfg.mobFilter.nameColor.trim() : DEFAULT_MONSTER_COLOR;

  // 定点识别:OCR 识别范围(未配/非法 → 整个游戏画面),点击怪名的偏移
  const view = viewGeometry(ctx.init.settings?.resolution);
  const rawRange = isFarm ? cfg.mobFilter?.ocrRange : undefined;
  const ocrRange: Rect =
    rawRange && rawRange.w > 0 && rawRange.h > 0
      ? { x: Math.round(rawRange.x), y: Math.round(rawRange.y), w: Math.round(rawRange.w), h: Math.round(rawRange.h) }
      : view.roi;
  // 已锁定怪物名称 HUD 区域:默认用实测常量(见 core/constant-ocr/position.ts),可按配置覆盖
  const rawLocked = isFarm ? cfg.mobFilter?.lockedNameRoi : undefined;
  const lockedNameRoi: Rect =
    rawLocked && rawLocked.w > 0 && rawLocked.h > 0
      ? { x: Math.round(rawLocked.x), y: Math.round(rawLocked.y), w: Math.round(rawLocked.w), h: Math.round(rawLocked.h) }
      : { ...DEFAULT_LOCKED_MONSTER_NAME };

  const clickOffset: Point = {
    x: Math.round(isFarm ? (cfg.mobFilter?.clickOffset?.x ?? 0) : 0),
    y: Math.round(isFarm ? (cfg.mobFilter?.clickOffset?.y ?? 0) : 0),
  };

  // 到达路径点时停留的时间
  const stepIntervalMs = isFarm && cfg.movementSpeed && cfg.movementSpeed >= 100 ? cfg.movementSpeed : 800;

  const maxLoops = END_CONDITIONS.maxLoops;

  return {
    mode,
    castMode,
    waypoints,
    skills,
    monsterKeywords,
    monsterColor,
    ocrRange,
    lockedNameRoi,
    clickOffset,
    stepIntervalMs,
    maxLoops,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 暂停闸门:ctrl.paused 时阻塞,直到 resume(或 stop)命令到达。
 * 主循环每圈、定点识别的内层循环每轮都调用,保证「定点识别」在挂机点内长时间
 * 打怪/循环放技能时也能被 pause 命令及时中断。
 */
async function waitWhilePaused(ctx: WorkerContext, label: string): Promise<void> {
  const ctrl = ctx.moveAttack;
  if (!ctrl.paused) return;
  ctx.sendLog('info', `[${label}] 已暂停,等待 resume`);
  await new Promise<void>((resolve) => {
    ctrl.resumeResolve = resolve;
    // race 兜底:resume 可能先于 resumeResolve 注册到达,此时 paused 已是 false,直接放行
    if (!ctrl.paused) resolve();
  });
  ctrl.resumeResolve = null;
  if (ctrl.running) ctx.sendLog('info', `[${label}] 继续`);
}

/**
 * 判断角色是否死亡(打怪循环的退出条件之一,与 maxLoops 并列)。
 * TODO: 死亡判断逻辑由你决定(如:识别复活按钮图色 / 血量 OCR 归零),
 * 目前恒返回 false = 不启用该退出条件。实现后返回 true 即退出打怪循环。
 */
function isCharacterDead(): boolean {
  return false;
}

/**
 * 释放一个技能(定点识别用;定点打怪保留原有内联实现,未走这里):
 *   target 缺省施法 = 移动到 clickPos → 按键 → 左键点击 → 等吟唱
 *   quick  快捷施法 = 只按键 → 等吟唱
 *   self   状态施法 = 点角色自身(画面中心上方)→ 右键 → 按键 → 等吟唱
 *   item   物品使用 = 只按快捷键
 * 调用方负责 CD 判定 / lastCast 记录 / target 落点是否有效。
 */
async function castSkill(
  ctx: WorkerContext,
  input: any,
  view: ViewGeometry,
  skill: MoveAttackSkill,
  clickPos: Point | null,
  label: string,
): Promise<void> {
  const skillLabel = `${skill.key}${skill.name ? `·${skill.name}` : ''}`;

  if (skill.method === 'self') {
    await input.moveMouse({ x: view.center.x, y: view.center.y - 50 }, { kind: 'instant' });
    await input.delay(200);
    await input.click('right');
    await input.delay(300);
    await input.pressKey(skill.key);
    if (skill.castMs > 0) await sleep(skill.castMs);
    ctx.sendLog('info', `[${label}] 释放 ${skillLabel} @自身(状态施法)`);
  } else if (skill.method === 'quick') {
    await input.pressKey(skill.key);
    if (skill.castMs > 0) await sleep(skill.castMs);
    ctx.sendLog('info', `[${label}] 释放 ${skillLabel}(快捷施法)`);
  } else if (skill.method === 'item') {
    await input.pressKey(skill.key);
    ctx.sendLog('info', `[${label}] 使用物品 ${skillLabel}(物品使用)`);
  } else {
    await input.moveMouse(clickPos!, { kind: 'instant' });
    await input.pressKey(skill.key);
    await input.click('left');
    if (skill.castMs > 0) await sleep(skill.castMs);
    ctx.sendLog('info', `[${label}] 释放 ${skillLabel} @(${clickPos!.x},${clickPos!.y})`);
  }
}

/**
 * 点击方向(弧度,屏幕坐标系):
 * - FIXED_AIM.mode='behind'(默认):移动方向的反方向(引怪:怪在身后追着你跑)
 * - FIXED_AIM.mode='fixed':固定角度 FIXED_AIM.fixedAngleDeg
 */
function aimAngle(current: MapPosition, prev: MapPosition | null): number {
  if (FIXED_AIM.mode === 'fixed') return (FIXED_AIM.fixedAngleDeg * Math.PI) / 180;
  if (!prev) return 0; // 第一个点没有上一位置可参考,默认正右
  // 地图坐标 y 轴向南 = 屏幕 y 轴向南,atan2 角可直接映射到屏幕偏移
  return Math.atan2(current.y - prev.y, current.x - prev.x) + Math.PI; // 移动反方向
}

/** 角度 + 离自身距离(px)→ 屏幕点(自身 = 画面中心) */
function pointAt(view: ViewGeometry, angle: number, distancePx: number): Point {
  return {
    x: Math.round(view.center.x + distancePx * Math.cos(angle)),
    y: Math.round(view.center.y + distancePx * Math.sin(angle)),
  };
}

/**
 * 把"离自身多远"夹到游戏画面内,方向不变。
 * 画面中心到上下边只有半个画面高(1280x800 是 400px):竖着走时 600px 会点出窗口
 * (点可能落到桌面/别的程序上),所以沿该方向取最近的边界作为距离上限。
 * @returns { distance, clamped } clamped=true 表示距离被边界截短过
 */
function clampDistanceToView(view: ViewGeometry, angle: number, distancePx: number): { distance: number; clamped: boolean } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const { x: minX, y: minY, w, h } = view.roi;
  const maxX = minX + w;
  const maxY = minY + h;
  let maxDistance = distancePx;
  const EPS = 1e-6;
  if (dx > EPS) maxDistance = Math.min(maxDistance, (maxX - CLICK_MARGIN - view.center.x) / dx);
  else if (dx < -EPS) maxDistance = Math.min(maxDistance, (minX + CLICK_MARGIN - view.center.x) / dx);
  if (dy > EPS) maxDistance = Math.min(maxDistance, (maxY - CLICK_MARGIN - view.center.y) / dy);
  else if (dy < -EPS) maxDistance = Math.min(maxDistance, (minY + CLICK_MARGIN - view.center.y) / dy);
  const distance = Math.max(0, maxDistance);
  return { distance, clamped: distance < distancePx };
}

// ===== 定点识别(fixed-detect)=====

/** 定点识别「一次到点」的运行参数 */
interface DetectSpotParams {
  ctx: WorkerContext;
  input: any;
  view: ViewGeometry;
  conf: ResolvedConfig;
  waypoint: ResolvedWaypoint;
  detector: MonsterNameDetector;
  lastCast: Map<string, number>;
  label: string;
}

const fmtRange = (r: Rect): string => `x=${r.x},y=${r.y},w=${r.w},h=${r.h}`;

/** 点击识别到的怪名以锁定怪物(名字坐标 + 配置的点击偏移) */
async function clickMonsterName(input: any, pos: Point, conf: ResolvedConfig): Promise<void> {
  await input.moveMouse({ x: pos.x + conf.clickOffset.x, y: pos.y + conf.clickOffset.y }, { kind: 'instant' });
  await input.delay(200);
  await input.click('left');
}

/**
 * 锁定的怪物是否还在:HUD 里显示着名字(=锁定中),或识别范围内还能找到该名字(OCR 读 HUD 失败时的兜底)。
 * 怪物被锁定后,游戏会在固定的「已锁定怪物名称」区域(conf.lockedNameRoi,默认 95,109,105x35)显示它的名字,
 * 怪死 / 丢失锁定时该区域变空 —— 这是「怪名消失」的主判据。
 */
function isLockAlive(detector: MonsterNameDetector, name: string): boolean {
  return detector.isLocked() || detector.isPresent(name);
}

/**
 * 定点识别(一次到点):识别怪名 → 左键点击锁定 → 攻击,直到该点再也识别不到怪才离开
 * - 没配技能        → 普通攻击:左键点一下锁定(游戏自动攻击),怪死后再识别下一只
 * - 配了 + 智能施法 → 循环释放全部已配置技能(各自按 CD,排除「物品使用」)
 * - 配了 + 自定义施法→ 循环释放该点绑定的技能(含显式绑定的「物品使用」)
 * 怪死 / 丢失锁定判定 = 已锁定怪物名称 HUD 变空(见 isLockAlive)
 * 识别不到怪不再立刻离开:原地继续识别 DETECT.idleMs,连续这么久没怪才前往下一个路径点
 */
async function runDetectSpot(p: DetectSpotParams): Promise<void> {
  const { ctx, input, view, conf, waypoint, detector, lastCast, label } = p;
  // 定点识别用的攻击控制器:移动到攻击点 → 按键 → 左键点击 → 等吟唱
  const ctrl = ctx.moveAttack;
  // 参与攻击的技能:智能施法排除「物品使用」(药品交给看门狗的「生命回复」,不在每个点空放);
  // 自定义施法按用户显式绑定(含物品)
  const castable = conf.castMode === 'smart' ? waypoint.skills.filter((s) => s.method !== 'item') : waypoint.skills;
  const hasSkills = castable.length > 0;

  ctx.sendLog(
    'info',
    `[${label}] 定点识别:范围(${fmtRange(conf.ocrRange)}) 锁定名称区(${fmtRange(conf.lockedNameRoi)}) 颜色=${conf.monsterColor}` +
      ` 关键字=[${conf.monsterKeywords.join(',') || '无(纯OCR)'}]` +
      ` 技能=${hasSkills ? `${castable.length}个` : '无(普通攻击)'}` +
      ` 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}`,
  );

  let locked: { name: string; clickedAt: number } | null = null;
  // 最后一次「有怪」的时间:识别不到怪后据此判断是否已连续 idleMs 无怪 → 离开本挂机点
  let lastSeenAt = Date.now();

  while (ctrl.running) {
    await waitWhilePaused(ctx, label);
    if (!ctrl.running) return;

    // 1) 没有锁定目标 / 锁定的怪物已死(HUD 名字消失)→ 重新识别 + 左键点击锁定
    if (!locked || !isLockAlive(detector, locked.name)) {
      locked = null;
      const m = detector.detect();
      if (!m) {
        if (Date.now() - lastSeenAt >= DETECT.idleMs) {
          ctx.sendLog('info', `[${label}] 连续 ${DETECT.idleMs}ms 未识别到怪物,结束本挂机点`);
          return;
        }
        await sleep(DETECT.pollMs); // 还在等待窗口内:继续原地识别
        continue;
      }
      await clickMonsterName(input, m.screenPos, conf);
      // 等游戏把「已锁定怪物名称」写进 HUD,再读一次拿到真正的锁定名(读不到就退回识别到的名字)
      await sleep(DETECT.lockMs);
      const hudName = detector.readLockedName();
      locked = { name: hudName || m.name, clickedAt: Date.now() };
      lastSeenAt = Date.now();
      ctx.sendLog(
        'info',
        `[${label}] 识别到怪物「${m.name}」@(${m.screenPos.x},${m.screenPos.y}),左键点击锁定${hasSkills ? '' : '(普通攻击)'}` +
          (hudName && hudName !== m.name ? `(HUD 读到「${hudName}」)` : ''),
      );
      await sleep(DETECT.pollMs);
      continue;
    }

    // 怪名还在 = 有怪,刷新「有怪」时间
    lastSeenAt = Date.now();
    const lockedName = locked.name;

    // 2) 没配技能 → 普通攻击:锁定后游戏自动攻击;久未消失则补点一次,避免丢失锁定
    if (!hasSkills) {
      if (Date.now() - locked.clickedAt >= DETECT.reclickMs) {
        const pos = detector.locate(lockedName);
        if (pos) {
          await clickMonsterName(input, pos, conf);
          locked.clickedAt = Date.now();
          ctx.sendLog('info', `[${label}] 普通攻击:补点「${lockedName}」`);
        }
      }
      await sleep(DETECT.pollMs);
      continue;
    }

    // 3) 有技能 → 释放所有 CD 已好的技能(按配置顺序);全在 CD 中就等下一轮
    const now = Date.now();
    const ready = castable.filter((s) => now - (lastCast.get(s.id) || 0) >= s.cooldownMs);
    if (ready.length === 0) {
      await sleep(DETECT.pollMs);
      continue;
    }

    for (const skill of ready) {
      if (!ctrl.running) break;
      // 每个技能前确认怪还在:锁定名称消失说明怪死了 → 停止技能,回去重新识别
      if (!isLockAlive(detector, lockedName)) {
        ctx.sendLog('info', `[${label}] 怪物「${lockedName}」锁定名称消失,停止技能,重新识别`);
        locked = null;
        break;
      }
      let clickPos: Point | null = null;
      if (skill.method === 'target') {
        clickPos = detector.locate(lockedName);
        if (!clickPos) {
          locked = null;
          break;
        }
        if (skill.rangePx > 0) {
          const dist = Math.hypot(clickPos.x - view.center.x, clickPos.y - view.center.y);
          if (dist > skill.rangePx) {
            ctx.sendLog('info', `[${label}] ${skill.key} 跳过:怪距离 ${Math.round(dist)}px 超出施法距离 ${skill.rangePx}px`);
            continue;
          }
        }
      }
      await castSkill(ctx, input, view, skill, clickPos, label);
      lastCast.set(skill.id, Date.now());
    }
  }
}

/**
 * 挂机打怪主循环:
 *   沿路径点循环,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
 * 短 CD 技能(3s)每个点都能放,长 CD 技能(10s)隔几个点才轮到,无需对某个点做特殊处理。
 *
 * 只认 ctx.moveAttack 标志(pause/resume/stop 由 commands.ts 维护);
 * 自然跑完/异常返回结果,由调用方(任务 start() 或测试路径)决定如何上报。
 */
export async function runFarmLoop(ctx: WorkerContext, hwnd: number, opts?: FarmLoopOptions): Promise<FarmLoopResult> {
  const label = opts?.label ?? '挂机打怪';
  const ctrl = ctx.moveAttack;
  ctrl.running = true; // 每次进入都重置(上次 stop 会置 false)
  ctrl.stopReason = null; // 清掉上一轮的停止原因(如看门狗的角色停级)

  // 解析配置:优先用「挂机打怪」弹窗确认后下发的 taskConfig
  const conf = resolveConfig(ctx);
  const modeLabel = conf.mode === 'fixed-detect' ? '定点识别' : conf.mode === 'fixed' ? '定点打怪' : '移动识别';
  const farmSpotCount = conf.waypoints.filter((w) => w.type === 'farm-spot').length;
  ctx.sendLog(
    'info',
    `[${label}] 配置: 模式=${modeLabel}(${conf.mode}) 路径点=${conf.waypoints.length}(挂机点=${farmSpotCount}) 技能=[${conf.skills
      .map(
        (s) =>
          `${s.key}${s.name ? `·${s.name}` : ''}/${s.cooldownMs}ms/吟唱${s.castMs}ms/距离${
            s.rangePx === 0 ? '未配' : `${s.rangePx}px`
          }/${s.method}`,
      )
      .join(', ')}] 关键字=[${conf.monsterKeywords.join(',')}] 颜色=${conf.monsterColor} 移动间隔=${conf.stepIntervalMs}ms` +
      ` 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}` +
      ` 最大圈数=${conf.maxLoops}` +
      (conf.mode === 'move-detect' ? '(移动识别尚未实现,按定点打怪执行)' : '') +
      (ctx.init.taskConfig?.type === 'farm' ? '' : '(taskConfig 非 farm,用内置默认)'),
  );

  try {
    const vision = new DamooVisionProvider();
    const input = new DamooInputProvider() as any;
    vision.bind(hwnd);
    input.bind(hwnd);

    // 画面几何(扫描区/角色脚下)与标定都按设置里的分辨率取档
    const view = viewGeometry(ctx.init.settings?.resolution);
    const coordReader = new MapCoordReader(vision, mapCoordConfig(ctx));
    // 移动方式:精确点(目标地图坐标 → 屏幕点单击);标定见 MAP_CALIBRATION
    const calibration = buildCalibration(view);
    const movement = new MovementControllerByPrecisePoint(input, coordReader, calibration);

    const start = await movement.readPosition();
    if (!start) {
      const detail = '读不到当前坐标(检查设置里的分辨率与 MAP_COORD_CONFIG 的 coordRoi/coordColor)';
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { ok: false, detail };
    }
    ctx.sendLog('info', `[${label}] 起点: (${start.x}, ${start.y}) 地图=${start.map ?? '未知'}`);

    // todo
    // if (input) {
    //   const skill = conf.skills.filter((s) => s.key === 'F7')[0];
    //   await input.moveMouse(view.center, { kind: 'instant' });
    //   await input.delay(300);
    //   await input.click('left');
    //   await input.delay(300);
    //   await input.pressKey(skill.key);
    //   await input.delay(5000);
    //   await input.moveMouse(view.center, { kind: 'instant' });
    //   await input.click('left');
    //   await input.pressKey(skill.key);
    //   await input.delay(5000);
    //   await input.moveMouse(view.center, { kind: 'instant' });
    //   await input.click('left');
    //   await input.pressKey(skill.key);
    //   // 结束
    //   return { ok: true, detail: '成功' };
    // }

    const lastCast = ctx.lastCast; // 技能/物品上次使用时间戳(与看门狗的生命回复共用)
    // 定点识别的怪物名称识别器(无状态,复用同一个;配置来自 taskConfig.mobFilter)
    const detector = new MonsterNameDetector({
      roi: conf.ocrRange,
      color: conf.monsterColor,
      similarity: DETECT.similarity,
      keywords: conf.monsterKeywords,
      lockedRoi: conf.lockedNameRoi,
    });
    let loop = 0;
    let stuckCount = 0;
    /**
     * 上一个路径点的地图坐标:用来算「移动方向」。
     * 跨圈保留(不每圈重置)——群刷模式要把技能丢在移动反方向,第 2 圈起第一个点
     * 也该用真实的上一位置(上一圈最后一个点),否则只能瞎猜"正右"。
     */
    let prev: MapPosition | null = null;

    // 主循环:沿路径点移动,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
    while (conf.maxLoops === null || (ctrl.running && loop < conf.maxLoops)) {
      // 暂停等待(resume 命令会清 paused 并 resolve;stop 命令也会 resolve 并置 running=false)
      await waitWhilePaused(ctx, label);
      if (!ctrl.running) break;

      loop++;
      if (conf.maxLoops !== null) {
        ctx.setStatus('moving', `${label} 第 ${loop}/${conf.maxLoops} 圈`);
        ctx.sendLog('info', `[${label}] 第 ${loop}/${conf.maxLoops} 圈开始`);
      } else {
        ctx.setStatus('moving', `${label} 第 ${loop} 圈`);
        ctx.sendLog('info', `[${label}] 第 ${loop} 圈开始`);
      }

      // 角色死亡也退出打怪循环(判断逻辑见 isCharacterDead)
      if (isCharacterDead()) {
        const detail = `第 ${loop} 圈开始时检测到角色死亡,退出打怪循环`;
        ctx.sendLog('warn', `[${label}] ${detail}`);
        return { ok: true, detail };
      }

      // 沿路径点移动
      for (const wp of conf.waypoints) {
        if (!ctrl.running) break;

        // 移动前再查一次死亡(挂机点间移动耗时较长,避免死后继续跑完整圈)
        if (isCharacterDead()) {
          const detail = `第 ${loop} 圈途中检测到角色死亡,退出打怪循环`;
          ctx.sendLog('warn', `[${label}] ${detail}`);
          return { ok: true, detail };
        }

        const target: MapPosition = { map: start.map, x: wp.x, y: wp.y };
        // 移动到下一个路径点
        const arrived = await movement.moveTo(target, {
          // 精确点移动的落点就是目标坐标本身,坐标又是整数 → 1 个单位内即「到位」
          arriveTolerance: 1,
          stepIntervalMs: conf.stepIntervalMs, // 移动步进间隔(ms)
          noMoveTimeoutMs: 3000, //3S没有移动视为卡住
          // 坐标读数是整数,只要变了(±1)就算在移动,别让「没移动」计时误判卡住
          moveEpsilon: 0.5,
        });

        const current: MapPosition | null = (await movement.readPosition()) ?? prev;
        if (!arrived) {
          stuckCount++;
          ctx.sendLog('warn', `[${label}] 路径点 (${wp.x},${wp.y}) 未到达,卡住 ${stuckCount}`);
          // if (stuckCount >= END_CONDITIONS.maxStuckPoints) {
          //   const detail = `连续 ${stuckCount} 个路径点卡住,终止`;
          //   ctx.sendLog('warn', `[${label}] ${detail}`);
          //   return { ok: false, detail };
          // }
          prev = current;
          continue;
        }
        // 到达路径点:重置卡住计数
        stuckCount = 0;
        if (!current) continue;

        // 到达:站稳后再识别/释放
        // await sleep(SETTLE_MS);

        // 休息点 / 路径中间点:只路过,不放技能
        if (wp.type !== 'farm-spot') {
          ctx.sendLog('info', `[${label}] 到达 (${current.x},${current.y}) ${wp.type === 'rest' ? '休息点' : '路径点'},不放技能`);
          prev = current;
          continue;
        }
        // 定点识别(fixed-detect):OCR/找字识别怪名 → 左键点击锁定 → 按配置攻击到怪死
        // (识别不到怪 → 结束本挂机点;没配技能 = 普通攻击)
        if (conf.mode === 'fixed-detect') {
          await runDetectSpot({ ctx, input, view, conf, waypoint: wp, detector, lastCast, label });
          prev = current;
          continue;
        }

        // 定点打怪(fixed,当前实现):不扫怪,缺省施法技能打在固定方向(移动反方向)
        // 挂机点没绑定技能(用户显式清空):不放,避免误用旧"全部释放"兜底
        if (wp.skills.length === 0) {
          ctx.sendLog('info', `[${label}] 到达 (${current.x},${current.y}) 挂机点,未绑定技能,跳过`);
          prev = current;
          continue;
        }

        const angle = aimAngle(current, prev);
        // 定点打怪:固定方向的落点(每个技能各自的距离在下面按 rangePx 算)
        const fixedAim = clampDistanceToView(view, angle, FIXED_AIM.distance);
        const fixedPoint = pointAt(view, angle, fixedAim.distance);

        const clickDesc =
          `定点打怪:移动反方向落点 (${fixedPoint.x},${fixedPoint.y}) 默认距离=${fixedAim.distance}px` +
          (fixedAim.clamped ? '(超出画面,已夹到边界;各技能的"施法距离"可单独调)' : '');
        ctx.sendLog('info', `[${label}] 到达 (${current.x},${current.y}) 挂机点,技能 ${wp.skills.length} 个 ${clickDesc}`);

        const now = Date.now();
        // 待释放技能:
        //   自定义施法 = 该点绑定技能里所有 CD 已好的,依次全部释放(当前原有行为)
        //   智能施法   = 状态施法(self,自身 buff)不占"选一个"的名额:所有 CD 已好的一次性全放;
        //                其余技能里 CD 已好的,只取 cooldownMs 最长的一个释放;
        //                都没有可释放的就不释放,留到下一个挂机点
        //                物品(item)不参与自动挑选:回血药交给看门的「生命回复」
        let skillsToCast: MoveAttackSkill[];
        if (conf.castMode === 'smart') {
          const ready = wp.skills.filter((s) => now - (lastCast.get(s.id) || 0) >= s.cooldownMs);
          const readySelf = ready.filter((s) => s.method === 'self');
          const readyOther = ready.filter((s) => s.method !== 'self' && s.method !== 'item');
          const picked = readyOther.length ? [readyOther.reduce((a, b) => (b.cooldownMs > a.cooldownMs ? b : a))] : [];
          skillsToCast = [...readySelf, ...picked]; // 先放状态 buff,再放选中的输出技能
          if (skillsToCast.length === 0) {
            ctx.sendLog('info', `[${label}] 无可释放技能(全部冷却中),留到下一个挂机点`);
          }
        } else {
          skillsToCast = wp.skills.filter((s) => now - (lastCast.get(s.id) || 0) >= s.cooldownMs);
        }

        for (const skill of skillsToCast) {
          if (!ctrl.running) break;
          // 对于连续的技能配置
          if (wp.skills.length > 2) {
            await sleep(500);
          }

          const skillLabel = `${skill.key}${skill.name ? `·${skill.name}` : ''}`;

          // 缺省施法(target)落点:固定方向,距离 = 施法距离(未配则用 FIXED_AIM.distance),夹到画面内
          let clickPos: Point | null = null;
          if (skill.method === 'target') {
            const dist = skill.rangePx > 0 ? skill.rangePx : FIXED_AIM.distance;
            clickPos = pointAt(view, angle, clampDistanceToView(view, angle, dist).distance);
          }

          if (skill.method === 'self') {
            // 状态施法:左键点击角色自身(屏幕中心) → 按键 → 等吟唱
            await input.moveMouse({ x: view.center.x, y: view.center.y - 50 }, { kind: 'instant' });
            await input.delay(200);
            await input.click('right');
            await input.delay(300);
            await input.pressKey(skill.key);
            if (skill.castMs > 0) await sleep(skill.castMs);
            ctx.sendLog('info', `[${label}] 释放 ${skillLabel} @自身(状态施法)`);
          } else if (skill.method === 'quick') {
            // 快捷施法:只按键 → 等吟唱
            await input.pressKey(skill.key);
            if (skill.castMs > 0) await sleep(skill.castMs);
            ctx.sendLog('info', `[${label}] 释放 ${skillLabel}(快捷施法)`);
          } else if (skill.method === 'item') {
            // 物品使用:只按快捷栏键(自定义施法下用户显式绑定的药品)
            await input.pressKey(skill.key);
            ctx.sendLog('info', `[${label}] 使用物品 ${skillLabel}(物品使用)`);
          } else {
            await input.moveMouse(clickPos!, { kind: 'instant' });
            // 缺省施法:按键 → 等吟唱 → 左键点击落点
            await input.pressKey(skill.key);
            // await input.delay(200);
            await input.click('left');
            // 等吟唱
            if (skill.castMs > 0) await sleep(skill.castMs);
            ctx.sendLog('info', `[${label}] 释放 ${skillLabel} @(${clickPos!.x},${clickPos!.y})`);
          }
          lastCast.set(skill.id, Date.now());
          // await sleep(BETWEEN_SKILLS_MS);
        }

        prev = current;
      }
    }

    const detail = ctrl.stopReason ? `结束:共 ${loop} 圈,${ctrl.stopReason}` : `结束:共 ${loop} 圈,running=${ctrl.running}`;
    ctx.sendLog('info', `[${label}] ${detail}`);
    return { ok: true, detail };
  } catch (e: any) {
    const detail = `异常: ${e.message}`;
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }
}

export function createFarmTask(fc: TaskFactoryContext): TaskController {
  return {
    async start() {
      // 按任务配置同步看门狗(组队申请/验证码/生命回复/角色停级);
      // 一项都没勾 = 不启动,不产生额外轮询开销
      syncInterruptWatcher(fc.ctx);
      try {
        const r = await runFarmLoop(fc.ctx, fc.init.hwnd);
        // 自然跑完才走到这里(stop 命令直接杀进程);回到 idle 让卡片状态复位
        fc.ctx.setStatus('idle', r.detail);
      } finally {
        // 打怪结束(跑满圈数 / 角色停级)后不再需要看门狗
        stopInterruptWatcher(fc.ctx);
      }
    },
  };
}
