// 挂机打怪(farm)任务:沿路径点循环移动,到挂机点按绑定的技能释放
//
// 模式(2026-09 改版):
//   fixed        定点打怪(当前实现):到挂机点不做识别,技能打在固定方向固定距离(移动反方向)
//   fixed-detect 定点识别(即将推出):到挂机点 → 图色识别怪物名称 → 释放该点绑定的技能
//   move-detect  移动识别(尚未实现,UI 未开放):移动途中识别,识别到怪停下打
//
// 技能释放方式(按 taskConfig.skills 里每个技能的 method):
//   quick  快捷施法:只按技能键 → 等吟唱时间
//   target 缺省施法:按技能键 → 等吟唱时间 → 左键点击目标坐标
//                   (定点打怪=移动反方向「施法距离」处,未配则默认 300px,并夹到画面内;
//                    定点识别=识别到的怪,没识别到则跳过)
//   self   状态施法:左键点击角色自身(屏幕中心)→ 按技能键 → 等吟唱时间
// 技能字段:cooldownMs(技能时间间隔)/ castMs(吟唱时间)/ rangePx(施法距离,0=见上默认)
// 路径点:farm-spot 挂机点(绑定 skillIds,空=释放全部技能)/ rest 休息点 / path 路径中间点(后两种不放技能)
//
// 结束条件:stop 命令 / 跑满最大圈数 / 连续多个路径点卡住
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

import { dmApi } from '../../../../core/platform/damoo/dm-api';
import { DamooVisionProvider } from '../../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../../core/platform/input/damoo/DamooInputProvider';
import { MapCoordReader } from '../../../../core/perception/MapCoordReader';
import { MovementControllerByPrecisePoint } from '../../../../core/navigation/MovementController';
import type { PrecisePointConfig } from '../../../../core/navigation/MovementController';
import { CoordinateReader } from '../../../../core/state/CoordinateReader';
import type { Point } from '../../../../core/platform/vision/IVisionProvider';
import type { MapPosition } from '../../../../core/perception/types';
import type { WorkerContext } from '../context';
import type { FarmTaskConfig } from '../../../../shared/types';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM } from '../../../../core/constant-ocr/position';
import { COLOR_WHITE } from '../../../../core/constant-ocr/color';
import type { TaskController, TaskFactoryContext } from './types';

// ===== 内置默认值(taskConfig 里没配对应字段时用;按你的游戏实际情况改)=====

/** 屏幕中心(角色脚下):1280x800 窗口;分辨率不同则改 */
const SCREEN_CENTER: Point = { x: 640, y: 400 };

/** 默认路径点(地图坐标):从 A 出发依次经过 B/C/D/E,一圈结束后自动回到 A 再循环 */
const DEFAULT_PATH_POINTS = [
  { x: 100, y: 100 }, // A 起点,每圈终点也回到这里
  { x: 130, y: 100 }, // B
  { x: 130, y: 130 }, // C
  { x: 100, y: 130 }, // D
  { x: 85, y: 115 }, // E
];

/** 默认技能列表(taskConfig 未配技能时用;字段同 MoveAttackSkill) */
const DEFAULT_SKILLS: MoveAttackSkill[] = [
  { id: 'default-f1', key: 'F1', cooldownMs: 3000, castMs: 400, rangePx: 0, method: 'target' },
  { id: 'default-f2', key: 'F2', cooldownMs: 5000, castMs: 400, rangePx: 0, method: 'target' },
  { id: 'default-f3', key: 'F3', cooldownMs: 8000, castMs: 400, rangePx: 0, method: 'target' },
  { id: 'default-f4', key: 'F4', cooldownMs: 10000, castMs: 400, rangePx: 0, method: 'target' },
];

/** 默认找怪配置 */
const DEFAULT_MONSTER_KEYWORDS = ['野狼', '野猪'];
const DEFAULT_MONSTER_COLOR = 'FFFFFF-FFFFFF';

/** 两个技能释放之间的间隔(避免按键/点击冲突;按键到点击的等待已由技能 castMs 取代旧固定值) */
const BETWEEN_SKILLS_MS = 300;
/** 到达路径点后,站稳多久再扫描/释放 */
const SETTLE_MS = 200;

/** 怪物扫描配置(搜索区域/偏移是屏幕几何,留在代码里;关键字/颜色来自 taskConfig) */
const MONSTER_SCAN = {
  /** 搜索区域(游戏画面区,尽量排除 UI) */
  roi: { x: 0, y: 0, w: 1280, h: 800 },
  similarity: 0.85,
  /** 点击位置 = 找到的字 + 该偏移(点在怪身体而不是名字上) */
  clickOffset: { x: 0, y: 20 },
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
  maxLoops: 20,
  /** 血量低于该值结束;0 = 不检查(需要 profile.regions.selfHp 已配置) */
  minSelfHpPercent: 0,
  /** 连续多少个路径点未到达(卡住)就结束 */
  maxStuckPoints: 3,
};

/** 地图坐标读取配置 */
const MAP_COORD_CONFIG = {
  coordRoi: DEFAULT_ROLE_POSITION['1280*800'],
  coordColor: COLOR_WHITE,
  similarity: DEFAULT_SIM,
};

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
 */
const MAP_CALIBRATION: PrecisePointConfig = {
  /** 角色脚下 = 当前坐标在屏幕上的位置;1280x800 窗口中心 */
  selfScreen: SCREEN_CENTER,
  /** 游戏画面区域(大漠绑定后是窗口客户区相对坐标);底部 UI 不能点就把它减掉 */
  gameRect: MONSTER_SCAN.roi,
  margin: CLICK_MARGIN,
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
  /** 施法方式:quick=只按键 / target=按键+左键点目标 / self=点自己+按键 */
  method: 'quick' | 'target' | 'self';
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
  waypoints: ResolvedWaypoint[];
  skills: MoveAttackSkill[];
  monsterKeywords: string[];
  monsterColor: string;
  /** 移动步进间隔(ms),来自 taskConfig.movementSpeed */
  stepIntervalMs: number;
  maxLoops: number;
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
  const cfg = ctx.init.taskConfig as FarmTaskConfig | undefined;
  const isFarm = cfg?.type === 'farm';

  // 打怪模式:定点打怪(当前实现)/定点识别/移动识别(旧值自动迁移,见 LEGACY_MODE_MAP)
  const rawMode = isFarm && cfg.mode ? cfg.mode : 'fixed';
  const mode: ResolvedConfig['mode'] =
    (LEGACY_MODE_MAP[rawMode] as ResolvedConfig['mode'] | undefined) ??
    (rawMode as ResolvedConfig['mode']);

  // 任务级技能:配置了至少 1 个启用技能则用(过滤非法键/负 CD),否则用默认
  // 旧技能缺 method/castMs/rangePx → 按旧行为 target/400ms/不限距离
  let skills: MoveAttackSkill[] = DEFAULT_SKILLS;
  if (isFarm && cfg.skills && cfg.skills.some((s) => s.enabled !== false)) {
    const resolved = cfg.skills
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
    if (resolved.length > 0) skills = resolved;
  }

  // 路径点:waypoints 非空则用,否则用默认(默认点视为挂机点)
  // 挂机点按 skillIds 绑定技能;旧路径点无 skillIds → 兼容为"释放全部技能"
  const waypoints: ResolvedWaypoint[] =
    isFarm && cfg.waypoints && cfg.waypoints.length > 0
      ? cfg.waypoints.map((w) => {
          const type = (w.type ?? 'farm-spot') as ResolvedWaypoint['type'];
          let wpSkills: MoveAttackSkill[] = [];
          if (type === 'farm-spot') {
            const ids = w.skillIds && w.skillIds.length > 0 ? w.skillIds : skills.map((s) => s.id);
            wpSkills = skills.filter((s) => ids.includes(s.id));
          }
          return { x: w.x, y: w.y, type, skills: wpSkills };
        })
      : DEFAULT_PATH_POINTS.map((p) => ({
          x: p.x,
          y: p.y,
          type: 'farm-spot' as const,
          skills,
        }));

  // 找怪关键字/颜色
  const monsterKeywords =
    isFarm && cfg.mobFilter?.nameKeywords && cfg.mobFilter.nameKeywords.length > 0
      ? cfg.mobFilter.nameKeywords
      : DEFAULT_MONSTER_KEYWORDS;
  const monsterColor =
    isFarm && cfg.mobFilter?.nameColor?.trim()
      ? cfg.mobFilter.nameColor.trim()
      : DEFAULT_MONSTER_COLOR;

  // 移动步进间隔(角色移动速度)
  const stepIntervalMs =
    isFarm && cfg.movementSpeed && cfg.movementSpeed >= 100 ? cfg.movementSpeed : 800;

  const maxLoops = END_CONDITIONS.maxLoops;

  return {
    mode,
    waypoints,
    skills,
    monsterKeywords,
    monsterColor,
    stepIntervalMs,
    maxLoops,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 扫描怪物,返回屏幕坐标;找不到返回 null */
function scanMonster(keywords: string[], color: string): Point | null {
  for (const keyword of keywords) {
    const x = { value: 0, byref: true } as any;
    const y = { value: 0, byref: true } as any;
    const found = dmApi.findStrE(
      MONSTER_SCAN.roi.x,
      MONSTER_SCAN.roi.y,
      MONSTER_SCAN.roi.x + MONSTER_SCAN.roi.w,
      MONSTER_SCAN.roi.y + MONSTER_SCAN.roi.h,
      keyword,
      color,
      MONSTER_SCAN.similarity,
      x,
      y,
    );
    if (found === 1) {
      return {
        x: Math.floor(x.value) + MONSTER_SCAN.clickOffset.x,
        y: Math.floor(y.value) + MONSTER_SCAN.clickOffset.y,
      };
    }
  }
  return null;
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

/** 角度 + 离自身距离(px)→ 屏幕点(自身 = SCREEN_CENTER) */
function pointAt(angle: number, distancePx: number): Point {
  return {
    x: Math.round(SCREEN_CENTER.x + distancePx * Math.cos(angle)),
    y: Math.round(SCREEN_CENTER.y + distancePx * Math.sin(angle)),
  };
}

/**
 * 把"离自身多远"夹到游戏画面内,方向不变。
 * 1280x800 画面中心到上下边只有 400px:竖着走时 600px 会点出窗口
 * (点可能落到桌面/别的程序上),所以沿该方向取最近的边界作为距离上限。
 * @returns { distance, clamped } clamped=true 表示距离被边界截短过
 */
function clampDistanceToView(
  angle: number,
  distancePx: number,
): { distance: number; clamped: boolean } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const { x: minX, y: minY, w, h } = MONSTER_SCAN.roi;
  const maxX = minX + w;
  const maxY = minY + h;
  let maxDistance = distancePx;
  const EPS = 1e-6;
  if (dx > EPS) maxDistance = Math.min(maxDistance, (maxX - CLICK_MARGIN - SCREEN_CENTER.x) / dx);
  else if (dx < -EPS)
    maxDistance = Math.min(maxDistance, (minX + CLICK_MARGIN - SCREEN_CENTER.x) / dx);
  if (dy > EPS) maxDistance = Math.min(maxDistance, (maxY - CLICK_MARGIN - SCREEN_CENTER.y) / dy);
  else if (dy < -EPS)
    maxDistance = Math.min(maxDistance, (minY + CLICK_MARGIN - SCREEN_CENTER.y) / dy);
  const distance = Math.max(0, maxDistance);
  return { distance, clamped: distance < distancePx };
}

/**
 * 挂机打怪主循环:
 *   沿路径点循环,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
 * 短 CD 技能(3s)每个点都能放,长 CD 技能(10s)隔几个点才轮到,无需对某个点做特殊处理。
 *
 * 只认 ctx.moveAttack 标志(pause/resume/stop 由 commands.ts 维护);
 * 自然跑完/异常返回结果,由调用方(任务 start() 或测试路径)决定如何上报。
 */
export async function runFarmLoop(
  ctx: WorkerContext,
  hwnd: number,
  opts?: FarmLoopOptions,
): Promise<FarmLoopResult> {
  const label = opts?.label ?? '挂机打怪';
  const ctrl = ctx.moveAttack;
  ctrl.running = true; // 每次进入都重置(上次 stop 会置 false)

  // 解析配置:优先用「挂机打怪」弹窗确认后下发的 taskConfig,缺失回退默认值
  const conf = resolveConfig(ctx);
  const modeLabel =
    conf.mode === 'fixed-detect' ? '定点识别' : conf.mode === 'fixed' ? '定点打怪' : '移动识别';
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
      .join(
        ', ',
      )}] 关键字=[${conf.monsterKeywords.join(',')}] 颜色=${conf.monsterColor} 移动间隔=${conf.stepIntervalMs}ms` +
      ` 最大圈数=${conf.maxLoops}` +
      (conf.mode === 'move-detect' ? '(移动识别尚未实现,按定点打怪执行)' : '') +
      (ctx.init.taskConfig?.type === 'farm' ? '' : '(taskConfig 非 farm,用内置默认)'),
  );

  try {
    const vision = new DamooVisionProvider();
    const input = new DamooInputProvider() as any;
    vision.bind(hwnd);
    input.bind(hwnd);

    const coordReader = new MapCoordReader(vision, MAP_COORD_CONFIG);
    // 移动方式:精确点(目标地图坐标 → 屏幕点单击);标定见 MAP_CALIBRATION
    const movement = new MovementControllerByPrecisePoint(input, coordReader, MAP_CALIBRATION);

    const start = await movement.readPosition();
    if (!start) {
      const detail = '读不到当前坐标(检查 MAP_COORD_CONFIG 的 coordRoi/coordColor)';
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { ok: false, detail };
    }
    ctx.sendLog('info', `[${label}] 起点: (${start.x}, ${start.y}) 地图=${start.map ?? '未知'}`);

    // todo
    // if (input) {
    //   const skill = conf.skills.filter((s) => s.key === 'F7')[0];
    //   await input.moveMouse(SCREEN_CENTER, { kind: 'instant' });
    //   await input.delay(300);
    //   await input.click('left');
    //   await input.delay(300);
    //   await input.pressKey(skill.key);
    //   await input.delay(5000);
    //   await input.moveMouse(SCREEN_CENTER, { kind: 'instant' });
    //   await input.click('left');
    //   await input.pressKey(skill.key);
    //   await input.delay(5000);
    //   await input.moveMouse(SCREEN_CENTER, { kind: 'instant' });
    //   await input.click('left');
    //   await input.pressKey(skill.key);
    //   // 结束
    //   return { ok: true, detail: '成功' };
    // }

    const lastCast = new Map<string, number>(); // 每个技能的上次释放时间戳
    let loop = 0;
    let stuckCount = 0;
    /**
     * 上一个路径点的地图坐标:用来算「移动方向」。
     * 跨圈保留(不每圈重置)——群刷模式要把技能丢在移动反方向,第 2 圈起第一个点
     * 也该用真实的上一位置(上一圈最后一个点),否则只能瞎猜"正右"。
     */
    let prev: MapPosition | null = null;

    // 主循环:沿路径点移动,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
    while (ctrl.running && loop < conf.maxLoops) {
      // 暂停等待(resume 命令会清 paused 并 resolve;stop 命令也会 resolve 并置 running=false)
      if (ctrl.paused) {
        ctx.sendLog('info', `[${label}] 已暂停,等待 resume`);
        await new Promise<void>((resolve) => {
          ctrl.resumeResolve = resolve;
          // race 兜底:resume 可能先于 resumeResolve 注册到达,此时 paused 已是 false,直接放行
          if (!ctrl.paused) resolve();
        });
        ctrl.resumeResolve = null;
        if (!ctrl.running) break;
        ctx.sendLog('info', `[${label}] 继续`);
      }

      loop++;
      ctx.setStatus('moving', `${label} 第 ${loop}/${conf.maxLoops} 圈`);
      ctx.sendLog('info', `[${label}] 第 ${loop}/${conf.maxLoops} 圈开始`);

      // 沿路径点移动
      for (const wp of conf.waypoints) {
        if (!ctrl.running) break;

        const target: MapPosition = { map: start.map, x: wp.x, y: wp.y };
        // 移动到下一个路径点
        const arrived = await movement.moveTo(target, {
          // 精确点移动的落点就是目标坐标本身,坐标又是整数 → 1 个单位内即「到位」
          arriveTolerance: 1,
          stepIntervalMs: conf.stepIntervalMs, // 移动步进间隔(ms)
          noMoveTimeoutMs: 10000, //10S没有移动视为卡住
          // 坐标读数是整数,只要变了(±1)就算在移动,别让「没移动」计时误判卡住
          moveEpsilon: 0.5,
        });

        const current: MapPosition | null = (await movement.readPosition()) ?? prev;
        if (!arrived) {
          stuckCount++;
          ctx.sendLog(
            'warn',
            `[${label}] 路径点 (${wp.x},${wp.y}) 未到达,卡住 ${stuckCount}/${END_CONDITIONS.maxStuckPoints}`,
          );
          if (stuckCount >= END_CONDITIONS.maxStuckPoints) {
            const detail = `连续 ${stuckCount} 个路径点卡住,终止`;
            ctx.sendLog('warn', `[${label}] ${detail}`);
            return { ok: false, detail };
          }
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
          ctx.sendLog(
            'info',
            `[${label}] 到达 (${current.x},${current.y}) ${wp.type === 'rest' ? '休息点' : '路径点'},不放技能`,
          );
          prev = current;
          continue;
        }
        // 挂机点但没绑定技能(用户显式清空):不放,避免误用旧"全部释放"兜底
        if (wp.skills.length === 0) {
          ctx.sendLog('info', `[${label}] 到达 (${current.x},${current.y}) 挂机点,未绑定技能,跳过`);
          prev = current;
          continue;
        }

        // 定点打怪(fixed,当前实现):不扫怪,缺省施法技能打在固定方向(移动反方向)
        // 定点识别(fixed-detect):扫怪名 → 按每个技能的施法方式释放(没扫到 → 指向性技能跳过)
        const isDetect = conf.mode === 'fixed-detect';
        const angle = aimAngle(current, prev);
        const monster = isDetect ? scanMonster(conf.monsterKeywords, conf.monsterColor) : null;
        // 怪离角色(屏幕中心)的像素距离:target 技能按各自的施法距离过滤
        const monsterDist = monster
          ? Math.hypot(monster.x - SCREEN_CENTER.x, monster.y - SCREEN_CENTER.y)
          : null;

        // 定点打怪:固定方向的落点(每个技能各自的距离在下面按 rangePx 算)
        const fixedAim = clampDistanceToView(angle, FIXED_AIM.distance);
        const fixedPoint = pointAt(angle, fixedAim.distance);

        let clickDesc: string;
        if (isDetect) {
          clickDesc = monster
            ? `发现怪物 @(${monster.x},${monster.y}) 距离=${Math.round(monsterDist!)}px`
            : '未发现怪物';
        } else {
          clickDesc =
            `定点打怪:移动反方向落点 (${fixedPoint.x},${fixedPoint.y}) 默认距离=${fixedAim.distance}px` +
            (fixedAim.clamped ? '(超出画面,已夹到边界;各技能的"施法距离"可单独调)' : '');
        }
        ctx.sendLog(
          'info',
          `[${label}] 到达 (${current.x},${current.y}) 挂机点,技能 ${wp.skills.length} 个 ${clickDesc}`,
        );

        const now = Date.now();
        for (const skill of wp.skills) {
          if (!ctrl.running) break;
          const last = lastCast.get(skill.id) || 0;
          if (now - last < skill.cooldownMs) continue; // 技能时间间隔未到,跳过
          // 对于连续的技能配置
          if (wp.skills.length > 2) {
            await sleep(500);
          }

          const skillLabel = `${skill.key}${skill.name ? `·${skill.name}` : ''}`;

          // target(缺省施法)前置检查 + 落点:
          //   定点识别 → 需要识别到怪,且在施法距离内
          //   定点打怪 → 固定方向,距离 = 施法距离(未配则用 FIXED_AIM.distance),夹到画面内
          let clickPos: Point | null = null;
          if (skill.method === 'target') {
            if (isDetect) {
              if (!monster) continue; // 定点识别没扫到怪,指向性技能跳过
              if (skill.rangePx > 0 && monsterDist !== null && monsterDist > skill.rangePx) {
                ctx.sendLog(
                  'info',
                  `[${label}] ${skillLabel} 跳过:怪距离 ${Math.round(monsterDist)}px 超出施法距离 ${skill.rangePx}px`,
                );
                continue;
              }
              clickPos = monster;
            } else {
              const dist = skill.rangePx > 0 ? skill.rangePx : FIXED_AIM.distance;
              clickPos = pointAt(angle, clampDistanceToView(angle, dist).distance);
            }
          }

          if (skill.method === 'self') {
            // 状态施法:左键点击角色自身(屏幕中心) → 按键 → 等吟唱
            await input.moveMouse(
              { x: SCREEN_CENTER.x, y: SCREEN_CENTER.y - 50 },
              { kind: 'instant' },
            );
            await input.delay(200);
            await input.click('left');
            await input.delay(200);
            await input.pressKey(skill.key);
            if (skill.castMs > 0) await sleep(skill.castMs);
            ctx.sendLog('info', `[${label}] 释放 ${skillLabel} @自身(状态施法)`);
          } else if (skill.method === 'quick') {
            // 快捷施法:只按键 → 等吟唱
            await input.pressKey(skill.key);
            if (skill.castMs > 0) await sleep(skill.castMs);
            ctx.sendLog('info', `[${label}] 释放 ${skillLabel}(快捷施法)`);
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

    const detail = `结束:共 ${loop} 圈,running=${ctrl.running}`;
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
      const r = await runFarmLoop(fc.ctx, fc.init.hwnd);
      // 自然跑完才走到这里(stop 命令直接杀进程);回到 idle 让卡片状态复位
      fc.ctx.setStatus('idle', r.detail);
    },
  };
}
