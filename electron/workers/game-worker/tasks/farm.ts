// 挂机打怪(farm)任务:沿路径点循环,到点放技能(可选:先识别怪 / 顺手捡掉落物)
//
// ── 打怪模式(taskConfig.mode)────────────────────────────────────────────
//   fixed        定点打怪:不做任何识别,技能打在固定方向(移动反方向)   → runFixedSpot
//   fixed-detect 定点识别:找字/OCR 认出怪名 → 右键点击锁定(读 HUD 名字确认) → 左键点击开打 → 打到怪死 → runDetectSpot
//   move-detect  移动识别:尚未实现,按定点打怪执行
//
// ── 技能 ────────────────────────────────────────────────────────────────
//   taskConfig.skills 是任务级技能表;路径点用 skillIds 引用其中若干个(见 resolveWaypoints)
//   smart  智能施法:定点打怪 = 每个挂机点挑一个 CD 最长的可释放技能;定点识别 = 循环放全部
//   custom 自定义施法:按每个挂机点绑定的 skillIds 放(不选 = 全部)
//   每个技能按 method 施法(quick / target / self / item),实现只有 castSkill 一处
//   ⚠️ 智能施法不会把 item(药品)当输出技能放出去,否则每个挂机点都会白吃一瓶;
//      自定义施法下用户显式绑到挂机点的 item 技能照常使用
//   CD(含物品)统一记在 ctx.lastCast,与看门狗「生命回复」共用,避免两边抢同一个物品
//
// ── 物品拾取(taskConfig.pickup,不配 = 不开)──────────────────────────────
//   时机 = 拾取优先:定点识别里每轮循环先捡一次(正在打的怪也先放下);
//          走到路径点、准备移动前也捡一次。一轮会把范围内能找到的物品都捡完才返回
//          (需求:都捡完才开始下一个动作)。不打断"正在释放的那一个技能",只在技能之间插
//   找法 = core/perception/ItemNameDetector:配了名称 → 在勾选颜色的文字里找这件物品;
//          只配颜色 → 找色拿坐标(不读文字);判定 = 点击点周围一小块里名字/颜色消失
//   放弃 = 单件点了 PICKUP.maxClicks 次仍未消失 → 记进放弃表(abandonTtlMs 内不再碰),
//          继续捡下一件 / 下一步操作
//   细节见 runPickup
//
// ── 为什么"到点才放技能",而不是移动中放 ─────────────────────────────────
//   QQ 幻想是点地移动,移动本身就是鼠标左键操作(精确点移动:每步单击地面),
//   而指向性技能是"按技能键 → 左键点击目标"。移动中放技能,那次点击会被当成移动指令,
//   所以必须等 moveTo 到达(arriveTolerance 内)、角色停下来之后再放。
//   同理,拾取的左键也只能在"没在移动"时点 —— 见 walkWaypoints 里的调用顺序。
//
// ── 结束条件 ────────────────────────────────────────────────────────────
//   stop 命令 / 跑满最大圈数(END_CONDITIONS.maxLoops,当前不限)/ 角色死亡(isCharacterDead)
//
// ── 配置来源与兼容 ──────────────────────────────────────────────────────
//   ctx.init.taskConfig(「挂机打怪」弹窗保存后经 start-task 下发);
//   非 farm 配置或字段缺失一律回退内置默认值 —— 见 resolveConfig 一节
//
// ── 暂停/继续/停止 ──────────────────────────────────────────────────────
//   主循环只认 ctx.moveAttack 标志(commands.ts 维护)。标志放 ctx 上而不是循环内部:
//   命令可能在任务 start() 之前到达
//
// ── 复用 ────────────────────────────────────────────────────────────────
//   screenshot-test(移动攻击测试,thumbnail.ts → move-attack.ts)复用同一个 runFarmLoop,
//   只是 label 不同、结果回报方式不同 —— 循环逻辑只此一份

// 实测记录(手工跑图留下的路径点,方便复现调试)
// 223,56 -> 182,68 -> 151,74 -> 198,107 -> 230,82 -> 223,56
// 6s 0.5s / 5s 0.75s / 10s -> F7:1S
// 223/56 -- 209/57 -- 208/70 -- 206/73 -- 217/78 -- 220/86 -- 232/83 -- 240/78 --- 227/73 -- 219/63 --- 223/56
// 无泪南郊:229/53 -- 215/51 -- 202/50 -- 192/56 -- 182/61 -- 185/69 -- 184/76 -- 187/85 -- 199/90 -- 208/84 -- 219/82 -- 225/74 -- 217/65 -- 225/58

import { DamooVisionProvider } from '../../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../../core/platform/input/damoo/DamooInputProvider';
import { MapCoordReader } from '../../../../core/perception/MapCoordReader';
import { MonsterNameDetector } from '../../../../core/perception/MonsterNameDetector';
import { ItemNameDetector } from '../../../../core/perception/ItemNameDetector';
import type { DetectedItem, ItemPickupRule } from '../../../../core/perception/ItemNameDetector';
import { MovementControllerByPrecisePoint } from '../../../../core/navigation/MovementController';
import type { PrecisePointConfig } from '../../../../core/navigation/MovementController';
import type { IInputProvider, MouseButton } from '../../../../core/platform/input/IInputProvider';
import type { Point, Rect } from '../../../../core/platform/vision/IVisionProvider';
import type { MapPosition, MapCoordConfig } from '../../../../core/perception/types';
import type { WorkerContext } from '../context';
import { resolveWindowSizeKey, syncInterruptWatcher, stopInterruptWatcher } from '../interrupts';
import type { FarmTaskConfig, FarmPickupRule, GameResolution, ScreenRect, Waypoint } from '../../../../shared/types';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM, DEFAULT_LOCKED_MONSTER_NAME } from '../../../../core/constant-ocr/position';
import { COLOR_WHITE, COLOR_YELLOW_WHITE, COLOR_GREEN, COLOR_BLUE, COLOR_YELLOW, COLOR_PURPLE } from '../../../../core/constant-ocr/color';
import type { TaskController, TaskFactoryContext } from './types';

// ===== 类型 =====

/** 游戏画面几何:窗口客户区 + 角色脚下(客户区中心) */
interface ViewGeometry {
  /** 画面区域(大漠绑定后是窗口客户区相对坐标) */
  roi: Rect;
  /** 角色脚下 = 画面中心 */
  center: Point;
}

/** 解析后的技能(字段含义见 shared/types.ts 的 FarmSkillConfig) */
interface MoveAttackSkill {
  /** 技能配置 id(冷却记录按 id,key 可能重复配置) */
  id: string;
  key: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10';
  /** 技能名称(日志展示用) */
  name?: string;
  /** 技能时间间隔(毫秒,两次释放的最短间隔) */
  cooldownMs: number;
  /** 吟唱时间(毫秒):target=按键后等多久再点鼠标;quick/self=按键后等多久放下一个 */
  castMs: number;
  /** 施法距离(屏幕像素,以角色为圆心);target 技能:怪超出距离则跳过;0 = 用默认距离 */
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

/** 解析后的物品拾取配置(taskConfig.pickup + 内置默认值) */
interface ResolvedPickup {
  /** 一条有效规则都没有时按 false 处理(没东西可筛) */
  enabled: boolean;
  /** 拾取范围(客户区相对坐标) */
  roi: Rect;
  /** 拾取规则(任一条命中就捡;空 = 没东西可筛) */
  rules: ItemPickupRule[];
  /** 点击物品名的偏移 */
  clickOffset: Point;
  /** 两次扫描之间的最小间隔(ms) */
  scanIntervalMs: number;
  /** 单件物品最多点几次(点了这么多次还在就放弃这件) */
  maxClicks: number;
}

/** 解析后的完整运行配置 */
interface ResolvedConfig {
  mode: 'fixed' | 'fixed-detect' | 'move-detect';
  castMode: 'smart' | 'custom';
  /** 任务级技能表(已过滤未启用/非法键位) */
  skills: MoveAttackSkill[];
  waypoints: ResolvedWaypoint[];
  /** 怪名字关键字;识别模式下为空 = 纯 OCR(范围内任意文字都算怪名) */
  monsterKeywords: string[];
  /**
   * 怪名字颜色(大漠颜色格式,如 'FFFFFF-FFFFFF';可选值见 core/constant-ocr/color.ts)。
   * UI 里是多选,这里是 '|' 拼好的一个颜色串(找字/找色支持多色)
   */
  monsterColor: string;
  /** 定点识别的识别范围(客户区相对坐标) */
  ocrRange: Rect;
  /** 定点识别:已锁定怪物名称的显示区域(读它判断怪死/丢失锁定) */
  lockedNameRoi: Rect;
  /** 定点识别:点击怪名时的偏移 */
  clickOffset: Point;
  /** 移动步进间隔(ms) */
  stepIntervalMs: number;
  /** 物品拾取 */
  pickup: ResolvedPickup;
  /** 最多跑多少圈;null = 不限 */
  maxLoops: number | null;
}

/** 拾取运行时状态 */
interface PickupRuntime {
  detector: ItemNameDetector;
  /** 上次扫描时间(节流用) */
  lastScanAt: number;
  /** 已放弃的物品:坐标 key → 放弃时间戳(见 isItemAbandoned / abandonItem) */
  abandoned: Map<string, number>;
}

/** 一轮拾取的结果 */
type PickupOutcome =
  /** 至少捡起来过一件 */
  | 'picked'
  /** 范围内没有可捡物品(或没开启 / 被节流 / 只剩下放弃过的那件) */
  | 'none';

/**
 * 一次打怪循环的运行时上下文:在 runFarmLoop 里建一次,各子步骤共用。
 * 把 ctx / input / view / conf / label 这类"每个函数都要传"的东西收在一起,
 * 子步骤的签名就只剩"这次要处理谁"。
 */
interface FarmRun {
  ctx: WorkerContext;
  input: IInputProvider;
  view: ViewGeometry;
  conf: ResolvedConfig;
  /** 日志前缀 / 卡片状态文案里的任务名(挂机打怪 / 移动攻击) */
  label: string;
  /** 移动方式:目标地图坐标 → 屏幕点单击 */
  movement: MovementControllerByPrecisePoint;
  /** 怪名识别器(定点识别用) */
  monster: MonsterNameDetector;
  /** 拾取状态 */
  pickup: PickupRuntime;
  /** 技能/物品上次使用时间戳(与看门狗「生命回复」共用) */
  lastCast: Map<string, number>;
}

/** runFarmLoop 的运行结果(任务 start() 与 screenshot-test 测试路径共用) */
export interface FarmLoopResult {
  ok: boolean;
  detail: string;
}

/** runFarmLoop 的调用方标识 */
export interface FarmLoopOptions {
  /** 默认 '挂机打怪';screenshot-test 测试路径传 '移动攻击' */
  label?: string;
}

// ===== 可调常量(真机调试基本就改这一段)=====

/** 移动间隔缺省值(ms):taskConfig.movementSpeed 没配或小于 100 时用它 */
const DEFAULT_STEP_INTERVAL_MS = 800;

/** 默认找怪关键字(只在「移动攻击测试」这种没配关键字的定点打怪下兜底) */
const DEFAULT_MONSTER_KEYWORDS = ['野狼', '野猪'];
/** 「不限颜色」用的大漠颜色串:主色白 + 偏色 FF(每通道全容差)= 任意颜色 */
const DEFAULT_MONSTER_COLOR = 'FFFFFF-FFFFFF';

/** 定点识别的识别参数 */
const DETECT = {
  similarity: DEFAULT_SIM,
  /** 识别/判定循环的轮询间隔(OCR 较慢,别太频繁) */
  pollMs: 500,
  /** 普通攻击:锁定后用左键点击目标;超过这么久没再点则补点一次,维持攻击 */
  reclickMs: 1000,
  /** 识别不到怪后仍原地等待的时间(ms),连续这么久没怪才前往下一个挂机点(等刷新) */
  idleMs: 2000,
  /** 左键点击怪名后,等游戏把「已锁定怪物名称」写进 HUD 的时间(ms) */
  lockMs: 300,
};

/** 物品拾取的识别参数 */
const PICKUP = {
  similarity: DEFAULT_SIM,
  /** 两次拾取扫描之间的最小间隔(ms);一轮之内的连捡不受它限制 */
  scanIntervalMs: 1000,
  /** 点完一件物品后先快速确认一下(近处的物品点完名字立刻消失)(ms) */
  confirmMs: 400,
  /**
   * 快速确认没消失时,再等这么久(ms)看它有没有被捡起来。
   * 点物品名 = 命令角色走过去捡,远一点的物品要一两秒才走到 ——
   * 只按 confirmMs 判的话,远处的物品两次点击都会误判成"没捡起来"
   */
  walkWaitMs: 1200,
  /** 单件物品最多点几次:点了这么多次名字还在就放弃这件(继续下一步操作) */
  maxClicks: 2,
  /** 一轮拾取最多连捡几件(兜底:同色像素抖动让"消失"判定反复时,一轮也得能结束) */
  maxPerBatch: 6,
  /**
   * 放弃一件物品后,多久之内不再尝试它(ms)。
   * 没有它会一直重复点同一件捡不动的物品(它还在屏幕上,每次扫描都会命中);
   * 也不能永久拉黑 —— 万一它后来变得能捡了(走近了/刷新了)还得能捡
   */
  abandonTtlMs: 30000,
  /** 「名字还在不在」判定的局部区域半径(px,以点击点为中心) */
  nearRadiusPx: 60,
};

/** 定点打怪的固定施法方向/距离(不做识别,缺省施法技能就打在角色的这个方向上) */
const FIXED_AIM = {
  /** behind = 移动的反方向(引怪:怪在身后追着你跑)/ fixed = 固定角度 fixedAngleDeg(0=正右,90=正下) */
  mode: 'behind' as 'behind' | 'fixed',
  fixedAngleDeg: 0,
  /** 技能没配「施法距离」时,落点离屏幕中心(角色)的默认距离(px) */
  distance: 300,
};

/** 状态施法(self)点自己的位置:画面中心往上偏一点,避开脚下/其它 UI */
const SELF_CLICK_OFFSET_Y = 50;

/** 技能配得多时,每个技能释放前先让一拍(ms),避免连点被当成异常操作 */
const INTER_SKILL_MS = 500;

/** 点击点离画面边界至少留这么多像素(避免点到窗口边框/窗口外) */
const CLICK_MARGIN = 4;

/**
 * 画面四边避让游戏 UI 的边距(顶部头像/血条、底部技能栏)
 * 精确点移动的落点裁剪与「默认拾取范围」共用这一组数值:
 * 拾取时点到这一带只是白点一次,扫范围时就该把它们排除掉
 */
const VIEW_UI_MARGIN = { top: 100, bottom: 70, left: 10, right: 10 };

/**
 * 精确点移动要避开的游戏 UI 区域(画面坐标,1280x800 实测;宽高即需求给的宽高)
 * 落点进了这些区域等于点 UI,角色不动,所以移动控制器会沿「角色 → 落点」方向缩到区域外。
 * 上/下两边的边距(VIEW_UI_MARGIN)只裁一条通栏;这里补的是左右两角伸进画面里的那几块。
 * 换分辨率:游戏 UI 贴边且尺寸不变,贴着右边/下边的区域跟着那条边平移(见 blockRectsFor)。
 */
const BLOCK_RECTS_1280: ScreenRect[] = [
  { x: 1, y: 1, w: 178, h: 186 }, // 左上:小地图/头像
  { x: 406, y: 6, w: 440, h: 98 }, // 顶部中间:状态/目标条
  { x: 1097, y: 1, w: 183, h: 190 }, // 右上:小地图
  { x: 1, y: 596, w: 112, h: 196 }, // 左下:聊天框
  { x: 890, y: 720, w: 387, h: 69 }, // 右下:技能栏/功能按钮
];

/** 结束条件(全局旋钮) */
const END_CONDITIONS: { maxLoops: number | null } = {
  /** 跑满多少圈结束;null = 不限,只由 stop 命令 / 角色死亡结束 */
  maxLoops: null,
};

/** 技能键位白名单 */
const VALID_SKILL_KEYS = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);

/** 旧配置模式 → 新模式(旧的 single/patrol/aoe 统一迁到定点打怪) */
const LEGACY_MODE_MAP: Record<string, ResolvedConfig['mode']> = {
  single: 'fixed',
  patrol: 'fixed',
  aoe: 'fixed',
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
  margin: VIEW_UI_MARGIN,
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

// ===== 小工具 =====

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 矩形在日志里的写法 */
const fmtRange = (r: Rect): string => `x=${r.x},y=${r.y},w=${r.w},h=${r.h}`;

/** 技能在日志/提示里的名字:F3 或 F3·旋风斩 */
const skillLabel = (skill: MoveAttackSkill): string => `${skill.key}${skill.name ? `·${skill.name}` : ''}`;

/** 游戏画面几何:按设置里的分辨率取档(1600*900 / 1280*800),未设置时按 1280x800 */
function viewGeometry(resolution?: GameResolution | null): ViewGeometry {
  const roi: Rect = resolution === '1600*900' ? { x: 0, y: 0, w: 1600, h: 900 } : { x: 0, y: 0, w: 1280, h: 800 };
  return { roi, center: { x: Math.round(roi.w / 2), y: Math.round(roi.h / 2) } };
}

/**
 * 默认拾取范围(view.roi 去掉上下 UI 边距,见 VIEW_UI_MARGIN)
 * 不用整个画面:头顶/底部那一带是头像、血条、技能栏,捡东西点到那里是白点一次
 */
function defaultPickupRange(view: ViewGeometry): Rect {
  const m = VIEW_UI_MARGIN;
  return {
    x: view.roi.x + m.left,
    y: view.roi.y + m.top,
    w: Math.max(0, view.roi.w - m.left - m.right),
    h: Math.max(0, view.roi.h - m.top - m.bottom),
  };
}

/**
 * 把 BLOCK_RECTS_1280(1280x800 实测)换算到当前画面:尺寸不变,贴着右/下边的跟着那条边平移。
 * 容差 8px 是量出来的余量:技能栏右边界量到 1277(离右边 3px)、聊天框下边界量到 792(离下边 8px),
 * 都是贴着窗口边缘的那几像素,窗口变大时它们跟着边缘走。左/上边的区域本来就贴着 0/1,不用平移。
 * 1600x900 未实测,是按贴边规则推的;量到更准的位置后直接改 BLOCK_RECTS_1280 即可。
 */
function blockRectsFor(view: ViewGeometry): Rect[] {
  const dx = view.roi.w - 1280;
  const dy = view.roi.h - 800;
  const EDGE_TOLERANCE = 8;
  const nearEdge = (value: number, edge: number): boolean => Math.abs(value - edge) <= EDGE_TOLERANCE;
  return BLOCK_RECTS_1280.map((r) => ({
    x: view.roi.x + r.x + (nearEdge(r.x + r.w, 1280) ? dx : 0),
    y: view.roi.y + r.y + (nearEdge(r.y + r.h, 800) ? dy : 0),
    w: r.w,
    h: r.h,
  }));
}

/** 矩形字段清洗:宽高必须为正才有意义,否则回退 fallback(并拷一份,避免调用方共享引用) */
function normalizeRect(r: ScreenRect | undefined, fallback: Rect): Rect {
  if (!r || r.w <= 0 || r.h <= 0) return { ...fallback };
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

/** 字符串数组字段清洗:去掉空项与非字符串 */
function toStringList(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean);
}

/**
 * 暂停闸门:ctrl.paused 时阻塞,直到 resume(或 stop)命令到达。
 * 主循环每圈、定点识别的内层循环每轮都调用,保证「定点识别」在挂机点里长时间
 * 打怪/循环放技能时也能被 pause 命令及时中断。
 *
 * 同一时刻只有一个等待者(定点识别的内层循环跑的时候主循环并不在等),
 * 所以 resumeResolve 只存一个回调是安全的。
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
 * 角色是否死亡(打怪循环的退出条件之一,与 maxLoops 并列)。
 * TODO: 死亡判断由你决定(如识别复活按钮图色 / 血量 OCR 归零),
 * 目前恒返回 false = 不启用该退出条件;实现后返回 true 即退出打怪循环。
 */
function isCharacterDead(): boolean {
  return false;
}

/**
 * 角色死亡就返回退出结果,否则返回 null。
 * 统一封装是为了让"两个检查点"共用同一句文案,也免得调用处各写一段死分支。
 */
function checkDeath(run: FarmRun, loop: number, where: string): FarmLoopResult | null {
  if (!isCharacterDead()) return null;
  const detail = `第 ${loop} 圈${where}检测到角色死亡,退出打怪循环`;
  run.ctx.sendLog('warn', `[${run.label}] ${detail}`);
  return { ok: true, detail };
}

// ===== 配置解析(把 taskConfig 变成 ResolvedConfig)=====

/**
 * 解析运行配置:非 farm 配置或字段缺失一律回退内置默认值。
 * 旧配置兼容:mode single/patrol/aoe → fixed;技能缺 method/castMs/rangePx → target/400ms/用默认距离;
 * 路径点缺 skillIds → 该点用全部技能;怪名颜色是单值 nameColor → 当作只有一个元素
 */
function resolveConfig(ctx: WorkerContext): ResolvedConfig {
  const raw = ctx.init.taskConfig;
  // 非 farm 配置(如「缺省技能」)按"什么都没配"处理:下面每个字段各自走默认值
  const cfg: FarmTaskConfig | null = raw?.type === 'farm' ? raw : null;

  const view = viewGeometry(ctx.init.settings?.resolution);
  const mode = resolveMode(cfg);
  const castMode: ResolvedConfig['castMode'] = cfg?.castMode === 'custom' ? 'custom' : 'smart';
  const skills = resolveSkills(cfg);

  return {
    mode,
    castMode,
    skills,
    waypoints: resolveWaypoints(cfg, castMode, skills),
    ...resolveMonsterFilter(cfg, mode),
    ...resolveDetectAreas(cfg, view),
    stepIntervalMs: cfg && cfg.movementSpeed && cfg.movementSpeed >= 100 ? cfg.movementSpeed : DEFAULT_STEP_INTERVAL_MS,
    pickup: resolvePickup(ctx, cfg, view),
    maxLoops: END_CONDITIONS.maxLoops,
  };
}

/** 打怪模式:缺省 fixed;旧值(single/patrol/aoe)先迁到 fixed */
function resolveMode(cfg: FarmTaskConfig | null): ResolvedConfig['mode'] {
  const raw = cfg?.mode ?? 'fixed';
  return LEGACY_MODE_MAP[raw] ?? (raw as ResolvedConfig['mode']);
}

/** 任务级技能:只留启用的 + 键位合法的;数值兜底并夹取(兼容旧配置缺字段) */
function resolveSkills(cfg: FarmTaskConfig | null): MoveAttackSkill[] {
  return (cfg?.skills ?? [])
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

/**
 * 路径点解析:休息点 / 路径中间点不放技能,挂机点绑定技能 ——
 *   智能施法 = 直接把全部任务技能挂上(到点再按 CD 自动挑,见 pickSkillsToCast)
 *   自定义施法 = 按该点 skillIds 取子集;没配(空 / 未设)= 全部技能
 * waypoints 缺失(非 farm 配置)时返回空数组,由 runFarmLoop 拦下并提示
 */
function resolveWaypoints(cfg: FarmTaskConfig | null, castMode: ResolvedConfig['castMode'], skills: MoveAttackSkill[]): ResolvedWaypoint[] {
  const list: Waypoint[] = cfg && Array.isArray(cfg?.waypoints) ? cfg.waypoints : [];
  return list.map((w) => {
    const type = (w.type ?? 'farm-spot') as ResolvedWaypoint['type'];
    return { x: w.x, y: w.y, type, skills: type === 'farm-spot' ? pickWaypointSkills(w, castMode, skills) : [] };
  });
}

/** 一个挂机点用哪些技能(见 resolveWaypoints 的说明) */
function pickWaypointSkills(w: Waypoint, castMode: ResolvedConfig['castMode'], skills: MoveAttackSkill[]): MoveAttackSkill[] {
  if (castMode === 'smart') return skills;
  const ids = w.skillIds && w.skillIds.length > 0 ? w.skillIds : skills.map((s) => s.id);
  return skills.filter((s) => ids.includes(s.id));
}

/**
 * 找怪关键字 / 颜色。
 * 颜色:UI 是多选(nameColors),旧配置只有单值 nameColor。多色用 '|' 拼成一个颜色串
 * (大漠的找字/找色支持多色,任一命中即算;顺序 = 用户勾选顺序,日志里能看到)
 */
function resolveMonsterFilter(
  cfg: FarmTaskConfig | null,
  mode: ResolvedConfig['mode'],
): { monsterKeywords: string[]; monsterColor: string } {
  const keywords = toStringList(cfg?.mobFilter?.nameKeywords);
  // 定点打怪不做识别,这些关键字只是「移动攻击测试」的兜底,所以没配就补默认值
  const monsterKeywords = mode === 'fixed' && keywords.length === 0 ? DEFAULT_MONSTER_KEYWORDS : keywords;

  const colors = toStringList(cfg?.mobFilter?.nameColors);
  const legacy = cfg?.mobFilter?.nameColor?.trim();
  const all = colors.length > 0 ? colors : legacy ? [legacy] : [];

  return { monsterKeywords, monsterColor: all.length > 0 ? all.join('|') : DEFAULT_MONSTER_COLOR };
}

/**
 * 定点识别的三个区域:识别范围 / 已锁定怪物名称 HUD 区 / 点击怪名的偏移。
 * 未配或宽高非法 → 回退默认(识别范围默认整个游戏画面;HUD 区默认实测常量,见 position.ts)
 */
function resolveDetectAreas(cfg: FarmTaskConfig | null, view: ViewGeometry): { ocrRange: Rect; lockedNameRoi: Rect; clickOffset: Point } {
  const f = cfg?.mobFilter;
  return {
    ocrRange: normalizeRect(f?.ocrRange, view.roi),
    lockedNameRoi: normalizeRect(f?.lockedNameRoi, DEFAULT_LOCKED_MONSTER_NAME),
    clickOffset: { x: Math.round(f?.clickOffset?.x ?? 0), y: Math.round(f?.clickOffset?.y ?? 0) },
  };
}

/**
 * 物品拾取:开关 + 范围(默认/自定义)+ 拾取规则
 * 一条有效规则都没有 = 没东西可筛 → 按不开启处理,并单独记一条日志(免得用户以为开了却没捡)
 */
function resolvePickup(ctx: WorkerContext, cfg: FarmTaskConfig | null, view: ViewGeometry): ResolvedPickup {
  const raw = cfg?.pickup;
  const rules = resolvePickupRules(raw);
  const enabled = raw?.enabled === true && rules.length > 0;

  if (raw?.enabled === true && !enabled) {
    ctx.sendLog('warn', '[挂机打怪] 已开启物品拾取,但一条有效规则都没有(颜色和名称全空)→ 本次按不开启处理');
  }

  return {
    enabled,
    roi: normalizeRect(raw?.rangeMode === 'custom' ? raw.range : undefined, defaultPickupRange(view)),
    rules,
    clickOffset: { x: Math.round(raw?.clickOffset?.x ?? 0), y: Math.round(raw?.clickOffset?.y ?? 0) },
    scanIntervalMs: PICKUP.scanIntervalMs,
    maxClicks: PICKUP.maxClicks,
  };
}

/**
 * 清洗拾取规则:
 *   新配置直接读 rules;旧配置(扁平的 colors + nameKeywords)= 当成一条规则(升级兼容)
 *   每条规则至少要有一个颜色或一个名称,否则丢掉 —— 空规则 = 什么都匹配,会变成见什么捡什么
 */
function resolvePickupRules(raw: FarmTaskConfig['pickup']): ItemPickupRule[] {
  const legacy: FarmPickupRule[] = [{ colors: raw?.colors, nameKeywords: raw?.nameKeywords }];
  const list = Array.isArray(raw?.rules) && raw.rules.length > 0 ? raw.rules : legacy;
  return list
    .map((r) => ({ colors: toStringList(r?.colors), nameKeywords: toStringList(r?.nameKeywords) }))
    .filter((r) => r.colors.length > 0 || r.nameKeywords.length > 0);
}

/** 颜色值 → 中文名(只用于日志/提示;认不出来的直接显示原值) */
const COLOR_LABELS: Record<string, string> = {
  [COLOR_WHITE]: '白',
  [COLOR_YELLOW_WHITE]: '黄白',
  [COLOR_GREEN]: '绿',
  [COLOR_BLUE]: '蓝',
  [COLOR_YELLOW]: '黄',
  [COLOR_PURPLE]: '紫',
};
const colorLabel = (c: string): string => COLOR_LABELS[c] ?? c;

/** 一条拾取规则在日志里的写法:紫(全部) / 蓝+[无极剑] */
function formatPickupRule(rule: ItemPickupRule): string {
  const colors = rule.colors.map(colorLabel).join('/') || '不限色';
  return rule.nameKeywords.length > 0 ? `${colors}+[${rule.nameKeywords.join(',')}]` : `${colors}(全部)`;
}

/** 打印本次解析结果(排查"为什么行为不对"时,先看这几行) */
function logResolvedConfig(ctx: WorkerContext, label: string, conf: ResolvedConfig): void {
  const modeLabel: Record<ResolvedConfig['mode'], string> = {
    fixed: '定点打怪',
    'fixed-detect': '定点识别',
    'move-detect': '移动识别(尚未实现,按定点打怪执行)',
  };
  const skills =
    conf.skills
      .map((s) => `${skillLabel(s)}/${s.cooldownMs}ms/吟唱${s.castMs}ms/距离${s.rangePx === 0 ? '未配' : `${s.rangePx}px`}/${s.method}`)
      .join(', ') || '无';
  const farmSpots = conf.waypoints.filter((w) => w.type === 'farm-spot').length;
  const pickup = conf.pickup.enabled
    ? `开启(范围(${fmtRange(conf.pickup.roi)}) 规则=[${conf.pickup.rules.map(formatPickupRule).join(' 或 ')}])`
    : '关闭';

  ctx.sendLog('info', `[${label}] 配置: 模式=${modeLabel[conf.mode]}(${conf.mode}) 路径点=${conf.waypoints.length}(挂机点=${farmSpots})`);
  ctx.sendLog(
    'info',
    `[${label}] 技能=[${skills}] 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}` +
      ` 移动间隔=${conf.stepIntervalMs}ms 最大圈数=${conf.maxLoops ?? '不限'}`,
  );
  ctx.sendLog('info', `[${label}] 找怪=[${conf.monsterKeywords.join(',') || '不限(纯OCR)'}] 颜色=${conf.monsterColor} 拾取=${pickup}`);
  if (ctx.init.taskConfig?.type !== 'farm') {
    ctx.sendLog('warn', `[${label}] taskConfig 不是 farm 配置(或未下发),本次全部用内置默认值`);
  }
}

// ===== 移动与瞄准 =====

/** 地图坐标读取配置(坐标区域按设置里的分辨率取档) */
function mapCoordConfig(ctx: WorkerContext): MapCoordConfig {
  return {
    coordRoi: DEFAULT_ROLE_POSITION[resolveWindowSizeKey(ctx.init.hwnd, ctx.init.settings?.resolution)],
    coordColor: COLOR_WHITE,
    similarity: DEFAULT_SIM,
  };
}

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
    samples: MAP_CALIBRATION.samples?.map((s) => ({ ...s, screen: { x: s.screen.x + dx, y: s.screen.y + dy } })),
    // 落点落进这些 UI 区域就不是"往那儿走"而是"点 UI",移动控制器会缩到区域外
    blockRects: blockRectsFor(view),
  };
}

/**
 * 施法方向(弧度,屏幕坐标系):
 * - FIXED_AIM.mode='behind'(默认)= 移动的反方向(引怪:怪在身后追着你跑)
 * - FIXED_AIM.mode='fixed'  = 固定角度 FIXED_AIM.fixedAngleDeg
 * 第一个点没有上一位置可参考,只能默认正右。
 * 地图坐标 y 轴向南 = 屏幕 y 轴向南,所以 atan2 角可以直接映射成屏幕偏移。
 */
function aimAngle(current: MapPosition, prev: MapPosition | null): number {
  if (FIXED_AIM.mode === 'fixed') return (FIXED_AIM.fixedAngleDeg * Math.PI) / 180;
  if (!prev) return 0;
  return Math.atan2(current.y - prev.y, current.x - prev.x) + Math.PI;
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
 * @returns clamped=true 表示距离被边界截短过
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

/** target 技能在"移动反方向"上的落点:距离 = 该技能的施法距离(未配用默认),再夹到画面内 */
function fixedAimPoint(view: ViewGeometry, angle: number, skill: MoveAttackSkill): Point {
  const dist = skill.rangePx > 0 ? skill.rangePx : FIXED_AIM.distance;
  return pointAt(view, angle, clampDistanceToView(view, angle, dist).distance);
}

// ===== 技能释放 =====

/**
 * 释放一个技能(定点打怪 / 定点识别共用,全文件唯一的施法实现):
 *   quick  快捷施法 = 只按键 → 等吟唱
 *   target 缺省施法 = 鼠标落到 clickPos → 按键 → 左键点击 → 等吟唱
 *   self   状态施法 = 点角色自身(画面中心偏上)→ 右键 → 按键 → 等吟唱
 *   item   物品使用 = 只按快捷键
 * 调用方负责 CD 判定与 lastCast 记录。
 * @returns true = 真的放出去了(调用方可以记 CD);false = 没放(如 target 没有可用落点)
 */
async function castSkill(run: FarmRun, skill: MoveAttackSkill, clickPos: Point | null): Promise<boolean> {
  const { ctx, input, view, label } = run;
  const name = skillLabel(skill);

  switch (skill.method) {
    case 'quick':
      await input.pressKey(skill.key);
      if (skill.castMs > 0) await sleep(skill.castMs);
      ctx.sendLog('info', `[${label}] 释放 ${name}(快捷施法)`);
      return true;

    case 'item':
      await input.pressKey(skill.key);
      ctx.sendLog('info', `[${label}] 使用物品 ${name}(物品使用)`);
      return true;

    case 'self':
      await input.moveMouse({ x: view.center.x, y: view.center.y - SELF_CLICK_OFFSET_Y }, { kind: 'instant' });
      await input.delay(200);
      await input.click('right');
      await input.delay(300);
      await input.pressKey(skill.key);
      if (skill.castMs > 0) await sleep(skill.castMs);
      ctx.sendLog('info', `[${label}] 释放 ${name} @自身(状态施法)`);
      return true;

    case 'target':
      if (!clickPos) {
        // 调用方没算出落点(怪名重新定位失败等):宁可少放一个技能,也不能瞎点
        ctx.sendLog('warn', `[${label}] ${name} 跳过:没有可用的施法落点`);
        return false;
      }
      await input.moveMouse(clickPos, { kind: 'instant' });
      await input.pressKey(skill.key);
      await input.click('left');
      if (skill.castMs > 0) await sleep(skill.castMs);
      ctx.sendLog('info', `[${label}] 释放 ${name} @(${clickPos.x},${clickPos.y})`);
      return true;
  }
}

// ===== 物品拾取(打怪间隙捡掉落物)=====

/** 坐标 → 放弃记录的 key:按 10px 网格取整(同一件物品两次扫描的坐标会有几像素抖动) */
const pickupPosKey = (pos: Point): string => `${Math.round(pos.x / 10)},${Math.round(pos.y / 10)}`;

/** 这件物品是不是刚被放弃过(TTL 内不再碰,TTL 一过自动失效) */
function isItemAbandoned(rt: PickupRuntime, pos: Point): boolean {
  const key = pickupPosKey(pos);
  const at = rt.abandoned.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > PICKUP.abandonTtlMs) {
    rt.abandoned.delete(key);
    return false;
  }
  return true;
}

/** 记下"这件物品点了几次没捡起来,先不捡了"(顺手清掉过期记录,免得 Map 一直长) */
function abandonItem(rt: PickupRuntime, pos: Point): void {
  const now = Date.now();
  for (const [key, at] of rt.abandoned) {
    if (now - at > PICKUP.abandonTtlMs) rt.abandoned.delete(key);
  }
  rt.abandoned.set(pickupPosKey(pos), now);
}

/** 等 waitMs 后看物品还在不在:不在了打一条日志并返回 true(捡起来了) */
async function pickupGone(run: FarmRun, item: DetectedItem, waitMs: number): Promise<boolean> {
  await sleep(waitMs);
  if (run.pickup.detector.isStillThereNear(item)) return false;
  run.ctx.sendLog('info', `[${run.label}] 物品${item.name ? `「${item.name}」` : ''}已消失,拾取完成`);
  return true;
}

/**
 * 捡一件物品:左键点击 → 看它消失没有,最多点 conf.pickup.maxClicks 次
 *
 * 每次点击后分两步判定:先按 confirmMs 快速确认(近处的物品点完名字立刻没了),
 * 没消失再等 walkWaitMs —— 点物品名其实是"命令角色走过去捡",远一点的物品要一两秒才走到。
 *
 * @returns true = 捡起来了(名字/颜色已消失);false = 点了上限次仍在(这件不要了)
 */
async function pickOneItem(run: FarmRun, item: DetectedItem): Promise<boolean> {
  const { ctx, input, conf, pickup, label } = run;
  const dropLabel = item.name ? `「${item.name}」` : '';
  const clickPos: Point = {
    x: item.screenPos.x + conf.pickup.clickOffset.x,
    y: item.screenPos.y + conf.pickup.clickOffset.y,
  };
  ctx.sendLog('info', `[${label}] 发现可拾取物品${dropLabel}@(${item.screenPos.x},${item.screenPos.y}),左键点击拾取`);

  for (let i = 0; i < conf.pickup.maxClicks; i++) {
    if (!ctx.moveAttack.running) return false;
    await waitWhilePaused(ctx, label);

    await input.moveMouse(clickPos, { kind: 'instant' });
    await input.delay(200);
    await input.click('left');

    if (await pickupGone(run, item, PICKUP.confirmMs)) return true;
    if (await pickupGone(run, item, PICKUP.walkWaitMs)) return true;
  }

  ctx.sendLog(
    'warn',
    `[${label}] 物品${dropLabel}点了 ${conf.pickup.maxClicks} 次仍在,这件不捡了` +
      `(${Math.round(PICKUP.abandonTtlMs / 1000)}s 内不再尝试):` +
      `可能不在拾取距离内,或已被别人捡走(可调小拾取范围 / 调「点击偏移」)`,
  );
  return false;
}

/**
 * 拾取(一轮 = 把范围内能捡的都捡掉)
 *
 *   反复「扫描 → 捡一件」,直到范围内没有可捡物品(或只剩放弃过的那件)才返回 ——
 *   需求是"识别到多个物品,都捡完才开始下一个动作",所以没返回就说明还没捡完。
 *   单件点了 maxClicks 次仍未消失 → 记进放弃表(TTL 内不再尝试),然后继续下一步操作。
 *
 * 「拾取优先」由调用方保证(见 walkWaypoints / runDetectSpot):每轮循环先捡一次,
 * 正在打的怪也先放下。拾取点击在点地移动的游戏里就是一条走位指令,施法途中点它会把人拉走。
 *
 * ⚠️ 一条"只按颜色"的规则里,大漠只给第一个命中点:被放弃的那件在 TTL 内会挡住
 *    同一条规则后面的物品(其它规则不受影响,detector 会跳过它继续往下找)。
 *
 * @returns 'picked' = 这轮至少捡起来过一件(调用方据此刷新"有怪"计时);
 *          'none'   = 这轮没捡到东西(没开启 / 被节流 / 范围内没有可捡物品)
 */
async function runPickup(run: FarmRun): Promise<PickupOutcome> {
  const { conf, pickup } = run;
  if (!conf.pickup.enabled) return 'none';

  const now = Date.now();
  // 节流:拾取要做找字/找色,别每个路径点都扫一遍(一轮之内的连捡不受它限制)
  if (now - pickup.lastScanAt < conf.pickup.scanIntervalMs) return 'none';
  pickup.lastScanAt = now;

  let pickedAny = false;
  for (let round = 0; round < PICKUP.maxPerBatch; round++) {
    if (!run.ctx.moveAttack.running) break;

    // 放弃过的那件直接跳过(交给 detector 判断,它能接着看后面的规则)
    const item = pickup.detector.detect((pos) => isItemAbandoned(pickup, pos));
    if (!item) break; // 范围内没东西可捡了 → 这轮拾取结束

    if (!(await pickOneItem(run, item))) {
      abandonItem(pickup, item.screenPos);
      break; // 捡不动就不耗在这件上,继续下一步操作
    }
    pickedAny = true;
  }

  return pickedAny ? 'picked' : 'none';
}

/**
 * 拾取优先:有可捡的就先捡,捡到就返回 true(调用方这一轮别再干别的了)
 *
 * 没捡到 / 被节流时只有一次时间比较的开销,所以每个循环里都可以放心调它。
 * 开着拾取时"正在打的怪也会先放下":拾取点击在点地移动的游戏里就是一条走位指令,
 * 会把人从怪身边拉走、丢掉锁定 —— 这里只是把这件事用日志说清楚,提醒看到日志的人
 * "刚才那只是被打断的,不是打不过"。
 */
async function pickupFirst(run: FarmRun, lockedName: string | null): Promise<boolean> {
  // 检查是否有可捡的物品
  if ((await runPickup(run)) !== 'picked') return false;
  // 如果有锁定的怪物,先放下它
  if (lockedName) {
    run.ctx.sendLog('info', `[${run.label}] 有可拾取物品,先放下「${lockedName}」去捡`);
  }
  return true;
}

// ===== 定点识别(fixed-detect)=====

/**
 * 把鼠标移到怪名上点击(名字坐标 + 配置的点击偏移):
 *   right = 右键:命令游戏锁定这个目标 —— 锁上了,HUD(conf.lockedNameRoi)里就会出现它的名字
 *   left  = 左键:对已锁定的目标出手(开始攻击 / 补点一次)
 */
async function clickMonsterName(run: FarmRun, pos: Point, button: MouseButton): Promise<void> {
  const { input, conf } = run;
  await input.moveMouse({ x: pos.x + conf.clickOffset.x, y: pos.y + conf.clickOffset.y }, { kind: 'instant' });
  await input.delay(200);
  await input.click(button);
}

/**
 * 锁定的怪物是否还在:HUD 里显示着名字(= 锁定中),或识别范围内还能找到该名字(读 HUD 失败时的兜底)。
 * 怪物被锁定后游戏会在固定的「已锁定怪物名称」区域(conf.lockedNameRoi)显示它的名字,
 * 怪死 / 丢失锁定时该区域变空 —— 这是「怪名消失」的主判据。
 */
function isLockAlive(run: FarmRun, name: string): boolean {
  return run.monster.isLocked() || run.monster.isPresent(name);
}

/**
 * 本挂机点是不是没得打、该走了:连续 DETECT.idleMs 没锁上过一只怪。
 * 「识别不到怪」和「识别到但右键锁不上(尸体)」都算没得打 —— 只按前者判的话,
 * 范围里留着一具尸体的名字会让循环一直「扫到 → 右键 → HUD 空」地原地空转,永远离不开本点。
 */
function leaveSpotIfIdle(run: FarmRun, lastSeenAt: number): boolean {
  if (Date.now() - lastSeenAt < DETECT.idleMs) return false;
  run.ctx.sendLog('info', `[${run.label}] 连续 ${DETECT.idleMs}ms 未锁定到怪物,结束本挂机点`);
  return true;
}

/**
 * 定点识别(一次到点):识别怪名 → 右键点击锁定 → 左键点击开打,直到该点再也打不到怪才离开
 * - 锁定 = 右键点击扫描到的目标:锁上了游戏才会把这个名字写进 HUD,读不到名字就当没锁上
 *   (HUD 里的名字与识别到的对不上时只打一条警告,不当作没锁上:OCR 读花字符是常事)
 * - 扫到了、右键点了、HUD 里却没出现名字 → 这个目标已经阵亡(名字还留在识别范围里),
 *   不攻击,回去接着扫下一只(连续这么扫 DETECT.idleMs 就打不出东西了,由 leaveSpotIfIdle 收工)
 * - 锁定后先左键点击扫描区域内的目标开始攻击,再按下面的技能打
 * - 没配技能        → 普通攻击:锁定后游戏自动攻击,久不结束则左键补点一次
 * - 配了 + 智能施法 → 循环释放全部已配置技能(各自按 CD,排除「物品使用」)
 * - 配了 + 自定义施法→ 循环释放该点绑定的技能(含显式绑定的「物品使用」)
 * 怪死 / 丢失锁定判定 = 已锁定怪物名称 HUD 变空(见 isLockAlive)
 * 识别不到怪不再立刻离开:原地继续识别 DETECT.idleMs,连续这么久没锁上怪才前往下一个路径点
 * 开了物品拾取时拾取优先:每轮循环先捡一次(见 pickupFirst),正在打的怪也先放下 ——
 *   捡东西会把人走开、丢掉锁定,下一轮重新识别(怪还在就重新锁上,不在就找下一只)
 */
async function runDetectSpot(run: FarmRun, wp: ResolvedWaypoint): Promise<void> {
  const { ctx, conf, view, label, monster, lastCast } = run;
  const ctrl = ctx.moveAttack;
  // 参与攻击的技能:智能施法排除「物品使用」(药品交给看门狗的「生命回复」,不在每个点空放);
  // 自定义施法按用户显式绑定(含物品)
  const castable = conf.castMode === 'smart' ? wp.skills.filter((s) => s.method !== 'item') : wp.skills;

  ctx.sendLog(
    'info',
    `[${label}] 定点识别:范围(${fmtRange(conf.ocrRange)}) 锁定名称区(${fmtRange(conf.lockedNameRoi)})` +
      ` 颜色=${conf.monsterColor} 关键字=[${conf.monsterKeywords.join(',') || '无(纯OCR)'}]` +
      ` 技能=${castable.length > 0 ? `${castable.length}个` : '无(普通攻击)'}` +
      ` 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}`,
  );

  // 当前锁定的怪物: name + 锁定(左键开打)的时间
  let locked: { name: string; clickedAt: number } | null = null;
  // 最后一次「锁上怪」的时间:据此判断是否已连续 idleMs 没得打 → 离开本挂机点(见 leaveSpotIfIdle)
  let lastSeenAt = Date.now();

  while (ctrl.running) {
    // 等待暂停
    await waitWhilePaused(ctx, label);
    if (!ctrl.running) return;

    // 0) 拾取优先:不管有没有正在打的怪,先把范围内的物品捡掉再继续。
    //    runPickup 会把能找到的都捡完才返回;捡到要刷新「有怪」计时
    //    (拾取本身耗时,别让它把下一点的等待窗口吃掉),没捡到则不刷新,该走就走
    if ((await await runPickup(run)) === 'picked') {
      lastSeenAt = Date.now();
      continue;
    }

    // 1) 没有锁定目标 / 锁定的怪物已死(HUD 名字消失)→ 重新识别 →  左键开打
    if (!locked || !isLockAlive(run, locked.name)) {
      locked = null;
      const m = monster.detect();
      ctx.sendLog('info', `[${label}] 没有锁住，所以开始识别到的怪物的坐标「${JSON.stringify(m?.screenPos)}」`);

      // 没有扫描到怪物
      if (!m) {
        // 识别不到怪物:连续 idleMs = 1S 没得打就离开本挂机点,否则原地继续识别(等刷新)
        if (leaveSpotIfIdle(run, lastSeenAt)) return;
        // 识别到怪物就停留pollMs秒，然后继续
        await sleep(DETECT.pollMs);
        continue;
      }

      // 左键点击开始攻击
      await clickMonsterName(run, monster.locate(m.name) ?? m.screenPos, 'left');
      ctx.sendLog('info', `[${label}] 普通攻击:左键点击「${JSON.stringify(m.screenPos)}」`);
      // 延迟200ms,确保锁定名称更新
      await sleep(200);
      // 点击点中怪物后，记录锁定的怪物
      const hudName = monster.readLockedName();
      // 锁定的怪物名称与识别到的怪物名称一致,且没有其他怪物名称包含在锁定名称中
      if (hudName && hudName.includes(m.name) && m.name.split('|').some((n) => hudName.includes(n))) {
        locked = { name: hudName, clickedAt: Date.now() };
        // 开始计时
        lastSeenAt = Date.now();
        ctx.sendLog('info', `[${label}] 已经识别到怪物「${hudName}」,不用点击左键`);
      }
      await sleep(DETECT.pollMs);
      continue;
    }

    // 怪名还在 = 有怪,刷新「有怪」时间
    lastSeenAt = Date.now();
    const lockedName = locked.name;

    // 2) 没配技能 → 普通攻击:锁定后游戏自动攻击;超过 reclickMs 没点则左键补点一次
    // if (castable.length === 0) {
    //   if (Date.now() - locked.clickedAt >= DETECT.reclickMs) {
    //     const pos = monster.locate(lockedName);
    //     if (pos) {
    //       await clickMonsterName(run, pos, 'left');
    //       locked.clickedAt = Date.now();
    //       ctx.sendLog('info', `[${label}] 普通攻击:左键点击「${lockedName}」`);
    //     }
    //   }
    //   await sleep(DETECT.pollMs);
    //   continue;
    // }

    // 3) 有技能 → 释放所有 CD 已好的技能(按配置顺序);全在 CD 中就等下一轮
    const now = Date.now();
    const ready = castable.filter((s) => now - (lastCast.get(s.id) || 0) >= s.cooldownMs);
    if (ready.length === 0) {
      await sleep(DETECT.pollMs);
      continue;
    }

    for (const skill of ready) {
      if (!ctrl.running) break;
      // 每个技能前确认怪还在:锁定名称消失说明怪死了 → 停手,回去重新识别
      if (!isLockAlive(run, lockedName)) {
        ctx.sendLog('info', `[${label}] 怪物「${lockedName}」锁定名称消失,停止技能,重新识别`);
        locked = null;
        break;
      }
      let clickPos: Point | null = null;
      if (skill.method === 'target') {
        clickPos = monster.locate(lockedName);
        if (!clickPos) {
          // 怪名重新定位失败(怪死了/被挡住):别瞎点,回去重新识别
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
      if (await castSkill(run, skill, clickPos)) lastCast.set(skill.id, Date.now());
    }
  }
}

// ===== 定点打怪(fixed)=====

/**
 * 定点打怪(一次到点,不做识别):技能打在固定方向上
 * - 方向 = 移动的反方向(见 aimAngle),落点 = 该技能的距离(未配用 FIXED_AIM.distance)夹到画面内
 * - 待释放技能见 pickSkillsToCast;没绑定技能的挂机点直接跳过
 *   (用户显式清空 = 这个点不干活,不兜底"全部技能",免得误放)
 */
async function runFixedSpot(run: FarmRun, wp: ResolvedWaypoint, current: MapPosition, prev: MapPosition | null): Promise<void> {
  const { ctx, view, label, lastCast } = run;

  if (wp.skills.length === 0) {
    ctx.sendLog('info', `[${label}] 到达 (${current.x},${current.y}) 挂机点,未绑定技能,跳过`);
    return;
  }

  const angle = aimAngle(current, prev);
  const aim = clampDistanceToView(view, angle, FIXED_AIM.distance);
  const aimPoint = pointAt(view, angle, aim.distance);
  ctx.sendLog(
    'info',
    `[${label}] 到达 (${current.x},${current.y}) 挂机点,技能 ${wp.skills.length} 个 ` +
      `定点打怪:移动反方向落点 (${aimPoint.x},${aimPoint.y}) 默认距离=${aim.distance}px` +
      (aim.clamped ? '(超出画面,已夹到边界;各技能的"施法距离"可单独调)' : ''),
  );

  const skillsToCast = pickSkillsToCast(run, wp, Date.now());
  if (skillsToCast.length === 0) {
    ctx.sendLog('info', `[${label}] 无可释放技能(全部冷却中),留到下一个挂机点`);
    return;
  }

  for (const skill of skillsToCast) {
    if (!ctx.moveAttack.running) break;
    // 技能配得多时,每个技能释放前先让一拍,避免连点被当成异常操作
    if (wp.skills.length > 2) await sleep(INTER_SKILL_MS);
    const clickPos = skill.method === 'target' ? fixedAimPoint(view, angle, skill) : null;
    if (await castSkill(run, skill, clickPos)) lastCast.set(skill.id, Date.now());
  }
}

/**
 * 挑出这个挂机点本轮要放的技能(CD 已好的)
 *   custom = 该点绑定技能里所有 CD 已好的,依次全放
 *   smart  = 状态施法(self,自身 buff)不占"选一个"的名额 → CD 已好的一次性全放;
 *            其余技能里只取 cooldownMs 最长的一个;都没有可释放的就留到下一个挂机点
 *   item 技能不参与智能挑选:回血药交给看门狗的「生命回复」,否则每个点都会被白白吃掉
 */
function pickSkillsToCast(run: FarmRun, wp: ResolvedWaypoint, now: number): MoveAttackSkill[] {
  const ready = wp.skills.filter((s) => now - (run.lastCast.get(s.id) || 0) >= s.cooldownMs);
  if (run.conf.castMode !== 'smart') return ready;

  const selfBuffs = ready.filter((s) => s.method === 'self');
  const others = ready.filter((s) => s.method !== 'self' && s.method !== 'item');
  const best = others.length > 0 ? [others.reduce((a, b) => (b.cooldownMs > a.cooldownMs ? b : a))] : [];
  return [...selfBuffs, ...best]; // 先放状态 buff,再放选中的输出技能
}

// ===== 主循环 =====

/**
 * 沿路径点循环:走到点 → (定点识别先锁怪) → 放技能 → 下一个点
 * - 每次移动前先扫一眼拾取(见 runPickup):拾取点击会走位,只能在没移动的时候做
 * - 卡住的点(超过 noMoveTimeoutMs 没动)记一条日志就跳过,不强求
 * - 目标地图名以最近一次读到的坐标为准:过图/传送后 start.map 就过期了,
 *   继续拿它当目标会让 moveTo 每次都判成「跨图」直接失败
 */
async function walkWaypoints(run: FarmRun, start: MapPosition): Promise<FarmLoopResult> {
  const { ctx, conf, label } = run;
  const ctrl = ctx.moveAttack;
  let loop = 0;
  /** 连续多少个路径点没到达(目前只用于日志;想改成"卡住几次就终止",在这里加判断) */
  let stuckCount = 0;
  /**
   * 上一个路径点的地图坐标:定点打怪用它算"移动方向"。
   * 跨圈保留(不每圈重置)—— 第 2 圈的第一个点也该用真实的上一位置(上一圈最后一个点),
   * 否则只能瞎猜"正右"。
   */
  let prev: MapPosition | null = null;
  let mapName = start.map;

  while (ctrl.running && (conf.maxLoops === null || loop < conf.maxLoops)) {
    await waitWhilePaused(ctx, label);
    if (!ctrl.running) break;

    loop++;
    const loopDesc = conf.maxLoops === null ? `第 ${loop} 圈` : `第 ${loop}/${conf.maxLoops} 圈`;
    ctx.setStatus('moving', `${label} ${loopDesc}`);
    ctx.sendLog('info', `[${label}] ${loopDesc}开始`);
    const deadAtStart = checkDeath(run, loop, '开始时');
    // 死亡时退出循环
    if (deadAtStart) return deadAtStart;

    for (const wp of conf.waypoints) {
      if (!ctrl.running) break;
      // 移动前再查一次死亡(挂机点之间移动耗时较长,避免死后还跑完整圈)
      const dead = checkDeath(run, loop, '途中');
      if (dead) return dead;

      // 移动前先把能捡的捡掉(移动本身是连续左键点击,拾取点击会和它抢鼠标):
      // 一轮会把范围内能找到的物品都捡完才返回,所以捡完才走下一个点
      if ((await runPickup(run)) === 'picked') {
        // 捡东西会把人走到物品旁边 → 重记"上一位置",免得定点打怪的方向算歪
        prev = (await run.movement.readPosition()) ?? prev;
      }

      // 移动到下一个路径点:精确点移动的落点就是目标坐标本身,坐标又是整数 → 1 个单位内即到位;
      // 坐标读数是整数,只要变了(±1)就算在移动,别让"没移动"计时误判卡住(3s 没动视为卡住)
      const arrived = await run.movement.moveTo(
        { map: mapName, x: wp.x, y: wp.y },
        {
          arriveTolerance: 1, // 到达容忍度:1 个单位内即到位
          stepIntervalMs: conf.stepIntervalMs, // 每次移动间隔
          noMoveTimeoutMs: 3000, // 3s 没动视为卡住
          moveEpsilon: 0.5, // 1 个单位内即到位
        },
      );
      // 读取当前位置(可能超出画面,落进 UI 区域)
      const current: MapPosition | null = await run.movement.readPosition();
      if (current?.map) mapName = current.map;
      // 落点超出画面会裁到画面内,落进配置的 UI 区域会缩到区域外,见 blockRects
      const here: MapPosition | null = current ?? prev;

      if (!arrived) {
        stuckCount++;
        ctx.sendLog('warn', `[${label}] 路径点 (${wp.x},${wp.y}) 未到达(累计卡住 ${stuckCount} 个点),跳过`);
        prev = here;
        continue;
      }
      // 到达后重置卡住计数
      stuckCount = 0;
      if (!here) continue;

      // 处理不同类型的路径点
      if (wp.type !== 'farm-spot') {
        // 休息点 / 路径中间点:只路过,不放技能
        ctx.sendLog('info', `[${label}] 到达 (${here.x},${here.y}) ${wp.type === 'rest' ? '休息点' : '路径点'},不放技能`);
        // 挂机点:定点识别或定点打怪
      } else if (conf.mode === 'fixed-detect') {
        // 定点识别:识别怪名 → 右键点击锁定(HUD 出现名字)→ 左键点击开打 → 按配置打到怪死
        // (连续识别不到怪 / 扫到的都是尸体 = 结束本挂机点)
        await runDetectSpot(run, wp);
      } else {
        // 定点打怪(默认):不识别,技能打在固定方向
        await runFixedSpot(run, wp, here, prev);
      }
      prev = here;
    }
  }

  const detail = ctrl.stopReason ? `结束:共 ${loop} 圈,${ctrl.stopReason}` : `结束:共 ${loop} 圈,running=${ctrl.running}`;
  ctx.sendLog('info', `[${label}] ${detail}`);
  return { ok: true, detail };
}

/**
 * 挂机打怪入口(任务 start() 与「移动攻击测试」共用)
 *
 * 只认 ctx.moveAttack 标志(pause/resume/stop 由 commands.ts 维护);
 * 自然跑完 / 异常都返回结果,由调用方决定怎么上报(任务复位卡片状态,测试回报给按钮)。
 */
export async function runFarmLoop(ctx: WorkerContext, hwnd: number, opts?: FarmLoopOptions): Promise<FarmLoopResult> {
  const label = opts?.label ?? '挂机打怪';
  const ctrl = ctx.moveAttack;
  ctrl.running = true; // 每次进入都重置(上次 stop 会置 false)
  ctrl.stopReason = null; // 清掉上一轮的停止原因(如看门狗的角色停级)

  // 解析配置:优先用「挂机打怪」弹窗确认后下发的 taskConfig
  const conf = resolveConfig(ctx);
  logResolvedConfig(ctx, label, conf);

  // 没有路径点 = 没什么可跑。不拦的话主循环会在空 for 里空转
  // (整圈没有 await,直接跑满一个核并刷屏日志)
  if (conf.waypoints.length === 0) {
    const detail = '没有配置路径点,无法开始(在「挂机打怪」弹窗里至少加 1 个路径点)';
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }

  try {
    // 绑窗口 + 建运行时环境
    const vision = new DamooVisionProvider();
    const input: IInputProvider = new DamooInputProvider();
    vision.bind(hwnd);
    input.bind(hwnd);

    // 画面几何(坐标区/角色脚下)、坐标读取、移动方式(精确点,标定见 MAP_CALIBRATION)
    const view = viewGeometry(ctx.init.settings?.resolution);
    const movement = new MovementControllerByPrecisePoint(input, new MapCoordReader(vision, mapCoordConfig(ctx)), buildCalibration(view));

    const start = await movement.readPosition();
    if (!start) {
      const detail = '读不到当前坐标(检查设置里的分辨率,以及坐标区域/颜色是否匹配)';
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { ok: false, detail };
    }
    ctx.sendLog('info', `[${label}] 起点: (${start.x}, ${start.y}) 地图=${start.map ?? '未知'}`);

    // 运行时环境
    const run: FarmRun = {
      ctx,
      input,
      view,
      conf,
      label,
      movement,
      // 怪名识别器(定点识别用;配置来自 taskConfig.mobFilter)
      monster: new MonsterNameDetector({
        roi: conf.ocrRange,
        color: conf.monsterColor,
        similarity: DETECT.similarity,
        keywords: conf.monsterKeywords,
        lockedRoi: conf.lockedNameRoi,
      }),
      // 拾取状态:开关关掉时 runPickup 第一行就返回,检测器只是构造出来放着,不做任何识别
      pickup: {
        detector: new ItemNameDetector({
          roi: conf.pickup.roi,
          rules: conf.pickup.rules,
          similarity: PICKUP.similarity,
          nearRadiusPx: PICKUP.nearRadiusPx,
        }),
        lastScanAt: 0,
        abandoned: new Map(),
      },
      // 技能/物品上次使用时间戳(与看门狗「生命回复」共用,避免两边抢同一个物品)
      lastCast: ctx.lastCast,
    };

    return await walkWaypoints(run, start);
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
