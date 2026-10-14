// 挂机打怪(farm)任务:沿路径点循环,到点放技能(可选:先识别怪 / 顺手捡掉落物)
//
// ── 打怪模式(taskConfig.mode)────────────────────────────────────────────
//   fixed        定点打怪:不做任何识别,技能打在固定方向(移动反方向)   → runFixedSpot
//   fixed-detect 定点识别:找字/OCR 认出怪名 → 左键点一下锁定(读 HUD 确认) → 打到怪死(尸体名字跳过) → runDetectSpot
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
//   stop 命令 / 角色死亡(detectCharacterDeath) / 条件回城(taskConfig.endReturn:
//   完成 N 圈或背包已负载 → 结束本轮打怪 → 回城(回城卷轴 / 小退)→ 走城市/跨境逻辑回到挂机图 →
//   重开一轮,不结束整个任务)
//
// ── 死亡回城补给 / 开工补给(taskConfig.resupply,见 resupply/resupply-runner.ts)──
//   死亡检查 = core/perception/DeathDetector(主判据:找字「原地复活」;兜底:OCR「死亡」标题),两个检查点共用 checkDeath
//   配了补给(resupply.enabled + auxConfigs.townProfile)= 复活 → 按档案检查耐久/药水 → 按需访问商人 NPC
//     跑对话配方 → 走回野外图,然后继续挂机;档案里没配商人 NPC 就直接去出城口返程;只有真的走不通才结束任务
//   同一段流程的第二个触发器 = 任务启动(resupply.runOnStart,见 runStartupResupply):
//     进主循环之前先跑一遍(不复活,位置已在挂机图则整段跳过),成功后才开始挂机
//   没配补给 = 老行为:检测到死亡即结束任务
//
// ── 配置来源与兼容 ──────────────────────────────────────────────────────
//   ctx.init.taskConfig(「挂机打怪」弹窗保存后经 start-task 下发);
//   附属配置(城镇档案/对话配方/挂机地图名)走 ctx.init.auxConfigs,同样由 start-task 下发;
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
import { dmApi } from '../../../../core/platform/damoo/dm-api';
import { MapCoordReader } from '../../../../core/perception/MapCoordReader';
import { MonsterNameDetector } from '../../../../core/perception/MonsterNameDetector';
import { detectBagFull } from '../../../../core/perception/BagFullDetector';
import { ItemNameDetector } from '../../../../core/perception/ItemNameDetector';
import type { DetectedItem, ItemPickupRule } from '../../../../core/perception/ItemNameDetector';
import { detectDeath } from '../../../../core/perception/DeathDetector';
import type { DeathDetection } from '../../../../core/perception/DeathDetector';
import { MovementControllerByPrecisePoint } from '../../../../core/navigation/MovementController';
import type { PrecisePointConfig } from '../../../../core/navigation/MovementController';
import { crossMapProfiles } from '../../../../core/navigation/MapCrossing';
import { travelWithinMap } from '../../../../core/navigation/RouteTraveler';
import type { MapCrossingProfile } from '../../../../core/navigation/MapCrossing';
import type { IInputProvider, MouseButton } from '../../../../core/platform/input/IInputProvider';
import { SKILL_KEYS, normalizeSkillKey, pressSkillKey } from '../../../../core/platform/input/skill-key';
import type { SkillKey } from '../../../../core/platform/input/skill-key';
import type { Point, Rect } from '../../../../core/platform/vision/IVisionProvider';
import type { MapPosition, MapCoordConfig } from '../../../../core/perception/types';
import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import type { WorkerContext } from '../context';
import { resolveWindowSizeKey, syncInterruptWatcher, stopInterruptWatcher } from '../interrupts';
import { REVIVE_ANCHOR, resolveResupplyConfig, runResupplyFlow } from '../resupply/resupply-runner';
import type { ResolvedResupply } from '../resupply/resupply-runner';
import { talkToNpc } from '../resupply/talk-npc';
import { departTownTo, returnViaScroll, transitCityToTown } from '../resupply/town-departure';
import { dismountPet, enablePreFarmPetSkill, mountPet } from '../pet-ride';
import type { PetRideSkill, ResolvedPetRide } from '../pet-ride';
import { resolveReloginConfig, returnViaRelogin } from '../relogin';
import type { ResolvedRelogin } from '../relogin';
import type { FarmTaskConfig, FarmEndReturnMethod, FarmPickupRule, GameResolution, ScreenRect, Waypoint } from '../../../../shared/types';
import { pressGameHotkey } from '../../../../shared/game-hotkeys';
import { isMainCity } from '../../../../shared/main-cities';
import { DEFAULT_ROLE_POSITION, DEFAULT_LOCKED_MONSTER_NAME } from '../../../../core/constant-ocr/position';
import { BAG_FULL_ROI, BAG_FULL_TEXTS } from '../../../../core/constant-ocr/bag';
import { COLOR_WHITE, COLOR_YELLOW_WHITE, COLOR_GREEN, COLOR_BLUE, COLOR_YELLOW, COLOR_PURPLE } from '../../../../core/constant-ocr/color';
import type { TaskController, TaskFactoryContext } from './types';
import { DEFAULT_FUZZY_SIM, DEFAULT_SIM } from '../../../../core/constant-ocr/sim';

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
  /** 技能键:第一页 F1-F10 / 第二页 TF1-TF10(按一次 Tab 切到第二页,见 platform/input/skill-key.ts) */
  key: SkillKey;
  /** 技能名称(日志展示用) */
  name?: string;
  /** 技能时间间隔(毫秒,两次释放的最短间隔) */
  cooldownMs: number;
  /** 吟唱时间(毫秒):target=按键后等多久再点鼠标;quick/self=按键后等多久放下一个 */
  castMs: number;
  /** 施法距离(屏幕像素,以角色为圆心);target 技能:怪超出距离则跳过;0 = 用默认距离 */
  rangePx: number;
  /** 施法方式:quick=只按键 / target=按键+左键点目标 / self=点自己+按键 / item=按键使用快捷栏物品 / pet=宠物技能(只按键,不参与打怪) */
  method: 'quick' | 'target' | 'self' | 'item' | 'pet';
}

/** 解析后的路径点 */
interface ResolvedWaypoint {
  x: number;
  y: number;
  /** farm-spot 挂机点(放技能) / rest 休息点 / path 路径中间点(都不放技能)/ entry 入图点(挂机循环不走) */
  type: 'farm-spot' | 'rest' | 'path' | 'entry';
  /** 该点绑定的技能(仅 farm-spot 用;空数组 = 不放) */
  skills: MoveAttackSkill[];
}

/** 入图路径点(回城/开工补给重新进图后,从地图入口走到挂机点的中间点) */
interface EntryPoint {
  x: number;
  y: number;
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
  /** 入图路径点(type='entry' 的那些,按列表顺序);回城/开工补给重新进图后走它 */
  entryPath: EntryPoint[];
  /** 地图跨越链路(中间地图档案,按穿越顺序;来自 mapCrossings + auxConfigs.mapProfiles);空 = 不跨图 */
  mapProfiles: MapCrossingProfile[];
  /** 物品拾取 */
  pickup: ResolvedPickup;
  /** 宠物技能(回城上骑 / 到挂机点下骑、打怪前开启宠物技能;缺省关闭,配置见 shared/types.ts 的 FarmPetRideConfig) */
  petRide: ResolvedPetRide;
  /** 回城卷轴(起点不认识时先回城;缺省关闭,配置见 shared/types.ts 的 FarmReturnScrollConfig) */
  returnScroll: ResolvedReturnScroll;
  /** 回城补给(死亡触发,runOnStart 时任务启动也跑一次;默认关闭,配置见 shared/types.ts 的 FarmResupplyConfig) */
  resupply: ResolvedResupply;
  /** 进入新地图时屏蔽所有人(换图就按 F11×4,见 blockAllPlayersIfMapChanged);缺省 false */
  blockAllPlayersOnNewMap: boolean;
  /** 小地图缩放:任务启动时按一次 Alt+- 缩小右上角小地图(缺省 true) */
  zoomOutMinimap: boolean;
  /** 关闭聊天背景:任务启动时点一次聊天框关掉背景(缺省 true) */
  closeChatBackground: boolean;
  /** 条件回城(达到条件结束本轮打怪并回城,再走城市/跨境逻辑回到挂机图继续下一轮) */
  endReturn: ResolvedEndReturn;
}

/** 解析后的条件回城配置(字段含义见 shared/types.ts 的 FarmEndReturnConfig) */
interface ResolvedEndReturn {
  enabled: boolean;
  /** 完成多少圈后回城;null = 不用这个条件 */
  loops: number | null;
  /** 背包/装备已负载(装满)时回城:扫聊天框里的提示,见 scanBagFullOnce */
  overloaded: boolean;
  method: FarmEndReturnMethod;
  /** 使用回城卷轴:最多按几次 / 每次按下后的观察窗口(ms) */
  scroll: { maxAttempts: number; pressIntervalMs: number };
  /** 小退回城:清怪开关 / 清怪总超时 / 最多尝试次数 / 清怪的独立识别参数覆盖(见 relogin.ts 的 ResolvedRelogin) */
  relogin: ResolvedRelogin;
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
  /** 移动方式:目标地图坐标 → 屏幕点单击(挂机主循环用) */
  movement: MovementControllerByPrecisePoint;
  /**
   * 补给专用的移动实例:坐标 reader 带分辨率档位(能读出地图名),
   * 让 RouteTraveler「目标图与当前图不同就停」的守卫生效 —— 踩上出城口切图后立即收手,
   * 不会照着旧地图坐标继续走(否则可能来回穿图/长时间卡住)。
   * 主循环那份 reader 不带档位(地图名恒 null),挂机行为完全不受影响。
   */
  travelMovement: MovementControllerByPrecisePoint;
  /** 该窗口的分辨率档位(感知层区域常量按档位取;死亡检测也要用) */
  size: WindowSizeKey;
  /** 读当前地图名(OCR 中文名,读不到返回空串)—— 补给用来确认城镇 / 开工补给确认位置 / 返程等切图 */
  readMapName: () => Promise<string>;
  /** 怪名识别器(定点识别用) */
  monster: MonsterNameDetector;
  /** 拾取状态 */
  pickup: PickupRuntime;
  /** 技能/物品上次使用时间戳(与看门狗「生命回复」共用) */
  lastCast: Map<string, number>;
  /** 已击杀怪物的尸体位置:坐标 key → 忽略截止时间(尸体名字还没消失,见 isCorpseIgnored / ignoreCorpse) */
  corpses: Map<string, number>;
  /** 上一次读到的地图名(「进入新地图时屏蔽所有人」用它判断是否换图);null = 还没读到过 */
  lastMapName: string | null;
  /**
   * 「背包已负载」的迟滞标志(见 scanBagFullOnce):
   * true = 已武装,扫到提示可以触发一次回城;触发后置 false,要等提示从屏幕上消失过才重新武装。
   * 用途:那条提示会一直留在聊天框里,没有迟滞就会"每圈都扫到 → 每圈都回城"来回跑。
   */
  bagFullArmed: boolean;
}

/**
 * 定点识别里"当前锁定的怪物"。
 * name 记识别到的名字(不是 HUD 读到的):它一定能在识别范围内 findStrE 到 ——
 * target 技能的定位、以及怪死后重新定位尸体位置都靠它;HUD 里的名字只用于判活和日志。
 */
interface LockedMonster {
  /** 目标名字(识别到的) */
  name: string;
  /** 最近一次锁定/点击的时间 */
  clickedAt: number;
  /** 最近一次读到 HUD 非空的时间:判活靠它(见 isLockAlive) */
  hudSeenAt: number;
}

/** runFarmLoop 的运行结果(任务 start() 与 screenshot-test 测试路径共用) */
export interface FarmLoopResult {
  ok: boolean;
  detail: string;
  /** 本次不是"结束任务",而是条件回城触发:调用方要回城 → 回到挂机图 → 重开一轮 */
  reset?: boolean;
}

/** runFarmLoop 的调用方标识 */
export interface FarmLoopOptions {
  /** 默认 '挂机打怪';screenshot-test 测试路径传 '移动攻击' */
  label?: string;
  /**
   * 是否允许"开工补给"(resupply.runOnStart):缺省 true(正式任务路径)。
   * 移动攻击测试传 false —— 测试只想看走位/打怪,不该顺带跑一趟城镇补给
   * (测试路径沿用上一次 start-task 留下的 taskConfig,否则会被开工补给带走)。
   */
  allowStartupResupply?: boolean;
  /**
   * 是否允许任务启动时的环境处理(小地图缩放 / 关闭聊天背景):缺省 true(正式任务路径)。
   * 移动攻击测试传 false —— 测试只想看走位/打怪,不该顺带改游戏环境。
   */
  allowStartupEnv?: boolean;
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
  /** 连续这么久没锁上怪(识别不到 / 识别到但已阵亡)才前往下一个挂机点(等刷新) */
  idleMs: 2000,
  /** 左键点击怪名后,等游戏把「已锁定怪物名称」写进 HUD 的时间(ms);实测 200 够,慢的机器往上调 */
  lockMs: 200,
  /**
   * HUD 读空后,还要连续空这么久才认"这只怪已死"(ms)。
   * 一次读空可能只是 OCR 抖动、名字正在刷新,直接判死会白锁一次(还得再点一次怪名)。
   */
  hudLostMs: 800,
  /**
   * 怪被击杀后,尸体名字还会在识别范围内停留这么久(ms),这段时间把它当"不可打"跳过。
   * 尸体名和活怪名在识别范围里长得一模一样(实测怪死后名字约 3s 才消失),
   * 不跳过它,重扫时又会把它当新目标、左键点一次(点地移动的游戏里这就是一次走位指令)。
   */
  corpseTtlMs: 3000,
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
const INTER_SKILL_MS = 400;

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
  { x: 1, y: 1, w: 207, h: 186 }, // 左上:小地图/头像
  { x: 406, y: 6, w: 440, h: 98 }, // 顶部中间:状态/目标条
  { x: 1097, y: 1, w: 183, h: 190 }, // 右上:小地图
  { x: 1, y: 588, w: 228, h: 213 }, // 左下:聊天框
  { x: 890, y: 720, w: 387, h: 90 }, // 右下:技能栏/功能按钮
];

/** 条件回城的默认值 */
const END_RETURN = {
  /** 回城卷轴最多按几次 */
  maxAttempts: 5,
  /** 每次按下后的观察窗口(ms):窗口内地图名变了 = 回城成功,否则再按一次(被攻击时卷轴可能不生效) */
  pressIntervalMs: 4000,
};

/** 技能键位白名单(F1-F10 第一页 / TF1-TF10 第二页,见 platform/input/skill-key.ts) */
const VALID_SKILL_KEYS = new Set<string>(SKILL_KEYS);

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
 * 角色死亡判定:找字「原地复活」(主判据)+ OCR「死亡」标题(兜底),命中其一即算死亡
 * (见 core/perception/DeathDetector)。返回值里带"哪个信号命中",日志靠它排错。
 * 打怪循环的退出条件之一(与条件回城并列);同步语义 —— 调用处(checkDeath)不做 await 判别。
 */
function detectCharacterDeath(run: FarmRun): DeathDetection {
  return detectDeath(dmApi, run.size);
}

/**
 * 死亡检查的结果:
 *   - null           没死,继续本圈
 *   - 'resupplied'   检测到死亡、回城补给成功(角色已回到挂机图)—— 调用处结束本圈,从第一个路径点重跑
 *   - exit           结束任务(补给失败 / 未开启补给),result 带退出原因
 */
type DeathCheck = { kind: 'resupplied' } | { kind: 'exit'; result: FarmLoopResult } | null;

/**
 * 角色死亡就返回退出结果,否则返回 null。
 * 统一封装是为了让"两个检查点"共用同一句文案,也免得调用处各写一段死分支。
 *
 * 配了回城补给(resupply.enabled + auxConfigs.townProfile)时改走补给流程:
 *   补给成功 → 返回 'resupplied'(角色被带回入图点;调用处结束本圈,从第一个路径点重跑,不续跑中断点)
 *   补给失败 → 返回 exit 结果(带上失败原因,任务按原方式结束)
 * 没配补给 = 保持原行为(检测到死亡就结束任务)。
 */
async function checkDeath(run: FarmRun, loop: number, where: string): Promise<DeathCheck> {
  const death = detectCharacterDeath(run);
  if (!death.dead) return null;

  const { ctx, label, conf } = run;
  const place = `第 ${loop} 圈${where}`;
  // 死亡计数(随 ctx.setStatus 上报主进程,主面板显示"死亡 N")
  ctx.stats.deathCount++;
  ctx.sendLog(
    'warn',
    `[${label}] ${place}检测到角色死亡(${death.via === 'revive-text' ? '找字「原地复活」' : 'OCR「死亡」标题'}命中,累计死亡 ${ctx.stats.deathCount} 次)`,
  );

  const townProfile = ctx.init.auxConfigs?.townProfile;
  if (conf.resupply.enabled && townProfile) {
    ctx.sendLog(
      'info',
      `[${label}] 开始回城补给(档案=${conf.resupply.townProfileName || townProfile.mapName},复活=${conf.resupply.reviveMode})`,
    );
    const result = await runResupplyFlow(
      ctx,
      {
        client: dmApi,
        size: run.size,
        input: run.input,
        // 用带地图名的 travelMovement(reader 带分辨率档位):RouteTraveler 靠它判断"切图即停"
        movement: run.travelMovement,
        readMapName: run.readMapName,
        // 宠物骑乘:回到城里先检查宠物 + 上骑(见 pet-ride.ts)
        petRide: conf.petRide,
        // 切回挂机图后先沿入图点从地图入口走到挂机点,再恢复挂机循环
        entryPath: conf.entryPath,
        // 地图跨越链路:返程先到链首图,再逐跳穿越回挂机图(没配 = 空数组,行为不变)
        mapProfiles: conf.mapProfiles,
        // 补给途中每到达一张新图(死亡重生回城镇 / 返程切回挂机图)都走同一次换图判断
        onMapMaybeChanged: () => blockAllPlayersIfMapChanged(run),
      },
      { label: '回城补给' },
    );
    if (result.ok) {
      ctx.sendLog('info', `[${label}] 回城补给完成(${result.detail ?? '已回到挂机地图'}),回到第一个路径点重新开始`);
      return { kind: 'resupplied' };
    }
    const detail = `${place}死亡回城补给失败: ${result.detail ?? '未知原因'},退出打怪循环`;
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { kind: 'exit', result: { ok: false, detail } };
  }

  if (conf.resupply.enabled && !townProfile) {
    ctx.sendLog('warn', `[${label}] 开了回城补给但没下发城镇档案(auxConfigs.townProfile),本次按不开启处理`);
  }
  const detail = `${place}检测到角色死亡,退出打怪循环`;
  ctx.sendLog('warn', `[${label}] ${detail}`);
  return { kind: 'exit', result: { ok: true, detail } };
}

/**
 * 进入新地图时屏蔽所有人(配置开关 blockAllPlayersOnNewMap,执行 F11×4):
 * 读一次当前地图名,和上次记录不同(或还没记录过)就按一次 shared/game-hotkeys 的 blockAllPlayers。
 *
 * 不区分场景:任务启动前、主循环每圈、回城补给到达新图都只是"到点读一次地图",
 * 靠同一份 run.lastMapName 去重 —— 谁先发现换图谁按,不会重复按。
 * 读不到地图名(OCR 偶发读空)时跳过,也不更新记录 —— 免得把一次读空当成"换图"。
 */
async function blockAllPlayersIfMapChanged(run: FarmRun): Promise<void> {
  const { ctx, conf, label } = run;
  if (!conf.blockAllPlayersOnNewMap) return;

  const map = String(await run.readMapName()).trim();
  if (!map || run.lastMapName === map) return;
  run.lastMapName = map;

  try {
    await pressGameHotkey(dmApi, 'blockAllPlayers');
  } catch (e: any) {
    ctx.sendLog('warn', `[${label}] 屏蔽所有人失败: ${e?.message ?? e}`);
    return;
  }
  ctx.sendLog('info', `[${label}] 进入新地图「${map}」,已屏蔽所有人(F11×4)`);
}

/** 关闭聊天背景的点击坐标(窗口客户区相对坐标) */
const CHAT_BACKGROUND_CLICK = { x: 11, y: 727 };

/**
 * 任务启动时的一次性环境处理(开工时各跑一次,不进入挂机循环):
 *   - 小地图缩放:按一次 Alt+- 把右上角小地图缩小(键位见 shared/game-hotkeys 的 zoomOutMap)
 *   - 关闭聊天背景:鼠标移到聊天框点一次左键,把聊天背景关掉
 * 配置缺省开启(zoomOutMinimap / closeChatBackground !== false);单项失败只记日志,不阻断任务。
 */
async function runStartupEnvSetup(run: FarmRun): Promise<void> {
  const { ctx, conf, label, input } = run;
  if (conf.zoomOutMinimap) {
    try {
      await pressGameHotkey(dmApi, 'zoomOutMap');
      ctx.sendLog('info', `[${label}] 启动:小地图缩小(Alt+-)`);
    } catch (e: any) {
      ctx.sendLog('warn', `[${label}] 小地图缩小失败: ${e?.message ?? e}`);
    }
  }
  if (conf.closeChatBackground) {
    try {
      await input.moveMouse({ x: CHAT_BACKGROUND_CLICK.x, y: CHAT_BACKGROUND_CLICK.y }, { kind: 'instant' });
      await input.click('left');
      ctx.sendLog('info', `[${label}] 启动:关闭聊天背景(点击 ${CHAT_BACKGROUND_CLICK.x},${CHAT_BACKGROUND_CLICK.y})`);
    } catch (e: any) {
      ctx.sendLog('warn', `[${label}] 关闭聊天背景失败: ${e?.message ?? e}`);
    }
  }
}

/**
 * 开工补给(resupply.runOnStart):任务启动、进主循环之前先跑一遍同一条补给流程 ——
 * 检查耐久/药水 → (按需)找道具商人修理/买药 → 走到出城口切回挂机地图,然后才开始打怪。
 *
 * 与死亡回城共用 runResupplyFlow,区别只在触发器和"复活阶段"(mode='start',见 resupply-runner):
 *   - 人还活着:不复活,位置由流程自己确认(已在挂机地图 = 整段跳过;不在城镇 = 失败)
 *   - 成功 = 角色已经在挂机地图里 → 返回 null,调用处继续进主循环
 *   - 失败 = 返回 ok:false 的结果(起点没确认好,硬跑只会沿着错的坐标乱走)
 *
 * 第二个调用点 = 条件回城:opts.force=true 时无视 runOnStart 强制跑一次
 * (每轮回城落到城镇后,用同一条流程重新检查状态/找商人/出城,再回挂机图;见 prepareFarmEntry)。
 *
 * 依赖与 checkDeath 完全一致(同一份 client/size/移动实例/读图名函数):
 *   movement 必须用 travelMovement —— 它带地图名,RouteTraveler 的"切图即停"才生效。
 */
async function runStartupResupply(run: FarmRun, opts?: { force?: boolean }): Promise<FarmLoopResult | null> {
  const { ctx, label, conf } = run;
  if (!conf.resupply.enabled || (!opts?.force && !conf.resupply.runOnStart)) return null;
  // 没配开工补给(且不是条件回城的强制调用)= 直接跳过
  const stage = opts?.force ? '回城后补给' : '开工补给';
  const townProfile = ctx.init.auxConfigs?.townProfile;
  if (!townProfile) {
    // 理论上 renderer(aux-configs.ts)在启动前就拦住了;真发生也只能继续跑,记一条日志说清楚
    ctx.sendLog('warn', `[${label}] 开了${stage}但没下发城镇档案(auxConfigs.townProfile),本次跳过${stage}`);
    return null;
  }

  ctx.sendLog('info', `[${label}] 开始${stage}(档案=${conf.resupply.townProfileName || townProfile.mapName}),完成后进入打怪循环`);
  const result = await runResupplyFlow(
    ctx,
    {
      client: dmApi,
      size: run.size,
      input: run.input,
      // 与 checkDeath 用同一个带地图名的 travelMovement(reader 带分辨率档位)
      movement: run.travelMovement,
      readMapName: run.readMapName,
      // 宠物骑乘:开工时人在城镇也先上骑,再一路骑回挂机图(见 pet-ride.ts)
      petRide: conf.petRide,
      // 返程切回挂机图后同样先走入图点(开工时人从城镇回来,落点也在入口)
      entryPath: conf.entryPath,
      // 地图跨越链路:开工返程同样先到链首图再逐跳穿越回挂机图
      mapProfiles: conf.mapProfiles,
      // 返程切回挂机图同样走一次换图判断(开工时人若在城镇,回来也是一次真换图)
      onMapMaybeChanged: () => blockAllPlayersIfMapChanged(run),
    },
    { label: stage, mode: 'start' },
  );
  if (result.ok) {
    ctx.sendLog('info', `[${label}] ${stage}完成(${result.detail ?? '可以开始挂机'}),进入打怪循环`);
    return null;
  }

  const detail = `${stage}失败: ${result.detail ?? '未知原因'},退出打怪循环`;
  ctx.sendLog('warn', `[${label}] ${detail}`);
  return { ok: false, detail };
}

/** prepareFarmEntry 的开关 */
interface PrepareEntryOptions {
  /** 是否跑起点恢复/补给/跨图(移动攻击测试传 false:测试只想看走位打怪,不该顺带跑城镇) */
  allowResupply: boolean;
  /** 忽略 resupply.runOnStart 强制跑一次城市逻辑(条件回城回到城镇后用) */
  forceResupply?: boolean;
}

/**
 * 入图准备:把角色弄到挂机图,并给出进主循环用的起点。
 * 起点恢复(必要时按回城卷轴回主城/主城中转) → 城市逻辑(城镇档案:检查耐久药水 → 按需访问商人 → 出城) →
 * 跨境逐跳(过图链路,支持从链路中间某张图开始) → 走挂机图的入图点 → 重读起点。
 * 任务启动与「条件回城」每轮回来共用这一段(见 shared/types.ts 的 FarmEndReturnConfig)。
 */
async function prepareFarmEntry(
  run: FarmRun,
  start: MapPosition,
  opts: PrepareEntryOptions,
): Promise<{ exit: FarmLoopResult | null; start: MapPosition }> {
  const { ctx, conf, label } = run;
  let loopStart = start;
  /** 本次准备是否真的动过角色(起点恢复 / 城市逻辑 / 跨境任一跑过):动过才重读坐标 */
  let moved = false;

  // 起点恢复(进主循环之前):把角色弄到出发城镇 ——
  //   已在出发城镇 → 不动;已在某个主城(见 shared/main-cities.ts)→ 不用回城卷轴,直接坐飞空艇去出发城镇;
  //   在野外/任意图 → 先用回城卷轴回主城,再坐飞空艇过去(细节见 recoverToDepartureTown)。
  // 必须在开工补给之前:补给的状态检查(装备/药水)与「城镇出发」都以出发城镇为立足点。
  // 已在挂机图/链路/出发城镇 = 什么都不做(不消耗卷轴)。
  if (opts.allowResupply) {
    const town = ctx.init.auxConfigs?.townProfile;
    const farmMapName = String(ctx.init.auxConfigs?.farmMapName ?? '').trim();
    const at = String((await run.readMapName()) ?? '').trim();
    const known =
      !!town && (at === town.mapName || (!!farmMapName && at === farmMapName) || conf.mapProfiles.some((p) => p.mapName === at));
    if (town && at && !known) {
      const recovered = await recoverToDepartureTown(run, at);
      if (recovered.exit) return { exit: recovered.exit, start: loopStart };
      // 恢复跑过(哪怕它没找到可走的路):角色可能已经被带回主城/出发城镇,start 已经过期
      moved = true;
    }
  }

  // 开工补给(配置要求时):进主循环之前先把 检查状态 → 商人 → 挂机地图 这一段跑完。
  // 放在 walkWaypoints 之前(walkWaypoints 开头那次 checkDeath('开始时') 因此晚于它),
  // 且只跑这一次 —— 循环里不会重复触发。补给途中角色是活的,死亡检查不会被误触发。
  // 移动攻击测试路径由 opts 关掉(见 FarmLoopOptions.allowStartupResupply);
  // 条件回城每轮回来时 forceResupply=true:无视 runOnStart 再跑一次。
  const useResupply = opts.allowResupply && conf.resupply.enabled && (opts.forceResupply === true || conf.resupply.runOnStart);
  if (useResupply) {
    const startup = await runStartupResupply(run, { force: opts.forceResupply === true });
    if (startup) return { exit: startup, start: loopStart };
    moved = true;
  }

  // 地图跨越(进主循环之前):角色不在挂机图时按 conf.mapProfiles 逐跳穿越过去。
  // 开工补给返程若已把角色带回挂机图,这里会直接判"已在挂机图"跳过(不会重复跨)。
  // 同一开关(allowResupply)关掉:移动攻击测试不该顺带跨图。
  let crossedMaps = false;
  if (opts.allowResupply) {
    const cross = await crossMapsOnStartup(run);
    if (cross.exit) return { exit: cross.exit, start: loopStart };
    crossedMaps = cross.crossed;
  }

  // 跨图/城镇出发把角色带进了挂机图、但没走开工补给(角色从别处用回城卷轴过来的情况):
  // 这里补走「入图点」—— 从地图入口直冲第一个挂机点容易被地形挡住。
  // 开工补给那条路已在 travelBackToFarm 里走过入图点,此时 crossMapsOnStartup 会判"已在挂机图"跳过,
  // crossedMaps=false,不会重复走。
  if (crossedMaps && conf.entryPath.length > 0) {
    ctx.setStatus('moving', `${label} 入图`);
    ctx.sendLog('info', `[${label}] 已进入挂机地图,按入图路径走 ${conf.entryPath.length} 个点回到挂机点`);
    await travelWithinMap(run.travelMovement, conf.entryPath, {
      timeoutMs: CROSS_TRAVEL_TIMEOUT_MS,
      moveOptions: CROSS_MOVE_OPTIONS,
      isStopped: () => !ctx.moveAttack.running,
      onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
    });
  }

  // 起点重读:起点恢复 / 开工补给 / 地图跨越会把角色带到别处(走位 + 切图),上面读到的 start 已经过期 ——
  // 拿旧坐标进主循环会让定点打怪的"移动反方向"算歪、moveTo 的目标图也可能判成跨图。
  // 三段都没跑(或被测试路径关掉)时不重读,保持原行为(少一次 OCR)
  if (moved || crossedMaps) {
    const after = await run.movement.readPosition();
    if (!after) {
      const detail = '补给/跨图后读不到当前位置(检查设置里的分辨率,以及坐标区域/颜色是否匹配)';
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { exit: { ok: false, detail }, start: loopStart };
    }
    loopStart = after;
    ctx.sendLog('info', `[${label}] 补给/跨图后的起点: (${after.x}, ${after.y}) 地图=${after.map ?? '未知'}`);
  }

  return { exit: null, start: loopStart };
}

/** 地图跨越 / 城镇出口过图段的移动参数(与补给返程一致:卡住 15s 放弃本点,别拖死) */
const CROSS_MOVE_OPTIONS = { arriveTolerance: 3, stepIntervalMs: 800, noMoveTimeoutMs: 15_000, moveEpsilon: 0.5 };
/** 地图跨越每一段的整体超时(走路 + 等切图) */
const CROSS_TRAVEL_TIMEOUT_MS = 120_000;

/**
 * 开工跨图(地图跨越):进主循环之前,若角色不在挂机图,沿 conf.mapProfiles 逐跳穿越过去。
 *   - 已在挂机图 → 跳过(开工补给返程若已把角色带回来,这里也是 no-op)
 *   - 在过图链路上某图 → 逐跳穿越(见 core/navigation/MapCrossing)
 *   - 在出发城镇(且下发过城镇档案)→ 先从城镇出发到链首图(走到出城口过图,或与传送 NPC 对话后传送,
 *     见 resupply/town-departure.ts),再逐跳;没配中间图时可直接传送到挂机图
 *   - 其它情况 → 结束任务并给出清晰原因(不会带着错误起点硬跑)
 * 返回 { exit: 结束结果 | null, crossed: 是否真的跨过图 }。
 */
async function crossMapsOnStartup(run: FarmRun): Promise<{ exit: FarmLoopResult | null; crossed: boolean }> {
  const { ctx, conf, label, readMapName, travelMovement } = run;
  const profiles = conf.mapProfiles;
  const town = ctx.init.auxConfigs?.townProfile;
  const farmMapName = String(ctx.init.auxConfigs?.farmMapName ?? '').trim();
  const stopped = () => !ctx.moveAttack.running;

  // 既没配地图跨越、也没下发城镇档案:保持旧行为(不跨图)
  if (profiles.length === 0 && !town) return { exit: null, crossed: false };

  if (!farmMapName) {
    ctx.sendLog('warn', `[${label}] 配了地图跨越但没下发挂机地图名,跳过跨图`);
    return { exit: null, crossed: false };
  }

  const cur = String((await readMapName()) ?? '').trim();
  if (!cur) {
    // OCR 偶发读空:不硬跨(免得从错误起点出发),交给主循环常规处理
    ctx.sendLog('warn', `[${label}] 读不到当前地图名,跳过地图跨越`);
    return { exit: null, crossed: false };
  }
  if (cur === farmMapName) return { exit: null, crossed: false };

  const chainDesc = [...profiles.map((p) => p.mapName), farmMapName].join(' → ');
  // 起点恢复(回城卷轴 / 主城中转)已在 runFarmLoop 更早的步骤里做过:
  // 走到这里时角色要么已在出发城镇,要么确实无处可去(下面给出清晰报错)。
  const inChain = profiles.some((p) => p.mapName === cur);

  // 不在过图链路上:只在「出发城镇」时才出发(走到出城口过图,或与传送 NPC 对话后传送)
  if (!inChain) {
    if (town && cur === town.mapName) {
      const firstTarget = profiles[0]?.mapName ?? farmMapName;
      ctx.setStatus('moving', `${label} 从城镇出发`);
      ctx.sendLog('info', `[${label}] 从城镇「${cur}」出发前往「${firstTarget}」` + (profiles.length > 0 ? `(跨图链路 ${chainDesc})` : ''));
      const depart = await departTownTo({
        ctx,
        client: dmApi,
        size: run.size,
        movement: travelMovement,
        readMapName,
        label,
        town,
        fromAnchor: REVIVE_ANCHOR,
        targetMapName: firstTarget,
        timeoutMs: CROSS_TRAVEL_TIMEOUT_MS,
        moveOptions: CROSS_MOVE_OPTIONS,
        isStopped: stopped,
      });
      if (!depart.ok) {
        const detail = stopped() ? '任务已停止(从城镇出发途中)' : `地图跨越:${depart.detail}`;
        ctx.sendLog('warn', `[${label}] ${detail}`);
        return { exit: { ok: false, detail }, crossed: false };
      }
      ctx.sendLog('info', `[${label}] ${depart.detail}`);
      await blockAllPlayersIfMapChanged(run);
      // 城镇直达挂机图(没配中间图):出发即到位;否则继续沿下面的过图链走
      if (firstTarget === farmMapName) return { exit: null, crossed: true };
    } else if (profiles.length > 0) {
      const detail =
        `地图跨越:当前在「${cur}」,不在过图链路上(链路:${chainDesc})。` +
        (town
          ? `请把角色走到城镇「${town.mapName}」或链首图「${profiles[0].mapName}」再启动任务`
          : `请把角色走到链首图「${profiles[0].mapName}」再启动任务(想从城镇出发需开启「回城补给」并选好城镇档案)`);
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { exit: { ok: false, detail }, crossed: false };
    } else {
      // 只有城镇档案、没有过图链,人又不在城镇/链路:无法自动前往,报错(别带着错误起点进主循环)
      const townName = town?.mapName || '未配';
      const detail =
        `当前在「${cur}」,既不是出发城镇「${townName}」也不是挂机图「${farmMapName}」,也没有配「地图跨越」链路。` +
        `请把角色走到出发城镇「${townName}」再启动,或配上过图链路 / 回城卷轴`;
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { exit: { ok: false, detail }, crossed: false };
    }
  }

  ctx.setStatus('moving', `${label} 地图跨越`);
  ctx.sendLog('info', `[${label}] 地图跨越:当前在「${cur}」,目标「${farmMapName}」,链路 ${chainDesc}`);

  // 已在链路上但没配中间图:没有可跨的跳(理论上前面已 return,这里兜底)
  if (profiles.length === 0) return { exit: null, crossed: false };

  const cross = await crossMapProfiles(travelMovement, readMapName, profiles, farmMapName, {
    timeoutMs: CROSS_TRAVEL_TIMEOUT_MS,
    moveOptions: CROSS_MOVE_OPTIONS,
    isStopped: stopped,
    onProgress: (msg) => ctx.sendLog('info', `[${label}] ${msg}`),
    onArriveMap: async () => {
      await blockAllPlayersIfMapChanged(run);
    },
    runNpc: (npc) => talkToNpc({ ctx, client: dmApi, size: run.size, label, npcName: npc.name, recipeName: npc.recipeName }),
  });
  if (!cross.ok) {
    const detail = stopped() ? '任务已停止(地图跨越途中)' : `地图跨越失败:${cross.detail}`;
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { exit: { ok: false, detail }, crossed: false };
  }
  ctx.sendLog('info', `[${label}] 地图跨越完成:${cross.detail}`);
  await blockAllPlayersIfMapChanged(run);
  return { exit: null, crossed: true };
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
  const waypoints = resolveWaypoints(cfg, castMode, skills);

  return {
    mode,
    castMode,
    skills,
    waypoints,
    // 入图点单独抽出来:挂机循环跳过它们,只在回城/开工补给重新进图后走(见 resupply-runner)
    entryPath: waypoints.filter((w) => w.type === 'entry').map((w) => ({ x: w.x, y: w.y })),
    // 地图跨越链路:档案本体由 renderer 按 farm.mapCrossings 顺序解析下发(见 renderer/aux-configs.ts)
    mapProfiles: ctx.init.auxConfigs?.mapProfiles ?? [],
    ...resolveMonsterFilter(cfg, mode),
    ...resolveDetectAreas(cfg, view),
    stepIntervalMs: cfg && cfg.movementSpeed && cfg.movementSpeed >= 100 ? cfg.movementSpeed : DEFAULT_STEP_INTERVAL_MS,
    pickup: resolvePickup(ctx, cfg, view),
    // 宠物技能:骑乘上骑/下骑、打怪前技能都必须是 method='pet' 的技能(见 resolvePetRide),缺省关闭
    petRide: resolvePetRide(cfg, skills),
    // 回城卷轴:必须是 method='item' 的技能(见 resolveReturnScroll),缺省关闭
    returnScroll: resolveReturnScroll(cfg, skills),
    // 回城补给:清洗交给 resupply 模块(默认值与补给流程共用同一份,见 resolveResupplyConfig)
    // runOnStart 也在那份清洗里(缺省 false,旧配置不受影响),主循环开工时读它
    // 耐久/药水检查项在城镇档案里(auxConfigs.townProfile),清洗时一并读入(旧 farm 配置兜底)
    resupply: resolveResupplyConfig(cfg?.resupply, ctx.init.auxConfigs?.townProfile),
    // 进入新地图时屏蔽所有人(缺省 false,旧配置不受影响)
    blockAllPlayersOnNewMap: cfg?.blockAllPlayersOnNewMap === true,
    // 启动时的一次性环境处理(缺省开启,旧配置不受影响)
    zoomOutMinimap: cfg?.zoomOutMinimap !== false,
    closeChatBackground: cfg?.closeChatBackground !== false,
    // 条件回城(缺省关闭,旧配置不受影响)
    endReturn: resolveEndReturn(cfg),
  };
}

/** 打怪模式:缺省 fixed;旧值(single/patrol/aoe)先迁到 fixed */
function resolveMode(cfg: FarmTaskConfig | null): ResolvedConfig['mode'] {
  const raw = cfg?.mode ?? 'fixed';
  return LEGACY_MODE_MAP[raw] ?? (raw as ResolvedConfig['mode']);
}

/** 任务级技能:只留启用的 + 键位合法的;数值兜底并夹取(兼容旧配置缺字段) */
function resolveSkills(cfg: FarmTaskConfig | null): MoveAttackSkill[] {
  return (
    (cfg?.skills ?? [])
      .filter((s) => s.enabled !== false)
      // 旧配置第二页写成 SF*,统一归一成 TF*(兼容老配置)
      .map((s) => ({ ...s, key: normalizeSkillKey(s.key) }))
      .filter((s) => VALID_SKILL_KEYS.has(s.key))
      .map((s) => ({
        id: s.id,
        key: s.key as SkillKey,
        name: s.name,
        cooldownMs: Math.max(0, s.cooldownMs | 0),
        castMs: Math.max(0, s.castMs ?? 400),
        rangePx: Math.max(0, s.rangePx ?? 0),
        method: (s.method ?? 'target') as MoveAttackSkill['method'],
      }))
  );
}

/**
 * 宠物技能:上骑/下骑/打怪前技能都只认 method='pet' 且键位合法的技能(在 resolveSkills 里已过滤未启用/非法键位)。
 * 引用的 id 找不到对应宠物技能 = 该项为空,相应动作按"没配"处理(见 pet-ride.ts)。
 * 「打怪前开启宠物技能」是独立开关(raw.preFarmSkillEnabled),与骑乘的 enabled 无关。
 */
function resolvePetRide(cfg: FarmTaskConfig | null, skills: MoveAttackSkill[]): ResolvedPetRide {
  const raw = cfg?.petRide;
  const pick = (id?: string): PetRideSkill | null => {
    const s = skills.find((x) => x.id === id && x.method === 'pet');
    return s ? { id: s.id, key: s.key, name: s.name } : null;
  };
  return {
    enabled: raw?.enabled === true,
    mount: pick(raw?.mountSkillId),
    dismount: pick(raw?.dismountSkillId),
    preFarm: { enabled: raw?.preFarmSkillEnabled === true, skill: pick(raw?.preFarmSkillId) },
  };
}

/** 回城卷轴(见 shared/types.ts 的 FarmReturnScrollConfig):只认 method='item' 且键位合法的技能 */
interface ResolvedReturnScroll {
  enabled: boolean;
  key: SkillKey | null;
  timeoutMs: number;
}

/**
 * 回城卷轴:引用技能表里 method='item'(物品栏快捷栏位)的技能。
 * 引用的 id 找不到对应物品技能 = 关闭(按"没配"处理,见 resupply/town-departure.ts 的 returnViaScroll)。
 */
function resolveReturnScroll(cfg: FarmTaskConfig | null, skills: MoveAttackSkill[]): ResolvedReturnScroll {
  const raw = cfg?.returnScroll;
  const skill = skills.find((s) => s.id === raw?.skillId && s.method === 'item');
  const timeoutMs = typeof raw?.timeoutMs === 'number' && raw.timeoutMs >= 1000 ? Math.round(raw.timeoutMs) : 60_000;
  return { enabled: raw?.enabled === true && !!skill, key: skill ? skill.key : null, timeoutMs };
}

/**
 * 条件回城(见 shared/types.ts 的 FarmEndReturnConfig):缺字段走默认,非法值夹到合理范围。
 *   loops:取整且 >= 1,否则(null / 0 / 负数)= 不用这个条件
 *   maxAttempts 夹 1~20;pressIntervalMs 夹 1000~60000(读条没完就按第二次会白耗一张卷轴)
 *   method 只认 'scroll' / 'relogin',其它(含缺省)= 'scroll'
 * 回城用的技能键不在这一份里 —— 与「回城卷轴」(conf.returnScroll)共用同一份配置。
 * 小退参数交给 relogin.ts 的 resolveReloginConfig 清洗(默认值与清怪/小退流程同一份)。
 */
function resolveEndReturn(cfg: FarmTaskConfig | null): ResolvedEndReturn {
  const raw = cfg?.endReturn;
  const loops = typeof raw?.loops === 'number' ? Math.trunc(raw.loops) : NaN;
  const clamp = (v: number | undefined, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    enabled: raw?.enabled === true,
    loops: loops >= 1 ? loops : null,
    overloaded: raw?.overloaded === true,
    method: raw?.method === 'relogin' ? 'relogin' : 'scroll',
    scroll: {
      maxAttempts: clamp(raw?.scroll?.maxAttempts, 1, 20, END_RETURN.maxAttempts),
      pressIntervalMs: clamp(raw?.scroll?.pressIntervalMs, 1000, 60_000, END_RETURN.pressIntervalMs),
    },
    // 小退参数:清洗在 relogin.ts(与清怪/小退流程共用同一份默认值)
    relogin: resolveReloginConfig(raw?.relogin),
  };
}

/**
 * 把角色弄到出发城镇(准备在出发城镇做开工补给 / 从出发城镇出发)。按当前所在分成三种:
 *   1. 已在出发城镇 → 什么都不做;
 *   2. 当前就在某个主城(见 shared/main-cities.ts) → **不用回城卷轴**,直接坐该主城的飞空艇去出发城镇
 *      (走城镇档案的「其它主城中转」);
 *   3. 当前在野外/任意图 → 先按回城卷轴回主城;回城落在出发城镇就结束,落在别的主城同样坐飞空艇过去。
 * 返回 { exit: 失败结果 | null, map: 恢复后所在的地图名 | null }(map=null = 没恢复,交给调用方报错)。
 */
async function recoverToDepartureTown(run: FarmRun, cur: string): Promise<{ exit: FarmLoopResult | null; map: string | null }> {
  const { ctx, conf, label, readMapName, travelMovement, input } = run;
  const scroll = conf.returnScroll;
  const town = ctx.init.auxConfigs?.townProfile;
  if (!town) {
    ctx.sendLog('warn', `[${label}] 起点「${cur}」不在出发城镇,但没有下发城镇档案(auxConfigs.townProfile),无法自动前往`);
    return { exit: null, map: null };
  }
  if (cur === town.mapName) return { exit: null, map: cur };

  const stopped = (): boolean => !ctx.moveAttack.running;
  let landed = cur;

  // 在主城之外(野外/任意图):必须先用回城卷轴回到某个主城
  if (!isMainCity(cur)) {
    if (!scroll.enabled || !scroll.key) {
      ctx.sendLog('warn', `[${label}] 起点「${cur}」是野外地图,但回城卷轴未开启或没选到有效的「物品」技能,无法自动回城`);
      return { exit: null, map: null };
    }
    ctx.setStatus('moving', `${label} 回城卷轴`);
    ctx.sendLog('info', `[${label}] 起点「${cur}」不在主城,先按回城卷轴回城`);
    const back = await returnViaScroll({
      ctx,
      input,
      readMapName,
      label,
      key: scroll.key,
      timeoutMs: scroll.timeoutMs,
      isStopped: stopped,
    });
    if (!back.ok || !back.map) return { exit: { ok: false, detail: `回城卷轴:${back.detail}` }, map: null };
    await blockAllPlayersIfMapChanged(run);
    landed = back.map;
    // 正好落在出发城镇:不用再中转
    if (landed === town.mapName) return { exit: null, map: landed };
  } else {
    ctx.sendLog('info', `[${label}] 起点「${cur}」是主城且不是出发城镇,不用回城卷轴,直接坐飞空艇前往「${town.mapName}」`);
  }

  // 现在在某个主城但不是出发城镇:按档案里的「其它主城中转」坐飞空艇过去
  const transit = (town.transitFrom ?? []).find((t) => (t.mapName ?? '').trim() === landed);
  if (!transit) {
    return {
      exit: {
        ok: false,
        detail:
          `当前在「${landed}」,既不是出发城镇「${town.mapName}」,` +
          `也没有配从该主城到出发城镇的飞空艇中转(在城镇档案里加一条「其它主城中转」)`,
      },
      map: null,
    };
  }

  ctx.setStatus('moving', `${label} 主城中转`);
  const hop = await transitCityToTown({
    ctx,
    client: dmApi,
    size: run.size,
    movement: travelMovement,
    readMapName,
    label,
    city: transit,
    targetMapName: town.mapName,
    timeoutMs: CROSS_TRAVEL_TIMEOUT_MS,
    moveOptions: CROSS_MOVE_OPTIONS,
    isStopped: stopped,
  });
  if (!hop.ok) return { exit: { ok: false, detail: `主城中转:${hop.detail}` }, map: null };
  await blockAllPlayersIfMapChanged(run);
  return { exit: null, map: town.mapName };
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
  const patrolCount = conf.waypoints.filter((w) => w.type !== 'entry').length;
  const pickup = conf.pickup.enabled
    ? `开启(范围(${fmtRange(conf.pickup.roi)}) 规则=[${conf.pickup.rules.map(formatPickupRule).join(' 或 ')}])`
    : '关闭';

  ctx.sendLog(
    'info',
    `[${label}] 配置: 模式=${modeLabel[conf.mode]}(${conf.mode}) 路径点=${patrolCount}(挂机点=${farmSpots})` +
      ` 入图点=${conf.entryPath.length}`,
  );
  ctx.sendLog(
    'info',
    `[${label}] 技能=[${skills}] 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}` +
      ` 移动间隔=${conf.stepIntervalMs}ms 条件回城=${formatEndReturn(conf.endReturn)}`,
  );
  ctx.sendLog('info', `[${label}] 找怪=[${conf.monsterKeywords.join(',') || '不限(纯OCR)'}] 颜色=${conf.monsterColor} 拾取=${pickup}`);
  ctx.sendLog(
    'info',
    `[${label}] 回城补给=${formatResupply(conf.resupply)} 屏蔽所有人=${conf.blockAllPlayersOnNewMap ? '进入新地图时(F11×4)' : '关闭'}` +
      ` 小地图缩放=${conf.zoomOutMinimap ? '启动时(Alt+-)' : '关闭'} 关聊天背景=${conf.closeChatBackground ? '启动时' : '关闭'}` +
      ` 宠物技能=${formatPetRide(conf.petRide)}`,
  );
  if (ctx.init.taskConfig?.type !== 'farm') {
    ctx.sendLog('warn', `[${label}] taskConfig 不是 farm 配置(或未下发),本次全部用内置默认值`);
  }
}

/** 回城补给配置在日志里的写法(排查"死了之后为什么没回城"先看这一行) */
function formatResupply(r: ResolvedResupply): string {
  if (!r.enabled) return '关闭';
  return (
    `开启(档案=${r.townProfileName || '未指定'} 复活=${r.reviveMode}` +
    ` 复活超时=${Math.round(r.reviveTimeoutMs / 1000)}s 耐久检查=${r.checkDurability ? '是' : '否'}` +
    ` 队伍检查=${r.createTeam ? '是' : '否'} 药水阈值=${r.potionThreshold ?? '不检查'} 开工补给=${r.runOnStart ? '是' : '否'})`
  );
}

/** 宠物技能配置在日志里的写法(骑乘 + 打怪前技能) */
function formatPetRide(p: ResolvedPetRide): string {
  const label = (s: PetRideSkill | null): string => (s ? `${s.key}${s.name ? `·${s.name}` : ''}` : '未配');
  const ride = p.enabled ? `开启(上骑=${label(p.mount)} 下骑=${label(p.dismount)})` : '关闭';
  const preFarm = p.preFarm.enabled ? `开启(${label(p.preFarm.skill)})` : '关闭';
  return `骑乘=${ride} 打怪前技能=${preFarm}`;
}

/** 条件回城配置在日志里的写法(排查"为什么打完没回城"先看这一行) */
function formatEndReturn(e: ResolvedEndReturn): string {
  if (!e.enabled) return '关闭';
  const conds = [e.loops ? `每 ${e.loops} 圈` : null, e.overloaded ? '背包已满' : null].filter((s): s is string => !!s);
  const way =
    e.method === 'scroll'
      ? `回城卷轴(最多 ${e.scroll.maxAttempts} 次/每次等 ${Math.round(e.scroll.pressIntervalMs / 1000)}s)`
      : `小退(清怪=${e.relogin.clearMobs ? `超时 ${Math.round(e.relogin.clearTimeoutMs / 1000)}s` : '关闭'} 最多 ${e.relogin.maxAttempts} 次)`;
  return `开启(${conds.join(' / ') || '未设条件'};方式=${way})`;
}

// ===== 移动与瞄准 =====

/** 地图坐标读取配置(坐标区域按设置里的分辨率取档) */
function mapCoordConfig(ctx: WorkerContext): MapCoordConfig {
  return {
    coordRoi: DEFAULT_ROLE_POSITION[resolveWindowSizeKey(ctx.init.hwnd, ctx.init.settings?.resolution)],
    coordColor: COLOR_WHITE,
    similarity: DEFAULT_FUZZY_SIM,
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
      await pressSkillKey(input, skill.key);
      if (skill.castMs > 0) await sleep(skill.castMs);
      ctx.sendLog('info', `[${label}] 释放 ${name}(快捷施法)`);
      return true;

    case 'pet':
      // 宠物技能(骑乘)不参与打怪循环,正常不会走到这里;留一个分支保证施法方式全集可处理
      await pressSkillKey(input, skill.key);
      if (skill.castMs > 0) await sleep(skill.castMs);
      ctx.sendLog('info', `[${label}] 释放 ${name}(宠物技能)`);
      return true;

    case 'item':
      await pressSkillKey(input, skill.key);
      ctx.sendLog('info', `[${label}] 使用物品 ${name}(物品使用)`);
      return true;

    case 'self':
      await input.moveMouse({ x: view.center.x, y: view.center.y - SELF_CLICK_OFFSET_Y }, { kind: 'instant' });
      await input.delay(200);
      await input.click('right');
      await input.delay(200);
      await pressSkillKey(input, skill.key);
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
      await pressSkillKey(input, skill.key);
      await input.click('left');
      // 在施法过程中再补充100ms
      if (skill.castMs > 0) await sleep(skill.castMs + 100);
      ctx.sendLog('info', `[${label}] 释放 ${name} @(${clickPos.x},${clickPos.y})`);
      return true;
  }
}

// ===== 物品拾取(打怪间隙捡掉落物)=====

/** 坐标 → 10px 网格 key(拾取放弃表 / 尸体忽略表共用):同一目标两次扫描的坐标会有几像素抖动,按网格取整抵消它 */
const posGridKey = (pos: Point): string => `${Math.round(pos.x / 10)},${Math.round(pos.y / 10)}`;

/** 这件物品是不是刚被放弃过(TTL 内不再碰,TTL 一过自动失效) */
function isItemAbandoned(rt: PickupRuntime, pos: Point): boolean {
  const key = posGridKey(pos);
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
  rt.abandoned.set(posGridKey(pos), now);
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
 * 把鼠标移到怪名上点击(名字坐标 + 配置的点击偏移)。
 * 定点识别现在固定用左键:按一下怪名,游戏就会锁定它并开始自动攻击,锁定成功时 HUD 里会出现它的名字
 * (见 isLockAlive / readLockedName)。保留 button 参数是为了以后换回"右键只锁定"时只改调用处。
 */
async function clickMonsterName(run: FarmRun, pos: Point, button: MouseButton): Promise<void> {
  const { input, conf } = run;
  await input.moveMouse({ x: pos.x + conf.clickOffset.x, y: pos.y + conf.clickOffset.y }, { kind: 'instant' });
  await input.delay(200);
  await input.click(button);
}

/**
 * 「锁定的怪还在不在」只认 HUD(conf.lockedNameRoi),不用识别范围内的名字兜底。
 *
 * 为什么:怪死了尸体名还会在画面上留 DETECT.corpseTtlMs(≈3s),这段时间里 findStrE/locate 照样命中 ——
 * 尸体和活怪在"区域内有没有这串字"上结果完全相同,拿它判活等于把"怪死"的信号吃掉:
 * 循环会抱着尸体继续放技能,也不去扫下一只。
 * 两个信号的分工:
 *   识别范围里的文字 → 找新目标 + 给 target 技能提供点击坐标(见 MonsterNameDetector)
 *   HUD 里的名字     → 唯一的"活/死"判据(游戏自己维护的当前目标,怪死/丢失锁定立刻变空)
 *
 * ⚠️ 代价不对称,所以宁可偏向"判死":把尸体当活怪 = 白打几秒且不重扫;
 *    把活怪当死了 = 重新扫一次(≤1 个 pollMs),怪还在就再锁一次。
 * 单次读空不算死:DETECT.hudLostMs 的确认窗口挡掉 OCR 抖动(连续读空才认死)。
 *
 * @param hudName 本轮读到的 HUD 文本,'' = 本轮读空(调用方每轮读一次,避免每个技能都 OCR)
 */
function isLockAlive(locked: LockedMonster, hudName: string): boolean {
  if (hudName) {
    locked.hudSeenAt = Date.now();
    return true;
  }
  return Date.now() - locked.hudSeenAt < DETECT.hudLostMs;
}

/** 这个坐标上的名字是不是刚击杀的尸体(TTL 内跳过它,别当新目标;过期项顺手清掉,免得 Map 一直长) */
function isCorpseIgnored(run: FarmRun, pos: Point): boolean {
  const key = posGridKey(pos);
  const until = run.corpses.get(key);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    run.corpses.delete(key);
    return false;
  }
  return true;
}

/**
 * 怪被打死:把尸体名字的位置记进忽略表(DETECT.corpseTtlMs 内不再当目标)。
 * 位置从识别范围里重新定位尸体名拿到(它此刻还在原地);名字已经不在了 = 尸体早清完了,没东西可跳过。
 * @returns 记下忽略的坐标;名字已消失返回 null
 */
function ignoreCorpse(run: FarmRun, name: string): Point | null {
  const pos = run.monster.locate(name);
  if (!pos) return null;
  const now = Date.now();
  for (const [key, until] of run.corpses) {
    if (now >= until) run.corpses.delete(key);
  }
  run.corpses.set(posGridKey(pos), now + DETECT.corpseTtlMs);
  return pos;
}

/**
 * 本挂机点是不是没得打、该走了:连续 DETECT.idleMs 没锁上过一只怪。
 * 「识别不到怪」和「扫到的都是刚击杀的尸体(被 isCorpseIgnored 跳过)」都算没得打 ——
 * 后者名字虽然还挂在画面上,但已经打不到了,不能当成"有怪"把它一直留在本点。
 */
function leaveSpotIfIdle(run: FarmRun, lastSeenAt: number): boolean {
  if (Date.now() - lastSeenAt < DETECT.idleMs) return false;
  run.ctx.sendLog('info', `[${run.label}] 连续 ${DETECT.idleMs}ms 未锁定到怪物,结束本挂机点`);
  return true;
}

/**
 * 定点识别(一次到点):识别怪名 → 左键点一下锁定(读 HUD 确认) → 按配置打,直到该点再也打不到怪才离开
 * - 锁定 = 左键点一下识别到的怪名;游戏锁定成功才会把名字写进 HUD,读不到名字就当没锁上
 *   (HUD 里的名字与识别到的对不上时不锁定,只打一条警告,继续扫描)
 * - 扫到了、点了、HUD 里却没出现名字 → 这个目标已经阵亡(尸体名字还留在识别范围里),
 *   不攻击,回去接着扫下一只(连续这么扫 DETECT.idleMs 打不出东西就由 leaveSpotIfIdle 收工)
 * - 怪死 / 丢失锁定判定 = HUD(已锁定怪物名称)读空(见 isLockAlive):
 *   识别范围里的名字不能判死活 —— 尸体名还要留 DETECT.corpseTtlMs 才消失
 * - 击杀后把尸体名字的坐标记进忽略表(DETECT.corpseTtlMs 内不再当目标,见 isCorpseIgnored):
 *   否则重扫时会把还没消失的尸体名当成新目标,左键点它 = 白走一趟
 * - 没配技能        → 普通攻击:锁定后游戏自动攻击(点那一下就是攻击命令)
 * - 配了 + 智能施法 → 循环释放全部已配置技能(各自按 CD,排除「物品使用」)
 * - 配了 + 自定义施法→ 循环释放该点绑定的技能(含显式绑定的「物品使用」)
 * 识别不到怪不再立刻离开:原地继续识别 DETECT.idleMs,连续这么久没锁上怪才前往下一个路径点
 * 开了物品拾取时拾取优先:每轮循环先捡一次(见 runPickup),正在打的怪也先放下 ——
 *   捡东西会把人走开、丢掉锁定,下一轮重新识别(怪还在就重新锁上,不在就找下一只)
 */
async function runDetectSpot(run: FarmRun, wp: ResolvedWaypoint): Promise<void> {
  const { ctx, conf, view, label, monster, lastCast } = run;
  const ctrl = ctx.moveAttack;
  // 参与攻击的技能:宠物技能(骑乘)不参与;智能施法再排除「物品使用」(药品交给看门狗的「生命回复」,不在每个点空放);
  // 自定义施法按用户显式绑定(含物品)
  const castable = wp.skills.filter((s) => s.method !== 'pet' && !(conf.castMode === 'smart' && s.method === 'item'));

  ctx.sendLog(
    'info',
    `[${label}] 定点识别:范围(${fmtRange(conf.ocrRange)}) 锁定名称区(${fmtRange(conf.lockedNameRoi)})` +
      ` 颜色=${conf.monsterColor} 关键字=[${conf.monsterKeywords.join(',') || '无(纯OCR)'}]` +
      ` 技能=${castable.length > 0 ? `${castable.length}个` : '无(普通攻击)'}` +
      ` 施法=${conf.castMode === 'smart' ? '智能施法' : '自定义施法'}`,
  );

  // 当前锁定的怪物(判活靠它的 hudSeenAt,见 isLockAlive)
  let locked: LockedMonster | null = null;
  // 最后一次「锁上怪」的时间:据此判断是否已连续 idleMs 没得打 → 离开本挂机点(见 leaveSpotIfIdle)
  let lastSeenAt = Date.now();
  /** HUD 一次都没读到过名字:说明「已锁定怪物名称」区域/颜色很可能没配对(它现在是判活的唯一依据) */
  let hudNeverSeen = true;

  while (ctrl.running) {
    // 等待暂停
    await waitWhilePaused(ctx, label);
    if (!ctrl.running) return;

    // 0) 拾取优先:不管有没有正在打的怪,先把范围内的物品捡掉再继续。
    //    runPickup 会把能找到的都捡完才返回;捡到要刷新「有怪」计时
    //    (拾取本身耗时,别让它把下一点的等待窗口吃掉),没捡到则不刷新,该走就走
    if ((await runPickup(run)) === 'picked') {
      lastSeenAt = Date.now();
      continue;
    }

    // 每轮读一次 HUD:它是"锁定的怪还在不在"的唯一判据(见 isLockAlive);没锁定目标就不用读
    const hudName = locked ? monster.readLockedName() : '';
    if (hudName) hudNeverSeen = false;

    // 1) 没有锁定目标 / HUD 连续读空(确认已击杀)→ 重新识别 → 左键点一下开打
    if (!locked || !isLockAlive(locked, hudName)) {
      if (locked) {
        // 怪死了:尸体名字可能还挂在识别范围里(DETECT.corpseTtlMs≈3s)→ 记进忽略表,别把它当新目标
        const corpsePos = ignoreCorpse(run, locked.name);
        ctx.sendLog(
          'info',
          `[${label}] HUD 锁定名称消失,判定「${locked.name}」已击杀` +
            (corpsePos ? `(尸体名还在 (${corpsePos.x},${corpsePos.y}),${DETECT.corpseTtlMs}ms 内不再当目标)` : ''),
        );
      }
      locked = null;
      // 找目标时跳过刚击杀的尸体名字(忽略表按坐标记:同名怪在别处刷出来照样能识别到)
      const m = monster.detect((pos) => isCorpseIgnored(run, pos));

      // 没有扫描到怪物
      if (!m) {
        // 识别不到怪物:连续 idleMs 没得打就离开本挂机点,否则原地继续识别(等刷新)
        if (leaveSpotIfIdle(run, lastSeenAt)) return;
        await sleep(DETECT.pollMs);
        continue;
      }

      // 左键点击开始攻击
      await clickMonsterName(run, monster.locate(m.name) ?? m.screenPos, 'left');
      ctx.sendLog('info', `[${label}] 识别到怪物「${m.name}」@(${m.screenPos.x},${m.screenPos.y}),左键点击开打`);
      // 等游戏把「已锁定怪物名称」写进 HUD,再读一次:HUD 里有名字才说明这一下点中了
      await sleep(DETECT.lockMs);
      const hudAfterClick = monster.readLockedName();
      if (hudAfterClick) hudNeverSeen = false; // 能读出来 = HUD 区域/颜色没问题
      if (hudAfterClick.includes(m.name)) {
        // ⚠️ name 记识别到的名字(不是 HUD 名):它一定能在识别范围内 findStrE 到,
        // target 技能的定位、以及怪死后重新定位尸体位置都靠它;HUD 名带一个 OCR 噪声就再也定位不到
        locked = { name: m.name, clickedAt: Date.now(), hudSeenAt: Date.now() };
        lastSeenAt = Date.now();
        ctx.sendLog('info', `[${label}] 已锁定「${m.name}」(HUD:「${hudAfterClick}」),开始攻击`);
      } else if (!hudAfterClick && hudNeverSeen) {
        // HUD 读空:可能这只是尸体,也可能是 HUD 区域/颜色没配对 —— 后者会让判活全部失效,必须提示
        ctx.sendLog(
          'warn',
          `[${label}] 左键点击「${m.name}」后 HUD 读不到名字:若每只怪都这样,` +
            `先核对「已锁定怪物名称」区域与颜色(它现在是判断怪死活的唯一依据)`,
        );
      } else if (hudAfterClick) {
        ctx.sendLog('warn', `[${label}] HUD 锁定名称「${hudAfterClick}」与识别到的「${m.name}」对不上,本次不锁定,继续扫描`);
      }
      await sleep(DETECT.pollMs);
      continue;
    }

    // HUD 读空(还在确认窗口内)就先不动手:可能这只已经死了,别把技能空放给尸体 ——
    // 窗口一到,上面的分支 1 就会按"已击杀"收尾(记尸体忽略表 + 重新识别)
    if (!hudName) {
      await sleep(DETECT.pollMs);
      continue;
    }
    // HUD 里还有名字 = 怪还锁着,刷新「有怪」时间
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
      // 每个技能前重新读一次 HUD:中途怪死了立刻停手,别把技能空放给尸体(见 isLockAlive)
      if (!isLockAlive(locked, monster.readLockedName())) {
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
  // ctx.sendLog(
  //   'info',
  //   `[${label}] 到达 (${current.x},${current.y}) 挂机点,技能 ${wp.skills.length} 个 ` +
  //     `定点打怪:移动反方向落点 (${aimPoint.x},${aimPoint.y}) 默认距离=${aim.distance}px` +
  //     (aim.clamped ? '(超出画面,已夹到边界;各技能的"施法距离"可单独调)' : ''),
  // );

  const skillsToCast = pickSkillsToCast(run, wp, Date.now());
  if (skillsToCast.length === 0) {
    ctx.sendLog('info', `[${label}] 无可释放技能(全部冷却中),留到下一个挂机点`);
    return;
  }

  for (const [index, skill] of skillsToCast.entries()) {
    if (!ctx.moveAttack.running) break;
    // 技能配得多时,每个技能释放前先让一拍,避免连点被当成异常操作
    if (index > 0) await sleep(INTER_SKILL_MS);
    const clickPos = skill.method === 'target' ? fixedAimPoint(view, angle, skill) : null;
    // 目标技能(如普通攻击)需要先定位到目标,再点击
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
  const others = ready.filter((s) => s.method !== 'self' && s.method !== 'item' && s.method !== 'pet');
  const best = others.length > 0 ? [others.reduce((a, b) => (b.cooldownMs > a.cooldownMs ? b : a))] : [];
  return [...best, ...selfBuffs]; // 先放输出技能,再放状态 buff
}

// ===== 条件回城(达到条件 → 结束本轮打怪 → 回城 → 城市/跨境逻辑回挂机图 → 重开一轮)=====

/** 连读几次地图名(OCR 偶发读空);全读空返回 null */
async function readMapNameRetry(run: FarmRun, attempts = 3, retryMs = 600): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const name = String((await run.readMapName()) ?? '').trim();
    if (name) return name;
    if (i < attempts - 1) await sleep(retryMs);
  }
  return null;
}

/** 小退前清怪的收工判据:与定点识别同一套语义(连续 DETECT.idleMs 没锁上怪 = 打光了) */
const CLEAR_MOBS = {
  /** 在每只怪身上最多打多久(ms):单只怪卡住(打不动/打不到)时的兜底,超过就换个目标重扫 */
  perMonsterTimeoutMs: 20_000,
};

/**
 * 小退前清怪:把周围的怪打光(被攻击时小退不会成功)。
 *
 * 与 conf.mode 无关:定点打怪不做识别,这里也一律走「识别 → 开打 → 打到死」这一条,
 * 复用定点识别那一套现成实现:
 *   识别 = run.monster(MonsterNameDetector,参数来自 conf.monsterKeywords / monsterColor / ocrRange / lockedNameRoi)
 *   开打 = 配了技能就直接放技能(缺省施法/target 技能自带的那次左键落在识别到的怪名位置,首次释放顺便把怪选上);
 *          没配技能才用 clickMonsterName 左键点怪名开打(普通攻击)
 *   判活 = isLockAlive / readLockedName(HUD);配了技能的路径不等 HUD 先出现
 *   输出 = castSkill,技能取 conf.skills(过滤掉宠物技能;智能施法下的物品技能不空放,与 runDetectSpot 同规则)
 *   尸体跳过 = isCorpseIgnored / ignoreCorpse(与定点识别共用同一张忽略表)
 *
 * 收工 = 连续 DETECT.idleMs 没识别到怪(与 leaveSpotIfIdle 同语义);
 * 兜底 = 总超时 timeoutMs(怪会刷新,不能无限打)——超时按失败返回,让调用方决定是否还要小退。
 * 途中角色死亡也按失败返回(小退要点菜单,人得活着;死亡不该在这里被悄悄吞掉)。
 */
async function clearMobsAround(run: FarmRun, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  const { ctx, conf, label, lastCast } = run;
  const ctrl = ctx.moveAttack;
  // 识别参数:勾了「小退前清怪」后界面可以单独配一份(范围/颜色/关键字),没填的项沿用本任务「定点识别」的对应值
  // (见 shared/types.ts 的 FarmEndReturnReloginConfig.mobFilter)
  const over = conf.endReturn.relogin.mobFilter;
  const roi = over?.ocrRange ?? conf.ocrRange;
  const color = over?.nameColors ? over.nameColors.join('|') : conf.monsterColor;
  const keywords = over?.nameKeywords ?? conf.monsterKeywords;
  // 一项都没覆盖 → 复用主循环那份识别器(省一次构造);覆盖过 → 另建一份,绝不动主循环的定点识别参数
  const monster =
    roi === conf.ocrRange && color === conf.monsterColor && keywords === conf.monsterKeywords
      ? run.monster
      : new MonsterNameDetector({ roi, color, similarity: DETECT.similarity, keywords, lockedRoi: conf.lockedNameRoi });
  // 参与输出的技能:宠物技能(骑乘)不参与;智能施法再排除「物品使用」(药品交给看门狗的「生命回复」)
  const castable = conf.skills.filter((s) => s.method !== 'pet' && !(conf.castMode === 'smart' && s.method === 'item'));
  const deadline = Date.now() + timeoutMs;
  let locked: LockedMonster | null = null;
  /**
   * 怪名位置(「开打那次点击」的落点):配了技能时目标的左键就落在这里 —— 见下面的技能循环。
   * null = 还没锁定 / 已放弃该目标;没配技能时不用它(普通攻击靠 HUD 判活)。
   */
  let lockedAim: Point | null = null;
  /** 最后一次「锁上怪」的时间:连续 DETECT.idleMs 没锁上就认为清完了 */
  let lastSeenAt = Date.now();

  ctx.sendLog(
    'info',
    `[${label}] 小退前清怪:范围(${fmtRange(roi)}) 颜色=${color} 关键字=[${keywords.join(',') || '不限(纯OCR)'}]` +
      ` 识别参数=${over ? '「小退回城」里单独配的' : '沿用本任务「定点识别」'}` +
      ` 技能=${castable.length > 0 ? `${castable.length}个` : '无(锁定后靠普通攻击)'} 总超时=${Math.round(timeoutMs / 1000)}s`,
  );

  while (ctrl.running) {
    if (Date.now() >= deadline) {
      return {
        ok: false,
        detail: `小退前清怪超时(${Math.round(timeoutMs / 1000)}s 内一直有怪没清掉,被攻击时小退不会成功;可在「小退回城」里调大清怪超时)`,
      };
    }

    // 清怪途中角色死亡:小退要点系统菜单,得先活着 —— 直接报失败,死亡不该由这里悄悄吞掉
    if (detectCharacterDeath(run).dead) {
      return { ok: false, detail: '小退前清怪时角色死亡(复活后重试,或先确认能打过这片怪)' };
    }

    // 读 HUD:它是"锁定的怪还在不在"的唯一判据(见 isLockAlive);没锁定目标就不用读
    const hudName = locked ? monster.readLockedName() : '';
    if (!locked || !isLockAlive(locked, hudName)) {
      if (locked) {
        const corpsePos = ignoreCorpse(run, locked.name);
        ctx.sendLog(
          'info',
          `[${label}] 清怪:HUD 锁定名称消失,判定「${locked.name}」已击杀` +
            (corpsePos ? `(尸体名 ${DETECT.corpseTtlMs}ms 内不再当目标)` : ''),
        );
      }
      locked = null;
      lockedAim = null;
      const m = monster.detect((pos) => isCorpseIgnored(run, pos));
      if (!m) {
        if (Date.now() - lastSeenAt >= DETECT.idleMs) {
          ctx.sendLog('info', `[${label}] 清怪:连续 ${DETECT.idleMs}ms 未识别到怪,认为周围已清完`);
          return { ok: true, detail: `连续 ${DETECT.idleMs}ms 未识别到怪` };
        }
        await sleep(DETECT.pollMs);
        continue;
      }
      // 怪名位置:没配技能时开打点的就是这里;配了技能时缺省施法(target)技能的左键也落在这里
      const aimPos = monster.locate(m.name) ?? m.screenPos;
      if (castable.length > 0) {
        // 配了技能:识别到怪就直接用技能打,不先左键点一下开打(用户要求)。
        // 缺省施法(target)技能带的那次左键落在 aimPos,首次释放顺便把怪选上,HUD 随后就会出现它的名字。
        ctx.sendLog('info', `[${label}] 清怪:识别到「${m.name}」@(${aimPos.x},${aimPos.y}),用技能打(不左键开打)`);
        locked = { name: m.name, clickedAt: Date.now(), hudSeenAt: Date.now() };
        lockedAim = aimPos;
        lastSeenAt = Date.now();
        await sleep(DETECT.pollMs);
        continue;
      }
      // 没配技能:左键点击怪名开打(普通攻击),靠 HUD 判活
      await clickMonsterName(run, aimPos, 'left');
      ctx.sendLog('info', `[${label}] 清怪:识别到「${m.name}」@(${aimPos.x},${aimPos.y}),左键点击开打`);
      await sleep(DETECT.lockMs);
      // 读一次 HUD 确认点中了(与 runDetectSpot 同一套:怪死后重新定位尸体位置也靠名字)
      const hudAfterClick = monster.readLockedName();
      if (hudAfterClick.includes(m.name)) {
        locked = { name: m.name, clickedAt: Date.now(), hudSeenAt: Date.now() };
        lastSeenAt = Date.now();
        ctx.sendLog('info', `[${label}] 清怪:已锁定「${m.name}」(HUD:「${hudAfterClick}」)`);
      }
      await sleep(DETECT.pollMs);
      continue;
    }

    // HUD 读空:没技能的路径靠 HUD 判活(读空就等下一轮);配了技能的路径不等 HUD ——
    // 缺省施法技能自带左键,首次释放后 HUD 自然会出现怪名
    if (!hudName && !lockedAim) {
      await sleep(DETECT.pollMs);
      continue;
    }
    lastSeenAt = Date.now();

    // 单只怪最多耗 CLEAR_MOBS.perMonsterTimeoutMs:打不动(太远/打不到)就丢锁重扫,别一直卡在它身上
    if (Date.now() - locked.clickedAt > CLEAR_MOBS.perMonsterTimeoutMs) {
      ctx.sendLog(
        'warn',
        `[${label}] 清怪:「${locked.name}」打了 ${Math.round(CLEAR_MOBS.perMonsterTimeoutMs / 1000)}s 还没死,换个目标重新扫描`,
      );
      locked = null;
      await sleep(DETECT.pollMs);
      continue;
    }

    // 释放 CD 已好的技能
    const now = Date.now();
    for (const skill of castable) {
      if (!ctrl.running || Date.now() >= deadline) break;
      if (now - (lastCast.get(skill.id) || 0) < skill.cooldownMs) continue;
      if (!isLockAlive(locked, monster.readLockedName())) {
        ctx.sendLog('info', `[${label}] 清怪:「${locked.name}」锁定名称消失,停止技能,重新扫描`);
        locked = null;
        lockedAim = null;
        break;
      }
      let clickPos: Point | null = null;
      if (skill.method === 'target') {
        // 缺省施法:左键落在"刚才开打那次点击的位置"(识别到怪名的地方);拿不到才重新定位一次
        clickPos = lockedAim ?? monster.locate(locked.name);
        if (!clickPos) {
          locked = null;
          lockedAim = null;
          break;
        }
      }
      if (await castSkill(run, skill, clickPos)) lastCast.set(skill.id, Date.now());
    }
    await sleep(DETECT.pollMs);
  }

  return { ok: false, detail: '任务已停止(清怪途中)' };
}

/**
 * 小退回城的收口:清怪(可选,被攻击时小退不会成功)→ 小退流程(见 relogin.ts)。
 * 成功返回 null = 已离开游戏并重新上线,后续由 runFarmLoop 的 prepareFarmEntry 负责回挂机图(与小退前一致);
 * 失败返回结果 = 任务就此结束(别在野外瞎跑)。
 */
async function runReloginEndReturn(run: FarmRun, reason: string): Promise<FarmLoopResult | null> {
  const { ctx, conf, label } = run;
  const rel = conf.endReturn.relogin;
  ctx.setStatus('resupply', `${label} 小退回城(${reason})`);

  if (rel.clearMobs) {
    ctx.sendLog('info', `[${label}] 小退回城:先清掉周围的怪(清怪开关开启)`);
    const cleared = await clearMobsAround(run, rel.clearTimeoutMs);
    if (!cleared.ok) {
      const detail = `条件回城(小退):${cleared.detail}`;
      ctx.sendLog('warn', `[${label}] ${detail}`);
      return { ok: false, detail };
    }
  } else {
    ctx.sendLog('warn', `[${label}] 小退回城:清怪已关闭,被攻击时小退可能不成功(建议保持勾选)`);
  }

  const res = await returnViaRelogin({
    ctx,
    client: dmApi,
    input: run.input,
    size: run.size,
    label,
    readMapName: run.readMapName,
    // 坐标用小退前那份 reader(不带地图名):选择角色界面上坐标/地图名都读不出来,两个信号一起判
    readPosition: () => run.movement.readPosition(),
    maxAttempts: rel.maxAttempts,
    isStopped: () => !ctx.moveAttack.running,
  });
  if (res.ok) {
    ctx.sendLog('info', `[${label}] 条件回城(小退)完成:${res.detail}`);
    return null;
  }

  const detail = `条件回城(小退):${res.detail}`;
  ctx.sendLog('warn', `[${label}] ${detail}`);
  return { ok: false, detail };
}

/**
 * 条件回城的"回城"这一步:
 *   method='scroll'  → 按回城卷轴 → 观察窗口内等地图名变化 → 没变就再按,最多 maxAttempts 次
 *                      (技能共用「回城卷轴」conf.returnScroll,见 shared/types.ts)
 *   method='relogin' → 清怪 → 小退(见 runReloginEndReturn / relogin.ts)
 * 返回 null = 已离开原图(回城卷轴落在主城 / 小退后重新上线);返回结果 = 回城失败,任务就此结束。
 */
async function runEndReturn(run: FarmRun, reason: string): Promise<FarmLoopResult | null> {
  const { ctx, conf, label } = run;
  const end = conf.endReturn;

  if (end.method === 'relogin') return runReloginEndReturn(run, reason);

  // 只要求它引用到了物品技能:「回城卷轴」的 enabled 管的是"任务启动时自动回城",条件回城不看它
  const key = conf.returnScroll.key;
  if (!key) {
    const detail = '条件回城:没配「回城卷轴」的物品技能,无法回城(在「回城卷轴」里选一个物品栏快捷栏技能)';
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }

  // 按之前先确认地图名读得到:returnViaScroll 用"地图名变了"判成功,
  // 起点读空会被当成"已回城"误判(见 core/navigation/RouteTraveler.ts 的 waitForMapChange)
  if (!(await readMapNameRetry(run))) {
    const detail = '条件回城:回城前读不到地图名(OCR 失败:核对地图名区域/颜色与设置里的分辨率)';
    ctx.sendLog('warn', `[${label}] ${detail}`);
    return { ok: false, detail };
  }

  ctx.setStatus('resupply', `${label} 回城中(${reason})`);
  const stopped = (): boolean => !ctx.moveAttack.running;
  for (let attempt = 1; attempt <= end.scroll.maxAttempts; attempt++) {
    const back = await returnViaScroll({
      ctx,
      input: run.input,
      readMapName: run.readMapName,
      label,
      key,
      timeoutMs: end.scroll.pressIntervalMs,
      isStopped: stopped,
    });
    if (back.ok) {
      ctx.sendLog('info', `[${label}] 条件回城:第 ${attempt}/${end.scroll.maxAttempts} 次按回城卷轴成功,${back.detail}`);
      return null;
    }
    ctx.sendLog('warn', `[${label}] 第 ${attempt}/${end.scroll.maxAttempts} 次按回城卷轴没回城: ${back.detail}`);
    // 停止命令中途到达:不回城了,循环也别再往下跑
    if (stopped()) return { ok: false, detail: '任务已停止(回城途中)' };
  }

  const detail = `条件回城失败:按了 ${end.scroll.maxAttempts} 次回城卷轴都没回城` + '(核对卷轴键位/数量,或被攻击时卷轴不生效),退出打怪循环';
  ctx.sendLog('warn', `[${label}] ${detail}`);
  return { ok: false, detail };
}

/**
 * 「背包已负载」(背包/装备装满)扫描 —— 带迟滞(迟滞标志见 FarmRun.bagFullArmed)。
 *
 * 为什么需要迟滞:这条提示会一直留在聊天框里(不会自己消失),不做迟滞的话每圈扫到都会回城,
 * 变成"回城 → 回挂机图 → 下一圈扫到同一条旧提示 → 又回城"的无限来回。
 * 迟滞模型 = 扫到提示且「已武装」→ 触发一次并置为未武装;扫不到提示 → 重新武装。
 * 也就是同一条提示必须先消失过一次,才可能触发第二次。
 *
 * ⚠️ 找字/OCR 是低频重操作:只在开了条件回城且勾了「背包已满时回城」时才做(第一行就返回)。
 * 触发原因由调用方存进本圈的局部变量,圈末收口时复用 —— 触发后标志已置为未武装,再扫一次读不到。
 *
 * @returns 触发时返回原因(给日志与 reset detail 用),没触发返回 null
 */
function scanBagFullOnce(run: FarmRun): string | null {
  const { ctx, conf, label } = run;
  if (!conf.endReturn.enabled || !conf.endReturn.overloaded) return null;

  const hit = detectBagFull(dmApi, run.size);
  // 该分辨率档位没有实测区域:启动时已经提示过一条,这里静默(不会命中)
  if (hit.unsupported) return null;

  if (!hit.full) {
    // 提示不在屏幕上 → 重新武装,下次再出现才可能触发
    run.bagFullArmed = true;
    return null;
  }
  if (!run.bagFullArmed) return null; // 同一条提示已经触发过,且还没从聊天框消失

  run.bagFullArmed = false;
  const reason = `背包已负载(聊天框提示「${hit.text}」)`;
  ctx.sendLog('info', `[${label}] ${reason}`);
  return reason;
}

/**
 * 条件回城判定(每圈结束时调一次):满足返回触发原因,否则 null。
 * 圈数用调用方给的"已完成圈数"(只有每个路径点都走到的整圈才计,见 walkWaypoints)。
 * 背包分支要扫聊天框(找字/OCR),所以这里是 async;扫描只在勾了「背包已满时回城」时才发生。
 */
async function checkEndReturn(run: FarmRun, completedLoops: number): Promise<string | null> {
  const end = run.conf.endReturn;
  if (!end.enabled) return null;
  if (end.loops !== null && completedLoops >= end.loops) {
    return `完成 ${completedLoops} 圈(达到设定 ${end.loops} 圈)`;
  }
  // 背包/装备已满(见 scanBagFullOnce:带迟滞,同一条提示不会连着触发两次)
  if (end.overloaded) return scanBagFullOnce(run);
  return null;
}

// ===== 主循环 =====

/**
 * 沿路径点循环:走到点 → (定点识别先锁怪) → 放技能 → 下一个点
 * - 每次移动前先扫一眼拾取(见 runPickup):拾取点击会走位,只能在没移动的时候做
 * - 卡住的点(超过 noMoveTimeoutMs 没动)记一条日志就跳过,不强求
 * - 死亡回城补给成功后结束本圈,从第一个路径点重新跑(不再从死亡时的中断点续跑)
 * - 条件回城(taskConfig.endReturn):走到本圈最后一个路径点(不管有没有真的到达)= 完成一圈,
 *   满足条件就返回 reset 结果,由 runFarmLoop 回城 → 回挂机图 → 重开一轮(不是结束任务)
 * - 背包已满(勾了「背包已满时回城」)时不等到圈末:每个路径点拾取后扫一次(见 scanBagFullOnce),
 *   命中就结束本圈去回城(本圈没走到最后一个点,不计入圈数)
 * - 目标地图名以最近一次读到的坐标为准:过图/传送后 start.map 就过期了,
 *   继续拿它当目标会让 moveTo 每次都判成「跨图」直接失败
 * - 入图点(type='entry')不参与循环:它们只在回城/开工补给重新进图后走(见 resupply-runner)
 */
async function walkWaypoints(run: FarmRun, start: MapPosition): Promise<FarmLoopResult> {
  const { ctx, conf, label } = run;
  const ctrl = ctx.moveAttack;
  /** 挂机循环实际要走的点(去掉入图点) */
  const patrol = conf.waypoints.filter((w) => w.type !== 'entry');
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
  /**
   * 已完成圈数(条件回城按它判"完成 N 圈")。
   * 口径:走到本圈**最后一个路径点并到达**就算完成一圈(见下面的 lastWp 判定),不看中间有没有点被跳过 ——
   * 路径点偶尔卡住跳过的圈子若一律不计,容易出现"永远攒不到 N 圈、条件回城永不触发"的死角。
   */
  let completedLoops = 0;
  /** 本圈最后一个路径点:走到(到达)它就判一次条件回城 */
  const lastWp = patrol[patrol.length - 1];

  while (ctrl.running) {
    await waitWhilePaused(ctx, label);
    if (!ctrl.running) break;

    loop++;
    /** 本圈在路径点扫到的「背包已负载」原因(圈末收口用;见 scanBagFullOnce) */
    let bagFullAtWaypoint: string | null = null;
    /**
     * 本圈是否已经开过「打怪前开启宠物技能」。
     * 宠物技能是状态技能:开一次就一直存在,所以每圈只在第一个到达的挂机点放一次(见下面的 farm-spot 分支)。
     */
    let preFarmSkillDone = false;
    const loopDesc = `第 ${loop} 圈`;
    ctx.setStatus('moving', `${label} ${loopDesc}`);
    ctx.sendLog('info', `[${label}] ${loopDesc}开始`);
    // 每圈开始读一次地图名:变了就重新屏蔽所有人(路径点不跨图,这里够用)
    await blockAllPlayersIfMapChanged(run);
    // 死亡检查(可能内含"回城补给";补给成功 = 'resupplied')
    const deadAtStart = await checkDeath(run, loop, '开始时');
    if (deadAtStart) {
      if (deadAtStart.kind === 'exit') return deadAtStart.result;
      // 开工前死亡、补给成功:角色已被带回入图点;本圈本来就从第一个路径点开始,重读当前位置当"上一位置"
      prev = await run.movement.readPosition();
    }

    for (const wp of patrol) {
      if (!ctrl.running) break;
      // 移动前再查一次死亡(挂机点之间移动耗时较长,避免死后还跑完整圈)
      const dead = await checkDeath(run, loop, '途中');
      if (dead) {
        if (dead.kind === 'exit') return dead.result;
        // 死亡后回城补给成功:不再从死亡时的中断点续跑 —— 结束本圈,让 while 重进 for 从第一个路径点跑
        ctx.sendLog('info', `[${label}] 补给完成,本圈从头重新开始`);
        // 角色已被带回入图点:重读当前位置当"上一位置",免得定点打怪方向沿用死亡前的坐标
        prev = await run.movement.readPosition();
        stuckCount = 0;
        break;
      }

      // 从这里到本点结束 = 挂机循环(挂机点之间的走位 + 打怪):允许看门狗的生命回复扫描血条
      // (见 ctx.farmSpotActive)。每次进入本段置位、离开(含 continue)在 finally 复位 ——
      // 挂机点之间的走位也算在内;只有「从地图到挂机点起点」(开工/回城补给的入图段)和死亡/补给期间不扫描。
      ctx.farmSpotActive = true;
      try {
        // 移动前先把能捡的捡掉(移动本身是连续左键点击,拾取点击会和它抢鼠标):
        // 一轮会把范围内能找到的物品都捡完才返回,所以捡完才走下一个点
        if ((await runPickup(run)) === 'picked') {
          // 捡东西会把人走到物品旁边 → 重记"上一位置",免得定点打怪的方向算歪
          prev = (await run.movement.readPosition()) ?? prev;
        }

        // 捡完顺手扫一次「背包已负载」(只在勾了「背包已满时回城」时真扫,见 scanBagFullOnce):
        // 满了就捡不起来也打不动,尽快结束本圈去回城(本圈没走到最后一个点,由圈末那次收口处理)
        const bagHit = scanBagFullOnce(run);
        if (bagHit) {
          ctx.sendLog('info', `[${label}] 检测到${bagHit},结束本圈准备回城`);
          bagFullAtWaypoint = bagHit;
          break;
        }

        // 移动到下一个路径点:精确点移动的落点就是目标坐标本身,坐标又是整数 → 1 个单位内即到位;
        // 坐标读数是整数,只要变了(±1)就算在移动,别让"没移动"计时误判卡住(3s 没动视为卡住)
        const arrived = await run.movement.moveTo(
          { map: mapName, x: wp.x, y: wp.y },
          {
            arriveTolerance: 1, // 到达容忍度:1 个单位内即到位
            stepIntervalMs: conf.stepIntervalMs, // 每次移动间隔
            noMoveTimeoutMs: 2000, // 1.5s 没动视为卡住
            moveEpsilon: 0.5, // 1 个单位内即到位
          },
        );
        // 读取当前位置(可能超出画面,落进 UI 区域)
        const current: MapPosition | null = await run.movement.readPosition();
        if (current?.map) mapName = current.map;
        // 落点超出画面会裁到画面内,落进配置的 UI 区域会缩到区域外,见 blockRects
        const here: MapPosition | null = current ?? prev;

        // 本圈最后一个路径点 = 一圈走完(口径:走到最后一个点就算完成一圈,**不管有没有真的到达** ——
        // 某个点常年卡住时,按"必须到达"会让圈数条件永远不触发)。
        // 就在这里判一次条件回城:命中就直接结束本圈去回城,不再在最后一点上打一轮。
        if (wp === lastWp) {
          if (!arrived) ctx.sendLog('warn', `[${label}] 最后一个路径点 (${wp.x},${wp.y}) 没走到,仍按完成本圈处理`);
          completedLoops++;
          ctx.sendLog('info', `[${label}] 已走到本圈最后一个路径点 (${wp.x},${wp.y}),完成第 ${completedLoops} 圈`);
          const lastHit = bagFullAtWaypoint ?? (await checkEndReturn(run, completedLoops));
          if (lastHit) {
            ctx.sendLog('info', `[${label}] 触发条件回城:${lastHit};结束本轮打怪,准备回城`);
            return { ok: true, detail: `条件回城:${lastHit}`, reset: true };
          }
        }

        if (!arrived) {
          stuckCount++;
          ctx.sendLog('warn', `[${label}] 路径点 (${wp.x},${wp.y}) 未到达(累计卡住 ${stuckCount} 个点),跳过`);
          prev = here;
          continue;
        }
        // 到达后重置卡住计数
        stuckCount = 0;
        if (!here) continue;

        // 到达挂机点:从城里一路上骑过来就先下骑;随后按需「打怪前开启宠物技能」,再开始打怪。
        // (两者互不影响:没开骑乘时没有下骑那一步,宠物技能照样会开;见 shared/types.ts 的 FarmPetRideConfig)
        if (wp.type === 'farm-spot') {
          const deps = { client: dmApi, input: run.input, size: run.size };
          const dismounted = ctx.petMounted;
          // 状态技能开一次就一直有,所以每圈只在第一个到达的挂机点放一次(下骑那一步不受影响,该下还是下)
          const runPreFarmNow = !preFarmSkillDone && conf.petRide.preFarm.enabled && !!conf.petRide.preFarm.skill;
          if (dismounted) {
            // 后面还要开宠物技能时,下骑自己的收尾等待交给那 1s(两段合计 = 下骑之后隔 1s)
            await dismountPet(ctx, deps, conf.petRide, label, { skipSettle: runPreFarmNow });
            ctx.petMounted = false;
          }
          if (runPreFarmNow) {
            await enablePreFarmPetSkill(ctx, deps, conf.petRide, label, { afterDismount: dismounted });
            preFarmSkillDone = true;
          }
        }

        // 处理不同类型的路径点
        if (wp.type !== 'farm-spot') {
          // 休息点 / 路径中间点:只路过,不放技能
          ctx.sendLog('info', `[${label}] 到达 (${here.x},${here.y}) ${wp.type === 'rest' ? '休息点' : '路径点'},不放技能`);
          // 挂机点:定点识别或定点打怪
        } else if (conf.mode === 'fixed-detect') {
          // 定点识别:识别怪名 → 左键点一下锁定(HUD 出现名字)→ 按配置打到怪死
          // (连续识别不到怪 / 扫到的都是尸体 = 结束本挂机点)
          await runDetectSpot(run, wp);
        } else {
          // 定点打怪(默认):不识别,技能打在固定方向
          await runFixedSpot(run, wp, here, prev);
        }
        prev = here;
      } finally {
        ctx.farmSpotActive = false;
      }
    }

    // 停止命令在本圈末尾到达:直接结束
    if (!ctrl.running) break;

    // 走到本圈最后一个路径点时的条件判定在上面(见 lastWp 处)。能走到这里 = 本圈没走完
    // (死亡/背包满提前 break,或最后一个点没到达):这里只收口「背包已负载」这种即时原因
    if (bagFullAtWaypoint) {
      ctx.sendLog('info', `[${label}] 触发条件回城:${bagFullAtWaypoint};结束本圈,准备回城`);
      return { ok: true, detail: `条件回城:${bagFullAtWaypoint}`, reset: true };
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

  // 没有可循环的路径点 = 没什么可跑。不拦的话主循环会在空 for 里空转
  // (整圈没有 await,直接跑满一个核并刷屏日志)。
  // 只配了入图点(type='entry')也算"没有路径点":它们不参与挂机循环
  if (conf.waypoints.filter((w) => w.type !== 'entry').length === 0) {
    const detail = '没有可循环的路径点,无法开始(在「挂机打怪」弹窗里至少加 1 个挂机点/休息点/路径点;入图点不参与挂机循环)';
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
    const size = resolveWindowSizeKey(hwnd, ctx.init.settings?.resolution);
    // movement 内部的坐标 reader 不带分辨率档位(读的是坐标,map 恒为 null,避免触发跨图分支):
    // 挂机主循环 moveTo 的目标图/当前图都判不出来,跨图守卫保持失效,行为与改动前一致
    const movement = new MovementControllerByPrecisePoint(input, new MapCoordReader(vision, mapCoordConfig(ctx)), buildCalibration(view));
    const mapNameReader = new MapCoordReader(vision, mapCoordConfig(ctx), size);
    // 回城补给专用:reader 带分辨率档位 → 能读出当前地图名,RouteTraveler 的跨图守卫才生效
    const travelMovement = new MovementControllerByPrecisePoint(
      input,
      new MapCoordReader(vision, mapCoordConfig(ctx), size),
      buildCalibration(view),
    );

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
      travelMovement,
      size,
      readMapName: () => mapNameReader.readMapName(),
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
      // 已击杀怪物的尸体位置(尸体名还没消失时别再当目标,见 isCorpseIgnored)
      corpses: new Map(),
      // 换图判断的记录:还没有基线,启动后第一次读到地图名就会当作"新地图"按一次
      lastMapName: null,
      // 背包已负载的迟滞标志:一开始视为"已武装",这样启动时聊天框里就挂着的旧提示只会触发一次(见 scanBagFullOnce)
      bagFullArmed: true,
    };

    // 任务启动、角色开始移动前:先读一次地图名,当作换图判断的基线(同时按一次屏蔽)
    await blockAllPlayersIfMapChanged(run);
    // 暂停1s,确保地图加载完成
    await new Promise((resolve) => setTimeout(resolve, 500));
    // 启动时的一次性环境处理(小地图缩放 / 关闭聊天背景);移动攻击测试路径由 opts 关掉
    if (opts?.allowStartupEnv !== false) {
      await runStartupEnvSetup(run);
    }

    // 入图准备(进主循环之前):起点恢复 → 开工补给 → 跨境 → 走挂机图的入图点 → 重读起点。
    // 与「条件回城」每轮回来共用同一段(见 prepareFarmEntry)。移动攻击测试由 opts 关掉。
    const allowResupply = opts?.allowStartupResupply !== false;
    const entry = await prepareFarmEntry(run, start, { allowResupply });
    if (entry.exit) return entry.exit;

    // 条件回城:达到条件就结束本轮打怪 → 回城 → 走城市/跨境逻辑回到挂机图 → 重开一轮(不结束任务)。
    // 移动攻击测试(allowStartupResupply=false)只跑一段走位打怪,不触发条件回城。
    if (allowResupply && conf.endReturn.enabled) {
      // 回城卷轴只会把人送进主城,回挂机图要靠城镇档案(出城口/传送 NPC);没下发就别开跑,免得回城后卡在城里
      if (!ctx.init.auxConfigs?.townProfile) {
        const detail = '条件回城:没下发城镇档案(auxConfigs.townProfile),回城后回不到挂机图';
        ctx.sendLog('warn', `[${label}] ${detail}`);
        return { ok: false, detail };
      }
      if (conf.endReturn.overloaded) {
        // 检测区域按分辨率档位取;只有实测过的那几档有值,缺档位时这个条件不可能生效 —— 启动时先说清楚
        const roi = BAG_FULL_ROI[size];
        if (!roi) {
          ctx.sendLog(
            'warn',
            `[${label}] 勾了「背包已满时回城」,但分辨率 ${size} 还没有实测的提示检测区域,该条件不会生效` +
              `(需要在 core/constant-ocr/bag.ts 里补这一档的坐标)`,
          );
        } else {
          ctx.sendLog(
            'info',
            `[${label}] 背包已负载检测:区域(${roi.x1},${roi.y1})-(${roi.x2},${roi.y2}) 颜色=${roi.color}` +
              ` 提示=[${BAG_FULL_TEXTS.join(' / ')}] 带迟滞(提示消失过才能再次触发)`,
          );
        }
      }
    }
    let round = 1;
    let entryStart = entry.start;
    while (true) {
      const r = await walkWaypoints(run, entryStart);
      if (!r.reset || !ctrl.running || !allowResupply) return r;
      ctx.sendLog('info', `[${label}] 第 ${round} 轮打怪结束(${r.detail}),开始回城`);
      const left = await runEndReturn(run, r.detail);
      if (left) {
        // 长时间挂机多半没人看着:回城失败要主动提醒(应用内浮层 + 系统通知);用户点停止导致的不提醒
        if (ctrl.running) {
          ctx.postMessage({ type: 'notify', key: 'farm-end-return-failed', title: '回城失败', body: left.detail });
        }
        return left;
      }
      // 重新上线也算"重新进过游戏":换图的基线要清掉 ——
      // 小退后角色往往还在同一张图,地图名没变,不清基线的话「每圈一次的换图判断」会一直认为没换图,
      // 「进入新地图时屏蔽所有人」就再也不会按(而游戏重新进图本来会把屏蔽状态重置掉)。
      run.lastMapName = null;
      const prepared = await prepareFarmEntry(run, entryStart, { allowResupply, forceResupply: true });
      if (prepared.exit) return prepared.exit;
      entryStart = prepared.start;
      round++;
      ctx.sendLog('info', `[${label}] 已回到挂机图,开始第 ${round} 轮打怪`);
    }
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
        // 打怪结束(角色死亡/停级、回城失败)后不再需要看门狗
        stopInterruptWatcher(fc.ctx);
      }
    },
  };
}
