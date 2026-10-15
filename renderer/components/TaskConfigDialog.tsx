// 任务配置对话框
// 两步:1.选任务类型(可从历史任务加载) 2.配置参数(挂机打怪详细,其他留白)

import { useState, useEffect } from 'react';
import { X, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Check, History, Keyboard } from '../icons';
import type {
  TaskType,
  TaskConfig,
  FarmTaskConfig,
  FarmSkillConfig,
  FarmMode,
  FarmCastMode,
  FarmWatchdogConfig,
  FarmPickupConfig,
  FarmResupplyConfig,
  FarmPetRideConfig,
  FarmReturnScrollConfig,
  FarmEndReturnConfig,
  SkillCastMethod,
  TeamInviteAction,
  Waypoint,
  StoredTaskConfig,
  DefaultSkillTaskConfig,
  DefaultSkillStep,
  ScreenRect,
  TownProfileConfig,
  DialogRecipeConfig,
  MapProfileConfig,
  PetTrainingConfig,
} from '../../shared/types';
import { ALL_KEY_COMBOS, isValidKeyCombo } from '../../shared/key-combo';
import { FARM_AUX_TRIGGERS } from '../../shared/farm-aux';
import { FARM_MAPS } from '../farm-maps';
import { isConfigOnlyTaskType, referencedByFarmTasks } from '../aux-configs';
import { NPC, normalizeNpcName } from '../../shared/npc';
import { FarmResupplySection, DEFAULT_RESUPPLY, normalizeResupply } from './FarmResupplySection';
import { FarmPetRideSection, DEFAULT_PET_RIDE, normalizePetRide } from './FarmPetRideSection';
import { FarmReturnScrollSection, DEFAULT_RETURN_SCROLL, normalizeReturnScroll } from './FarmReturnScrollSection';
import { FarmEndReturnSection, DEFAULT_END_RETURN, normalizeEndReturn } from './FarmEndReturnSection';
import { ColorTagPicker } from './ColorTagPicker';
import { TownProfileForm } from './TownProfileForm';
import { DialogRecipeForm } from './DialogRecipeForm';
import { MapProfileForm } from './MapProfileForm';
import { MapCrossingsSection } from './MapCrossingsSection';
import { FarmAuxSection } from './FarmAuxSection';
import type { FarmAuxOption } from './FarmAuxSection';
import { PetTrainingForm } from './PetTrainingForm';
import {
  COLOR_WHITE,
  COLOR_RED,
  COLOR_YELLOW,
  COLOR_GREEN,
  COLOR_BLUE,
  COLOR_PURPLE,
  COLOR_YELLOW_WHITE,
  COLOR_GREY_WHITE,
} from '../../core/constant-ocr/color';
import { useStore } from '../store/useStore';
import { HistoryTaskDialog } from './HistoryTaskDialog';

const TASK_OPTIONS: { type: TaskType; name: string; icon: string; desc: string; ready: boolean }[] = [
  { type: 'farm', name: '挂机打怪', icon: '⚔', desc: '自动找怪 + 战斗 + 拾取', ready: true },
  {
    type: 'default-skill',
    name: '缺省技能',
    icon: '🎹',
    desc: '按键编排(F1-F12/Alt/Shift),纯按键循环',
    ready: true,
  },
  { type: 'mine', name: '挖矿', icon: '⛏', desc: '寻找矿点 + 持续点击', ready: false },
  { type: 'catch-pet', name: '捕捉宠物', icon: '🐾', desc: '识别 + 捕捉技能循环', ready: false },
  { type: 'refine', name: '装备炼化', icon: '⚒', desc: '炼化界面操作', ready: false },
  { type: 'reputation', name: '名誉任务', icon: '🏆', desc: '接取/交付 NPC 任务', ready: false },
  // 配置型"任务":可存储/编辑/被 farm 的「城市事件」引用,但不可作为任务运行(保存后不启动 worker)
  {
    type: 'town-profile',
    name: '城镇档案',
    icon: '🏙',
    desc: '复活点 / 回城检查项 / 商人 NPC / 出城口 + 寻路路线(供「城市事件」用)',
    ready: true,
  },
  { type: 'dialog-recipe', name: '对话配方', icon: '💬', desc: '与某类 NPC 对话的步骤脚本(修理 / 买药;供「城市事件」用)', ready: true },
  {
    type: 'map-profile',
    name: '过图路线',
    icon: '🗺',
    desc: '中间地图的入口/出口 + 途经点(供挂机打怪的「地图跨越」逐跳穿越)',
    ready: true,
  },
  // 辅助配置(执行配置):被挂机打怪的「辅助配置」勾选后,在挂机的触发点上真正执行
  {
    type: 'pet-training',
    name: '宠物带练',
    icon: '🐾',
    desc: '到触发点时开宠物栏、看当前宠物等级,达标就换下一只(供挂机打怪的「辅助配置」勾选)',
    ready: true,
  },
];

/** 配置型"任务"提示(城镇档案/对话配方/过图路线/宠物带练:保存在「选择任务」的对应卡片里,不进入历史任务,不会启动 worker) */
const CONFIG_ONLY_HINT =
  '这是一份"配置",保存在「选择任务」的对应卡片里 —— 供挂机打怪的「城市事件 / 地图跨越 / 辅助配置」引用,不会启动 worker';

/** footer 主操作按钮(实心 cyan,与历史任务列表里的「启动」一致) */
const PRIMARY_BTN_CLS =
  'rounded px-3 py-1.5 text-sm font-semibold transition-colors bg-accent-cyan text-bg-base hover:bg-accent-cyan/90 flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed';

/** 定点识别的怪名颜色可选值(取自 core/constant-ocr/color.ts;可多选) */
const MONSTER_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: COLOR_GREY_WHITE, label: '灰白色' },
  { value: COLOR_RED, label: '红色' },
  { value: COLOR_YELLOW, label: '黄色' },
  { value: COLOR_GREEN, label: '绿色' },
];

/**
 * 物品拾取的颜色可选值(物品品质色,可多选;取自 core/constant-ocr/color.ts)
 * ⚠️ 蓝/紫两个色值还是占位值,要在游戏里取色后替换(见 color.ts 里的 TODO)
 */
const PICKUP_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: COLOR_YELLOW_WHITE, label: '黄白色' },
  { value: COLOR_GREEN, label: '绿色' },
  { value: COLOR_BLUE, label: '蓝色' },
  { value: COLOR_YELLOW, label: '黄色' },
  { value: COLOR_PURPLE, label: '紫色' },
];

/**
 * 界面里的一条拾取规则:名称用逗号分隔的文本编辑
 * (和「找怪关键字」同一个输入方式 —— 直接编辑数组会让逗号在打字时被吃掉)
 */
interface PickupRuleUi {
  /** 这条规则的颜色(可多选) */
  colors: string[];
  /** 这条规则的物品名(逗号分隔文本;空 = 这个颜色的所有物品都要) */
  nameKeywords: string;
}

/**
 * 拾取配置在界面里的形态。
 * rules 之间是「或」:每条规则 = 颜色(可多选)+ 名称(可空),任一条命中就捡
 *   例:所有紫色装备 + 蓝色里只要无极剑 = [{紫, 名称空}, {蓝, "无极剑"}]
 */
interface PickupUiState {
  enabled: boolean;
  rangeMode: 'default' | 'custom';
  range: ScreenRect;
  rules: PickupRuleUi[];
  clickOffset: { x: number; y: number };
}

/** 新建任务时的拾取默认值:不开启,给一条空规则让用户看清"规则"长什么样 */
const DEFAULT_PICKUP: PickupUiState = {
  enabled: false,
  rangeMode: 'default',
  range: { x: 0, y: 0, w: 0, h: 0 },
  rules: [{ colors: [], nameKeywords: '' }],
  clickOffset: { x: 0, y: 0 },
};

/** 新建城镇档案的默认值(空的,让用户自己加 NPC/出口 —— 至少 1 个 NPC 或 1 个出城口才能保存) */
const DEFAULT_TOWN_PROFILE: TownProfileConfig = {
  type: 'town-profile',
  mapName: '',
  revivePoint: { x: 0, y: 0 },
  // 回城检查项:缺省不检查(没触发就不去访问商人 NPC,直接去出城口;也不检查/创建队伍)
  checkDurability: false,
  createTeam: false,
  npcs: [],
  routes: [],
  exits: [],
  transitFrom: [],
};

/** 新建对话配方的默认值(配方是纯步骤脚本,由城镇档案里的 NPC 按名字引用) */
const DEFAULT_DIALOG_RECIPE: DialogRecipeConfig = {
  type: 'dialog-recipe',
  steps: [],
};

/** 新建过图路线的默认值(空的,让用户自己填;保存时至少要有本图地图名与两个口子的 toMap) */
const DEFAULT_MAP_PROFILE: MapProfileConfig = {
  type: 'map-profile',
  mapName: '',
  entrance: { position: { x: 0, y: 0 }, toMap: '' },
  exit: { position: { x: 0, y: 0 }, toMap: '' },
  waypoints: [],
};

/**
 * 新建宠物带练的默认值:触发点先选中「进入第一个挂机点时」(最常用),带 1 只、目标 30 级
 * (等级/技能至少填一个才能保存,见 validateConfig)
 */
const DEFAULT_PET_TRAINING: PetTrainingConfig = {
  type: 'pet-training',
  triggers: ['firstFarmSpot'],
  petCount: 1,
  targetLevel: 30,
  targetSkill: '',
};

/**
 * 回填拾取规则:
 *   新配置读 rules;旧配置(扁平的 colors + nameKeywords)当成一条规则(升级兼容)
 *   一条都没有 = 给一条空规则,方便直接开始填
 */
function toPickupRulesUi(pickup?: FarmPickupConfig): PickupRuleUi[] {
  const raw = pickup?.rules && pickup.rules.length > 0 ? pickup.rules : [{ colors: pickup?.colors, nameKeywords: pickup?.nameKeywords }];
  const rules = raw.map((r) => ({
    colors: (r?.colors ?? []).map((c) => String(c ?? '').trim()).filter(Boolean),
    nameKeywords: (r?.nameKeywords ?? []).join(','),
  }));
  return rules.length > 0 ? rules : [{ colors: [], nameKeywords: '' }];
}

/**
 * 回填怪名颜色:优先读多选的 nameColors;
 * 旧配置只有单值 nameColor,当成"只选了一个"处理;都没有 = 默认白色
 */
function resolveNameColors(mobFilter?: FarmTaskConfig['mobFilter']): string[] {
  const colors = (mobFilter?.nameColors ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
  if (colors.length > 0) return colors;
  const legacy = mobFilter?.nameColor?.trim();
  return legacy ? [legacy] : [COLOR_WHITE];
}

/** 把 worker.status 映射成短标签(右上角状态徽章) */
function statusLabel(status?: string): string {
  switch (status) {
    case 'idle':
      return '待启动';
    case 'moving':
      return '移动中';
    case 'combat':
      return '战斗中';
    case 'resupply':
      return '回城中';
    case 'paused':
      return '已暂停';
    case 'alert':
      return '异常';
    default:
      return status || '未知';
  }
}
function statusBg(status?: string): string {
  switch (status) {
    case 'idle':
      return 'bg-accent-cyan/20 text-accent-cyan';
    case 'moving':
      return 'bg-yellow-500/20 text-yellow-500';
    case 'combat':
      return 'bg-red-500/20 text-red-500';
    case 'resupply':
      return 'bg-blue-500/20 text-blue-500';
    case 'paused':
      return 'bg-gray-500/20 text-gray-400';
    case 'alert':
      return 'bg-orange-500/20 text-orange-500';
    default:
      return 'bg-text-muted/20 text-text-muted';
  }
}
function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}分${Math.floor((ms % 60_000) / 1000)}秒`;
  return `${Math.floor(ms / 3_600_000)}小时${Math.floor((ms % 3_600_000) / 60_000)}分`;
}

interface Props {
  hwnd: number;
  initialConfig?: TaskConfig | null;
  /**
   * 初始正在编辑的历史任务名(编辑态初值,之后由内部 editingName 状态接管)。
   * 设了之后 footer 走"保存 / 保存并启动 / 另存为…"矩阵,缺省(新建)走"存为记忆 + 仅本次运行"。
   */
  initialTaskName?: string;
  /** 当前窗口的实时截图(bootstrap 阶段推送) */
  thumbnail?: string | null;
  /** 当前 worker 状态(可空:从未启动过) */
  workerState?: {
    status?: string;
    statusDetail?: string;
    startedAt?: number | null;
    stats?: { killCount?: number; deathCount?: number; uptimeMs?: number };
    character?: { name?: string; class?: string; level?: number } | null;
  } | null;
  /** true = 只读模式(运行时查看):所有控件禁用,只显示关闭按钮 */
  readOnly?: boolean;
  onClose: () => void;
  /**
   * 保存按钮:持久化到磁盘(返回 Promise,失败时 dialog 保持打开)
   * opts.existing=true → 覆盖保存这条同名历史任务(否则新建,重名拒绝)
   * opts.start=false   → 只保存不启动 worker(缺省/true = 保存后启动)
   * 不传 opts 时保持旧语义(新建 + 启动),name 步骤的"确认保存"走的就是这条
   */
  onSaved: (
    config: TaskConfig,
    name: string,
    opts?: { existing?: boolean; start?: boolean },
  ) => Promise<{ ok: boolean; error?: string }> | void;
  /** "仅本次运行"按钮:仅写内存,关闭 app 丢(不传 = 隐藏按钮,如只读模式) */
  onConfirm?: (config: TaskConfig) => void;
  /** 可选:透传给内嵌「从历史任务中选择」列表的「启动」按钮(这条历史任务直接应用并启动) */
  onStartStored?: (stored: StoredTaskConfig) => void;
}

export function TaskConfigDialog({
  hwnd,
  initialConfig,
  initialTaskName,
  thumbnail,
  workerState,
  readOnly = false,
  onClose,
  onSaved,
  onConfirm,
  onStartStored,
}: Props) {
  const [step, setStep] = useState<'select' | 'config' | 'name'>(initialConfig ? 'config' : 'select');
  const [taskName, setTaskName] = useState(initialTaskName ?? '');
  /**
   * 正在编辑的历史任务名:
   * - 初值 = initialTaskName(历史任务弹框的「编辑」子对话框)
   * - 「从历史任务中选择 → 载入到编辑器」时由 handleHistoryApply 设成该条任务名
   * - 非空 → footer 走"保存(覆盖)/ 保存并启动 / 另存为…";空 → 新建(命名 + 存为记忆)
   */
  const [editingName, setEditingName] = useState<string | null>(initialTaskName ?? null);
  const [nameError, setNameError] = useState<string | null>(null);
  // config 步骤直接保存(编辑模式)的错误显示 — name 步骤走的是 nameError,这里独立
  const [saveError, setSaveError] = useState<string | null>(null);
  // 编辑模式直接保存时的 loading,防用户连点
  const [saving, setSaving] = useState(false);
  // 配置型任务(城镇档案/对话配方)删除时的 loading,防连点
  const [deleting, setDeleting] = useState(false);
  const [taskType, setTaskType] = useState<TaskType | null>(initialConfig?.type ?? null);
  // 内嵌"历史任务"弹窗(只读模式下不显示入口)
  const [historyOpen, setHistoryOpen] = useState(false);
  // 历史任务列表(全局,store.taskHistory)
  const taskHistory = useStore((s) => s.taskHistory);
  const deleteTaskByName = useStore((s) => s.deleteTaskByName);
  /** 城市事件可选的城镇档案名(历史任务里所有 town-profile,按 name 存/取) */
  const townProfileNames = taskHistory.filter((h) => h.config.type === 'town-profile').map((h) => h.name);
  /** 全部对话配方名(城镇档案里的 NPC 用它指名要执行的配方) */
  const recipeNames = taskHistory.filter((h) => h.config.type === 'dialog-recipe').map((h) => h.name);
  /** 已保存的城镇档案 / 对话配方(配置型任务在各自卡片里管理,不进历史任务) */
  const savedTownProfiles = taskHistory.filter((h) => h.config.type === 'town-profile');
  const savedDialogRecipes = taskHistory.filter((h) => h.config.type === 'dialog-recipe');
  /** 地图跨越可选的过图路线名(历史任务里所有 map-profile,按 name 存/取) */
  const mapProfileNames = taskHistory.filter((h) => h.config.type === 'map-profile').map((h) => h.name);
  const savedMapProfiles = taskHistory.filter((h) => h.config.type === 'map-profile');
  /** 挂机打怪可勾选的辅助配置(历史任务里所有辅助配置型任务;显示名 + 它自己的触发点摘要) */
  const savedFarmAux = taskHistory.filter((h) => h.config.type === 'pet-training');
  const farmAuxOptions = savedFarmAux.map((h) => {
    const c = h.config as PetTrainingConfig;
    const triggers = (c.triggers ?? []).map((t) => FARM_AUX_TRIGGERS.find((o) => o.id === t)?.label ?? t);
    return {
      name: h.name,
      desc: `宠物带练(带 ${c.petCount ?? 0} 只${c.targetLevel ? `;目标 ${c.targetLevel} 级` : ''})${
        triggers.length > 0 ? ` · ${triggers.join(' / ')}` : ' · ⚠ 没选触发点'
      }`,
    };
  });
  /** 已保存的宠物带练(辅助配置在自己的卡片里管理,不进历史任务) */
  const savedPetTrainings = savedFarmAux;
  /** 历史任务里可运行的任务条数(配置型任务不进历史任务) */
  const runnableHistoryCount = taskHistory.filter((h) => !isConfigOnlyTaskType(h.config.type)).length;

  // 挂机打怪配置
  const [mapId, setMapId] = useState('long-cheng');
  const [customMapName, setCustomMapName] = useState('');
  const [mode, setMode] = useState<FarmMode>('fixed');
  // 施法方式:智能施法(默认)= 到挂机点自动选一个可释放技能;自定义 = 按路径点绑定技能释放
  const [castMode, setCastMode] = useState<FarmCastMode>('smart');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  // 找怪关键字:定点识别下留空 = 纯 OCR(范围内任意文字都算怪名),不强制默认值
  const [nameKeywords, setNameKeywords] = useState('');
  // 找怪相关:怪名颜色(多选) / 定点识别的 OCR 范围与点击偏移 / 任务级技能列表 / 走位点击间隔
  const [mobNameColors, setMobNameColors] = useState<string[]>([COLOR_GREY_WHITE]);
  const [ocrRange, setOcrRange] = useState<ScreenRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [clickOffset, setClickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [skills, setSkills] = useState<FarmSkillConfig[]>([]);
  const [moveStepIntervalMs, setMoveStepIntervalMs] = useState(400);
  // 挂机循环节奏:挂机点停留时间(定点识别;0 = 不配 = 内置 2000ms) / 路径点卡住是否跳过(缺省跳过)
  const [spotIdleMs, setSpotIdleMs] = useState(2000);
  const [skipStuckWaypoint, setSkipStuckWaypoint] = useState(true);
  // 看门狗:组队申请 / 神医验证码 / 生命回复 / 角色停级;全空 = worker 不启动看门狗
  const [watchdog, setWatchdog] = useState<FarmWatchdogConfig>(DEFAULT_WATCHDOG);
  // 物品拾取:打怪间隙捡掉落物(范围/颜色/名称;关掉 = worker 不产生任何扫描开销)
  const [pickup, setPickup] = useState<PickupUiState>(DEFAULT_PICKUP);
  // 城市事件(farm 专属):引用已保存的城镇档案 + 全部对话配方(启动时解析成 auxConfigs)
  const [resupply, setResupply] = useState<FarmResupplyConfig>({ ...DEFAULT_RESUPPLY });
  // 地图跨越(farm 专属):出发图 → 挂机图之间依次穿越的中间地图名(引用 map-profile 任务)
  const [mapCrossings, setMapCrossings] = useState<string[]>([]);
  // 辅助配置(farm 专属):勾选要启用的辅助配置(引用 pet-training 这类任务名,顺序 = 执行顺序)
  const [auxConfigNames, setAuxConfigNames] = useState<string[]>([]);
  // 宠物技能:回到城里上骑、到挂机点下骑;到达挂机点打怪前再按需开启宠物技能(都从「宠物技能」里选)
  const [petRide, setPetRide] = useState<FarmPetRideConfig>({ ...DEFAULT_PET_RIDE });
  // 回城卷轴:起点在野外/任意地图时先按它回主城(见 worker 的 returnViaScroll)
  const [returnScroll, setReturnScroll] = useState<FarmReturnScrollConfig>({ ...DEFAULT_RETURN_SCROLL });
  // 条件回城:完成 N 圈后结束本轮打怪 → 回城处理 → 回挂机图继续下一轮(整个任务不结束)
  const [endReturn, setEndReturn] = useState<FarmEndReturnConfig>({ ...DEFAULT_END_RETURN });
  // 进入新地图时屏蔽所有人(worker 检测到换图就按 F11×4,见 shared/game-hotkeys.ts)
  const [blockAllPlayersOnNewMap, setBlockAllPlayersOnNewMap] = useState(false);
  // 启动时的一次性环境处理(默认开启;见 shared/types.ts 的 zoomOutMinimap / closeChatBackground)
  const [zoomOutMinimap, setZoomOutMinimap] = useState(true);
  const [closeChatBackground, setCloseChatBackground] = useState(true);
  const [note, setNote] = useState('');

  // 城镇档案 / 对话配方(配置型"任务":只存储/编辑,保存后不启动 worker)
  const [townProfile, setTownProfile] = useState<TownProfileConfig>(DEFAULT_TOWN_PROFILE);
  // 当前 farm 选中的城镇档案里,NPC 引用的配方不存在的问题(只提示,不阻断保存;启动时 resolveAuxConfigs 还会再拦一次)。
  // 注:档案里一个配方都没配是允许的 —— 没商人可找就直接去出城口返程,不再当成问题提示
  const selectedTown = savedTownProfiles.find((p) => p.name === String(resupply.townProfileName ?? '').trim());
  const missingRecipes = [
    ...new Set(
      ((selectedTown?.config as TownProfileConfig | undefined)?.npcs ?? [])
        .map((n) => (n.recipeName ?? '').trim())
        .filter((x) => x && !recipeNames.includes(x)),
    ),
  ];
  const recipeIssue = missingRecipes.length > 0 ? `NPC 引用的对话配方不存在:${missingRecipes.join('、')}` : null;
  // 条件回城的「使用回城卷轴」方式复用「回城卷轴」里配的物品技能:没配好时先在界面上提示(保存时另有一条硬校验)
  const returnScrollIssue =
    endReturn.enabled === true &&
    (endReturn.method ?? 'scroll') !== 'relogin' &&
    !skills.some((s) => s.id === returnScroll.skillId && s.method === 'item')
      ? '「回城卷轴」里没有选好回城物品技能'
      : null;
  const [dialogRecipe, setDialogRecipe] = useState<DialogRecipeConfig>(DEFAULT_DIALOG_RECIPE);
  // 过图路线(配置型"任务":只存储/编辑,保存后不启动 worker)
  const [mapProfile, setMapProfile] = useState<MapProfileConfig>(DEFAULT_MAP_PROFILE);
  // 辅助配置(配置型"任务":只存储/编辑,由挂机打怪勾选后在挂机流程里执行)
  const [petTraining, setPetTraining] = useState<PetTrainingConfig>(DEFAULT_PET_TRAINING);

  // 缺省技能配置
  const [skillSteps, setSkillSteps] = useState<DefaultSkillStep[]>([]);
  const [skillLoopCount, setSkillLoopCount] = useState(0); // 0 = 无限
  const [skillLoopIntervalMs, setSkillLoopIntervalMs] = useState(1000);
  const [skillNote, setSkillNote] = useState('');

  // ---- 配置型任务(城镇档案/对话配方)的卡片内管理:新建 / 载入 / 删除 ----

  /** 重置为「新建城镇档案」 */
  const newTownProfile = () => {
    setTownProfile(DEFAULT_TOWN_PROFILE);
    setEditingName(null);
    setSaveError(null);
  };
  /** 重置为「新建对话配方」 */
  const newDialogRecipe = () => {
    setDialogRecipe(DEFAULT_DIALOG_RECIPE);
    setEditingName(null);
    setSaveError(null);
  };
  /** 把一条已保存的城镇档案载入表单(编辑态,保存时覆盖它) */
  const loadTownProfile = (stored: StoredTaskConfig) => {
    const town = stored.config as TownProfileConfig;
    setTownProfile({
      type: 'town-profile',
      mapName: town.mapName ?? '',
      revivePoint: town.revivePoint ?? { x: 0, y: 0 },
      // 回城检查项:旧档案没有这两个字段 → undefined(启动时 worker 回退旧 farm 配置)
      checkDurability: town.checkDurability,
      potionThreshold: town.potionThreshold,
      // 创建队伍也是回城检查项:旧档案没有该字段 → undefined(worker 按"不检查"处理)
      createTeam: town.createTeam,
      npcs: town.npcs ?? [],
      routes: town.routes ?? [],
      exits: town.exits ?? [],
      transitFrom: town.transitFrom ?? [],
    });
    setEditingName(stored.name);
    setSaveError(null);
  };
  /** 把一条已保存的对话配方载入表单(编辑态,保存时覆盖它) */
  const loadDialogRecipe = (stored: StoredTaskConfig) => {
    const recipe = stored.config as DialogRecipeConfig;
    setDialogRecipe({ type: 'dialog-recipe', steps: recipe.steps ?? [] });
    setEditingName(stored.name);
    setSaveError(null);
  };
  /** 删除当前正在编辑的城镇档案(带 farm 引用提示) */
  const deleteSelectedTownProfile = async () => {
    const stored = savedTownProfiles.find((p) => p.name === editingName);
    if (!stored || deleting) return;
    const refs = referencedByFarmTasks(stored, taskHistory);
    if (refs.length > 0) {
      const ok = confirm(
        `任务 ${refs.map((n) => `「${n}」`).join('、')} 的回城补给引用了「${stored.name}」,\n删除后这些任务会启动失败。\n\n确定删除?`,
      );
      if (!ok) return;
    }
    setDeleting(true);
    const res = await deleteTaskByName(stored.name);
    setDeleting(false);
    if (res.ok) newTownProfile();
    else alert(`删除失败: ${res.error || '未知错误'}`);
  };
  /** 删除当前正在编辑的对话配方(带 farm 引用提示) */
  const deleteSelectedDialogRecipe = async () => {
    const stored = savedDialogRecipes.find((p) => p.name === editingName);
    if (!stored || deleting) return;
    const refs = referencedByFarmTasks(stored, taskHistory);
    if (refs.length > 0) {
      const ok = confirm(
        `任务 ${refs.map((n) => `「${n}」`).join('、')} 的回城补给引用了「${stored.name}」,\n删除后这些任务会启动失败。\n\n确定删除?`,
      );
      if (!ok) return;
    }
    setDeleting(true);
    const res = await deleteTaskByName(stored.name);
    setDeleting(false);
    if (res.ok) newDialogRecipe();
    else alert(`删除失败: ${res.error || '未知错误'}`);
  };
  /** 重置为「新建过图路线」 */
  const newMapProfile = () => {
    setMapProfile(DEFAULT_MAP_PROFILE);
    setEditingName(null);
    setSaveError(null);
  };
  /** 把一条已保存的过图路线载入表单(编辑态,保存时覆盖它) */
  const loadMapProfile = (stored: StoredTaskConfig) => {
    const map = stored.config as MapProfileConfig;
    setMapProfile({
      type: 'map-profile',
      mapName: map.mapName ?? '',
      entrance: {
        position: { x: map.entrance?.position?.x ?? 0, y: map.entrance?.position?.y ?? 0 },
        toMap: map.entrance?.toMap ?? '',
      },
      exit: {
        position: { x: map.exit?.position?.x ?? 0, y: map.exit?.position?.y ?? 0 },
        toMap: map.exit?.toMap ?? '',
      },
      waypoints: map.waypoints ?? [],
    });
    setEditingName(stored.name);
    setSaveError(null);
  };
  /** 删除当前正在编辑的过图路线(带 farm 引用提示) */
  const deleteSelectedMapProfile = async () => {
    const stored = savedMapProfiles.find((p) => p.name === editingName);
    if (!stored || deleting) return;
    const refs = referencedByFarmTasks(stored, taskHistory);
    if (refs.length > 0) {
      const ok = confirm(
        `任务 ${refs.map((n) => `「${n}」`).join('、')} 的「地图跨越」引用了「${stored.name}」,\n删除后这些任务会启动失败。\n\n确定删除?`,
      );
      if (!ok) return;
    }
    setDeleting(true);
    const res = await deleteTaskByName(stored.name);
    setDeleting(false);
    if (res.ok) newMapProfile();
    else alert(`删除失败: ${res.error || '未知错误'}`);
  };
  /** 重置为「新建辅助配置(宠物带练)」 */
  const newPetTraining = () => {
    setPetTraining(DEFAULT_PET_TRAINING);
    setEditingName(null);
    setSaveError(null);
  };
  /** 把一条已保存的辅助配置载入表单(编辑态,保存时覆盖它) */
  const loadPetTraining = (stored: StoredTaskConfig) => {
    const pet = stored.config as PetTrainingConfig;
    setPetTraining({
      type: 'pet-training',
      triggers: pet.triggers ?? [],
      petCount: pet.petCount ?? 1,
      targetLevel: pet.targetLevel ?? 0,
      targetSkill: pet.targetSkill ?? '',
      note: pet.note,
    });
    setEditingName(stored.name);
    setSaveError(null);
  };
  /** 删除当前正在编辑的辅助配置(带 farm 引用提示) */
  const deleteSelectedPetTraining = async () => {
    const stored = savedPetTrainings.find((p) => p.name === editingName);
    if (!stored || deleting) return;
    const refs = referencedByFarmTasks(stored, taskHistory);
    if (refs.length > 0) {
      const ok = confirm(
        `任务 ${refs.map((n) => `「${n}」`).join('、')} 的「辅助配置」勾选了「${stored.name}」,\n删除后这些任务会启动失败。\n\n确定删除?`,
      );
      if (!ok) return;
    }
    setDeleting(true);
    const res = await deleteTaskByName(stored.name);
    setDeleting(false);
    if (res.ok) newPetTraining();
    else alert(`删除失败: ${res.error || '未知错误'}`);
  };
  /** 选择任务类型卡片:配置型任务先重置表单(卡片内新建),其余直接进 config 步骤 */
  const selectTaskType = (type: TaskType) => {
    if (type === 'town-profile') newTownProfile();
    else if (type === 'dialog-recipe') newDialogRecipe();
    else if (type === 'map-profile') newMapProfile();
    else if (type === 'pet-training') newPetTraining();
    setTaskType(type);
    setSaveError(null);
    setStep('config');
  };

  /**
   * 统一的"把 cfg 灌进 dialog state"函数,用于:
   * - 1) 编辑历史任务(initialConfig 回填,组件 mount 后立即跑一次)
   * - 2) 选历史任务(handleHistoryApply,用户在 step 1 选了某条历史任务)
   *
   * 修复:
   * - 之前在 useState init 里写 setState 副作用是反 React 模式(Strict Mode 双调用会重复执行)
   * - 现在 useState 用纯默认值,这个函数在合适时机显式调一次
   */
  const applyConfig = (cfg: TaskConfig) => {
    if (cfg.type === 'farm') {
      const farm = cfg as FarmTaskConfig;
      setMapId(farm.mapId);
      setCustomMapName(farm.customMapName || '');
      // 兼容旧配置:旧模式(single/patrol/aoe)统一迁到「定点打怪」;fixed-detect / move-detect 原样保留
      const legacyModeMap: Record<string, FarmMode> = {
        single: 'fixed',
        patrol: 'fixed',
        aoe: 'fixed',
      };
      setMode(legacyModeMap[farm.mode] ?? farm.mode ?? 'fixed');
      // 旧配置没有 castMode 字段,按默认的智能施法处理
      setCastMode(farm.castMode ?? 'smart');
      setWaypoints(farm.waypoints || []);
      setNameKeywords(farm.mobFilter?.nameKeywords?.join(',') || '');
      setMobNameColors(resolveNameColors(farm.mobFilter));
      setOcrRange(farm.mobFilter?.ocrRange ?? { x: 0, y: 0, w: 0, h: 0 });
      setClickOffset(farm.mobFilter?.clickOffset ?? { x: 0, y: 0 });
      // 旧技能没有施法方式/吟唱/距离字段,按旧行为(target + 400ms 吟唱 + 不限距离)补默认值
      // 第二页键位旧配置写成 SF*,回显时归一成 TF*
      setSkills(
        (farm.skills || []).map((s) => ({
          ...s,
          key: normalizeSkillKey(s.key),
          name: s.name || '',
          method: s.method ?? 'target',
          castMs: s.castMs ?? 400,
          rangePx: s.rangePx ?? 0,
        })),
      );
      // 旧配置的字段名是 movementSpeed,读不到新字段时兜底
      setMoveStepIntervalMs(farm.moveStepIntervalMs ?? farm.movementSpeed ?? 800);
      // 旧配置没有这两项:停留时间按内置 2000ms、路径点卡住按"跳过"
      setSpotIdleMs(farm.spotIdleMs ?? 2000);
      setSkipStuckWaypoint(farm.skipStuckWaypoint !== false);
      // 旧配置没有 watchdog 字段:按「只开验证码」回显,与 worker 的兼容行为一致
      setWatchdog(farm.watchdog ?? DEFAULT_WATCHDOG);
      // 旧配置没有 pickup 字段:回显成"不开启"
      setPickup({
        enabled: farm.pickup?.enabled === true,
        rangeMode: farm.pickup?.rangeMode === 'custom' ? 'custom' : 'default',
        range: farm.pickup?.range ?? { x: 0, y: 0, w: 0, h: 0 },
        rules: toPickupRulesUi(farm.pickup),
        clickOffset: farm.pickup?.clickOffset ?? { x: 0, y: 0 },
      });
      // 旧配置没有 resupply 字段:回显成"不开启"
      setResupply(normalizeResupply(farm.resupply));
      // 旧配置没有 mapCrossings 字段:回显成"不跨图"
      setMapCrossings(farm.mapCrossings ?? []);
      // 旧配置没有 auxConfigNames 字段:回显成"没勾任何辅助配置"
      setAuxConfigNames(farm.auxConfigNames ?? []);
      // 旧配置没有 petRide 字段:回显成"不开启"
      setPetRide(normalizePetRide(farm.petRide));
      // 旧配置没有 returnScroll 字段:回显成"不开启"
      setReturnScroll(normalizeReturnScroll(farm.returnScroll));
      // 旧配置没有 endReturn 字段:回显成"不开启"
      setEndReturn(normalizeEndReturn(farm.endReturn));
      // 旧配置没有这个字段:回显成"不开启"
      setBlockAllPlayersOnNewMap(farm.blockAllPlayersOnNewMap === true);
      // 旧配置没有这两个字段:缺省 = 开启
      setZoomOutMinimap(farm.zoomOutMinimap !== false);
      setCloseChatBackground(farm.closeChatBackground !== false);
      setNote(farm.note || '');
    } else if (cfg.type === 'default-skill') {
      const skill = cfg as DefaultSkillTaskConfig;
      setSkillSteps(skill.steps || []);
      setSkillLoopCount(skill.loopCount ?? 0);
      setSkillLoopIntervalMs(skill.loopIntervalMs ?? 1000);
      setSkillNote(skill.note || '');
    } else if (cfg.type === 'town-profile') {
      const town = cfg as TownProfileConfig;
      setTownProfile({
        type: 'town-profile',
        mapName: town.mapName ?? '',
        revivePoint: town.revivePoint ?? { x: 0, y: 0 },
        // 回城检查项:旧档案没有这两个字段 → undefined(启动时 worker 回退旧 farm 配置)
        checkDurability: town.checkDurability,
        potionThreshold: town.potionThreshold,
        // 创建队伍也是回城检查项:旧档案没有该字段 → undefined(worker 按"不检查"处理)
        createTeam: town.createTeam,
        npcs: town.npcs ?? [],
        routes: town.routes ?? [],
        exits: town.exits ?? [],
        transitFrom: town.transitFrom ?? [],
      });
    } else if (cfg.type === 'dialog-recipe') {
      const recipe = cfg as DialogRecipeConfig;
      setDialogRecipe({ type: 'dialog-recipe', steps: recipe.steps ?? [] });
    } else if (cfg.type === 'map-profile') {
      const map = cfg as MapProfileConfig;
      setMapProfile({
        type: 'map-profile',
        mapName: map.mapName ?? '',
        entrance: map.entrance ?? { position: { x: 0, y: 0 }, toMap: '' },
        exit: map.exit ?? { position: { x: 0, y: 0 }, toMap: '' },
        waypoints: map.waypoints ?? [],
      });
    } else if (cfg.type === 'pet-training') {
      const pet = cfg as PetTrainingConfig;
      setPetTraining({
        type: 'pet-training',
        triggers: pet.triggers ?? [],
        petCount: pet.petCount ?? 1,
        targetLevel: pet.targetLevel ?? 0,
        targetSkill: pet.targetSkill ?? '',
        note: pet.note,
      });
    }
  };

  // 初始化:initialConfig 回填(只跑一次,组件 mount 后)
  // 用 useEffect 而非 useState init 副作用 — 避免 React Strict Mode 双调用导致的重复 setState
  useEffect(() => {
    if (initialConfig) applyConfig(initialConfig);
  }, []); // 仅 mount 时跑一次 — dialog 不会在生命周期内换 initialConfig

  const addWaypoint = () => {
    setWaypoints((ws) => [
      ...ws,
      {
        id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: 0,
        y: 0,
        type: 'farm-spot',
      },
    ]);
  };

  const removeWaypoint = (id: string) => {
    setWaypoints((ws) => ws.filter((w) => w.id !== id));
  };

  const moveWaypoint = (id: string, dir: -1 | 1) => {
    setWaypoints((ws) => {
      const idx = ws.findIndex((w) => w.id === id);
      if (idx < 0) return ws;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= ws.length) return ws;
      const next = [...ws];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const updateWaypoint = (id: string, field: keyof Waypoint, value: any) => {
    setWaypoints((ws) => ws.map((w) => (w.id === id ? { ...w, [field]: value } : w)));
  };

  /** 构造当前选中的 cfg(供保存/确认共用) */
  const buildConfig = (): TaskConfig => {
    if (taskType === 'farm') {
      return {
        type: 'farm',
        mapId,
        customMapName: mapId === 'custom' ? customMapName : undefined,
        mode,
        castMode,
        waypoints,
        mobFilter: {
          nameKeywords: nameKeywords
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          nameColors: mobNameColors.length > 0 ? mobNameColors : undefined,
          // OCR 范围:x/y 允许为 0,w/h 必须为正才有意义(全 0 = 不配,worker 回退整个画面)
          ocrRange:
            ocrRange.w > 0 && ocrRange.h > 0
              ? {
                  x: Math.max(0, ocrRange.x | 0),
                  y: Math.max(0, ocrRange.y | 0),
                  w: Math.max(0, ocrRange.w | 0),
                  h: Math.max(0, ocrRange.h | 0),
                }
              : undefined,
          clickOffset: clickOffset.x !== 0 || clickOffset.y !== 0 ? { x: clickOffset.x | 0, y: clickOffset.y | 0 } : undefined,
        },
        // 过滤掉未启用的技能 + 规范化数值,保存前清洗(同缺省技能的清洗思路)
        skills: skills
          .filter((s) => s.enabled !== false)
          .map((s) => ({
            id: s.id,
            key: s.key,
            name: s.name?.trim() || undefined,
            cooldownMs: Math.max(0, s.cooldownMs | 0),
            castMs: Math.max(0, s.castMs ?? 0),
            rangePx: Math.max(0, s.rangePx ?? 0),
            method: s.method ?? 'target',
            enabled: s.enabled !== false,
            note: s.note,
          })),
        // 走位点击间隔:每点一次地面后隔多久再读坐标纠偏(最小 100,worker 那边小于 100 也按内置默认走)
        moveStepIntervalMs: Math.max(100, moveStepIntervalMs | 0),
        // 挂机点停留时间:0 / 空 = 不配(worker 用内置 2000ms,与旧行为一致)
        spotIdleMs: spotIdleMs > 0 ? spotIdleMs | 0 : undefined,
        // 路径点卡住:缺省跳过 → 存 undefined(旧配置/不配都是跳过);勾了「不跳过」才显式存 false
        skipStuckWaypoint: skipStuckWaypoint ? undefined : false,
        // 看门狗只保存"已开启"的项;全关时是空对象(worker 据此不启动看门狗,不做额外轮询)
        watchdog: {
          ...(watchdog.teamInvite ? { teamInvite: { action: watchdog.teamInvite.action } } : {}),
          ...(watchdog.verifyCode ? { verifyCode: true } : {}),
          ...(watchdog.autoHeal
            ? {
                autoHeal: {
                  // 只保留仍然存在、仍启用且仍是「物品使用」的技能 id,避免留下失效引用
                  itemIds: (watchdog.autoHeal.itemIds || []).filter((id) =>
                    skills.some((s) => s.id === id && s.enabled !== false && s.method === 'item'),
                  ),
                },
              }
            : {}),
          ...(watchdog.stopLevelUp ? { stopLevelUp: true } : {}),
        },
        // 物品拾取:整份保存(开关关掉也留着范围/颜色/名称,下次打开不用重填)
        pickup: {
          enabled: !!pickup.enabled,
          rangeMode: pickup.rangeMode === 'custom' ? 'custom' : 'default',
          range:
            pickup.rangeMode === 'custom' && (pickup.range?.w ?? 0) > 0 && (pickup.range?.h ?? 0) > 0
              ? {
                  x: Math.max(0, pickup.range?.x ?? 0),
                  y: Math.max(0, pickup.range?.y ?? 0),
                  w: Math.max(0, pickup.range?.w ?? 0),
                  h: Math.max(0, pickup.range?.h ?? 0),
                }
              : undefined,
          // 规则:颜色 / 名称全空的那条丢掉(worker 也会丢,存下来的配置保持干净)
          rules: pickup.rules
            .map((r) => ({
              colors: r.colors,
              nameKeywords: r.nameKeywords
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }))
            .filter((r) => r.colors.length > 0 || r.nameKeywords.length > 0),
          clickOffset:
            (pickup.clickOffset?.x ?? 0) !== 0 || (pickup.clickOffset?.y ?? 0) !== 0
              ? { x: pickup.clickOffset?.x ?? 0, y: pickup.clickOffset?.y ?? 0 }
              : undefined,
        },
        // 回城补给:整份保存(没开启也留着引用与参数,下次勾上不用重填)
        resupply: normalizeResupply(resupply),
        // 地图跨越:只留非空的名字(空数组 = 不写,等价于不跨图)
        mapCrossings: mapCrossings.filter(Boolean).length > 0 ? mapCrossings.filter(Boolean) : undefined,
        // 辅助配置:只留非空的名字(空数组 = 不写,等价于没勾任何辅助配置)
        auxConfigNames: auxConfigNames.filter(Boolean).length > 0 ? auxConfigNames.filter(Boolean) : undefined,
        // 宠物技能:整份保存,上骑/下骑/打怪前技能只保留仍然存在且仍是「宠物技能」的 id,避免失效引用
        petRide: {
          enabled: petRide.enabled === true,
          mountSkillId: isPetSkillId(skills, petRide.mountSkillId) ? petRide.mountSkillId : undefined,
          dismountSkillId: isPetSkillId(skills, petRide.dismountSkillId) ? petRide.dismountSkillId : undefined,
          preFarmSkillEnabled: petRide.preFarmSkillEnabled === true,
          preFarmSkillId: isPetSkillId(skills, petRide.preFarmSkillId) ? petRide.preFarmSkillId : undefined,
        },
        // 回城卷轴:整份保存(没开启也留着参数)
        returnScroll: normalizeReturnScroll(returnScroll),
        // 条件回城:整份保存(没开启也留着参数)
        endReturn: normalizeEndReturn(endReturn),
        // 进入新地图时屏蔽所有人:只在勾选时写入(缺省不写,等价于关闭)
        blockAllPlayersOnNewMap: blockAllPlayersOnNewMap || undefined,
        // 小地图缩放 / 关闭聊天背景:缺省开启,只在取消勾选时写入 false
        zoomOutMinimap: zoomOutMinimap ? undefined : false,
        closeChatBackground: closeChatBackground ? undefined : false,
        note: note || undefined,
      };
    }
    if (taskType === 'default-skill') {
      // 过滤掉未启用的步骤 + 清掉空 id,保存前规范化
      const cleaned: DefaultSkillStep[] = skillSteps
        .filter((s) => s.enabled !== false)
        .map((s) => ({
          id: s.id,
          key: s.key,
          intervalMs: Math.max(0, s.intervalMs | 0),
          holdMs: s.holdMs !== undefined ? Math.max(10, s.holdMs | 0) : undefined,
          enabled: s.enabled !== false,
          note: s.note,
        }));
      return {
        type: 'default-skill',
        steps: cleaned,
        loopCount: Math.max(0, skillLoopCount | 0),
        loopIntervalMs: Math.max(0, skillLoopIntervalMs | 0),
        note: skillNote || undefined,
      };
    }
    if (taskType === 'town-profile') {
      return {
        type: 'town-profile',
        mapName: townProfile.mapName.trim(),
        revivePoint: { x: (townProfile.revivePoint?.x ?? 0) | 0, y: (townProfile.revivePoint?.y ?? 0) | 0 },
        // 回城检查项:显式写布尔(勾了 true / 没勾 false),迁移期 worker 就不会再回退到旧 farm 配置
        checkDurability: townProfile.checkDurability === true,
        potionThreshold:
          typeof townProfile.potionThreshold === 'number' && townProfile.potionThreshold > 0
            ? Math.round(townProfile.potionThreshold)
            : undefined,
        // 创建队伍:同样显式写布尔(勾了 true / 没勾 false)
        createTeam: townProfile.createTeam === true,
        // id / 名字全空的记录丢掉(留着只会让 worker 白走一趟);recipeName 空 = 只当路线锚点,不会被访问
        npcs: townProfile.npcs
          .filter((n) => (n.id ?? '').trim() || (n.name ?? '').trim())
          .map((n) => ({
            id: (n.id ?? '').trim(),
            name: normalizeNpcName(n.name) || NPC.ITEM_MERCHANT,
            position: { x: (n.position?.x ?? 0) | 0, y: (n.position?.y ?? 0) | 0 },
            recipeName: (n.recipeName ?? '').trim() || undefined,
          })),
        // 起点/终点没填的路线丢掉(worker 的 resolveRoute 按 from/to 精确匹配,空值永远不会命中)
        routes: townProfile.routes
          .filter((r) => (r.from ?? '').trim() && (r.to ?? '').trim())
          .map((r) => ({
            id: r.id,
            from: r.from.trim(),
            to: r.to.trim(),
            waypoints: (r.waypoints ?? []).map((w) => ({ x: (w.x ?? 0) | 0, y: (w.y ?? 0) | 0 })),
          })),
        exits: townProfile.exits
          .filter((e) => (e.id ?? '').trim() || (e.toMap ?? '').trim())
          .map((e) => ({
            id: (e.id ?? '').trim(),
            toMap: (e.toMap ?? '').trim(),
            position: { x: (e.position?.x ?? 0) | 0, y: (e.position?.y ?? 0) | 0 },
            // 离城方式:walk 不写(缺省);npc 要带上 NPC 名与对话配方,否则 worker 只能当"走过去"处理
            via: e.via === 'npc' ? ('npc' as const) : undefined,
            npcName: e.via === 'npc' ? normalizeNpcName(e.npcName) || undefined : undefined,
            recipeName: e.via === 'npc' ? (e.recipeName ?? '').trim() || undefined : undefined,
          })),
        // 其它主城中转:地图名/NPC 全空的记录丢掉(留着只会让 worker 白走一趟)
        transitFrom: (townProfile.transitFrom ?? [])
          .filter((t) => (t.mapName ?? '').trim() || (t.npcName ?? '').trim())
          .map((t) => ({
            id: (t.id ?? '').trim(),
            mapName: (t.mapName ?? '').trim(),
            npcName: normalizeNpcName(t.npcName) || NPC.AIRSHIP_FAIRY,
            position: { x: (t.position?.x ?? 0) | 0, y: (t.position?.y ?? 0) | 0 },
            recipeName: (t.recipeName ?? '').trim(),
            waypoints: (t.waypoints ?? []).map((w) => ({ x: (w.x ?? 0) | 0, y: (w.y ?? 0) | 0 })),
          })),
      };
    }
    if (taskType === 'dialog-recipe') {
      return {
        type: 'dialog-recipe',
        // 步骤原样保存(每步的字段由它的 kind 决定,界面已保证必填项存在)
        steps: dialogRecipe.steps,
      };
    }
    if (taskType === 'map-profile') {
      return {
        type: 'map-profile',
        mapName: mapProfile.mapName.trim(),
        entrance: {
          position: { x: (mapProfile.entrance?.position?.x ?? 0) | 0, y: (mapProfile.entrance?.position?.y ?? 0) | 0 },
          toMap: (mapProfile.entrance?.toMap ?? '').trim(),
        },
        exit: {
          position: { x: (mapProfile.exit?.position?.x ?? 0) | 0, y: (mapProfile.exit?.position?.y ?? 0) | 0 },
          toMap: (mapProfile.exit?.toMap ?? '').trim(),
        },
        waypoints: (mapProfile.waypoints ?? []).map((w) => ({
          x: (w.x ?? 0) | 0,
          y: (w.y ?? 0) | 0,
          npc: w.npc && (w.npc.name ?? '').trim() ? { name: w.npc.name.trim(), recipeName: (w.npc.recipeName ?? '').trim() } : undefined,
        })),
      };
    }
    if (taskType === 'pet-training') {
      // 只留认识的触发点 + 至少 1 只;目标等级/技能空 = 不写(worker 按"不用这个判据"处理)
      return {
        type: 'pet-training',
        triggers: (petTraining.triggers ?? []).filter((t) => FARM_AUX_TRIGGERS.some((o) => o.id === t)),
        petCount: Math.max(1, petTraining.petCount | 0),
        targetLevel: petTraining.targetLevel && petTraining.targetLevel > 0 ? Math.round(petTraining.targetLevel) : undefined,
        targetSkill: (petTraining.targetSkill ?? '').trim() || undefined,
        note: petTraining.note || undefined,
      };
    }
    return { type: taskType } as any;
  };

  /**
   * 保存/确认前的配置校验(返回 null = 通过)。
   * 两条保存路径都走它:「存为记忆」(新建,后面还要去 name 步骤)与「保存」(编辑,直接覆盖落盘)
   */
  const validateConfig = (): string | null => {
    if (taskType === 'farm' && resupply.enabled === true && !String(resupply.townProfileName ?? '').trim()) {
      return '已开启城市事件,但没有选择城镇档案(没有的话先建一份「城镇档案」并保存)';
    }
    if (taskType === 'farm' && petRide.enabled === true) {
      if (!isPetSkillId(skills, petRide.mountSkillId)) {
        return '已开启宠物骑乘,但没有选择有效的「上骑」宠物技能(先在「技能设置」里添加施法方式为「宠物技能」的技能)';
      }
      if (!isPetSkillId(skills, petRide.dismountSkillId)) {
        return '已开启宠物骑乘,但没有选择有效的「下骑」宠物技能';
      }
    }
    if (taskType === 'farm' && petRide.preFarmSkillEnabled === true && !isPetSkillId(skills, petRide.preFarmSkillId)) {
      return '已开启「打怪前开启宠物技能」,但没有选择有效的宠物技能(先在「技能设置」里添加施法方式为「宠物技能」的技能)';
    }
    if (taskType === 'farm' && returnScroll.enabled === true) {
      if (!skills.some((s) => s.id === returnScroll.skillId && s.method === 'item')) {
        return '已开启回城卷轴,但没有选择有效的「物品」技能(先在「技能设置」里添加施法方式为「物品」的技能)';
      }
      if (resupply.enabled !== true) {
        return '回城卷轴需要配合「回城补给」使用:请开启回城补给并选择出发城镇档案(出发城镇由它决定)';
      }
    }
    // 条件回城的「使用回城卷轴」方式复用「回城卷轴」里配的物品技能,没配就按不动
    if (taskType === 'farm' && endReturn.enabled === true && (endReturn.method ?? 'scroll') !== 'relogin') {
      if (!skills.some((s) => s.id === returnScroll.skillId && s.method === 'item')) {
        return '请先在「回城卷轴」里选好回城物品技能';
      }
    }
    // 条件回城:回城卷轴只会把人送进主城,回挂机图要靠城镇档案出城 —— 没配就拦在保存这一步
    if (taskType === 'farm' && endReturn.enabled === true) {
      if (resupply.enabled !== true || !(resupply.townProfileName ?? '').trim()) {
        return '开启「结束自动打怪并回城」需要先在「回城补给」里开启补给并选好城镇档案(回城后要按它走回挂机图)';
      }
    }
    if (taskType === 'town-profile') {
      const cfg = buildConfig();
      const npcs = cfg.type === 'town-profile' ? cfg.npcs : [];
      const exits = cfg.type === 'town-profile' ? (cfg.exits ?? []) : [];
      if (npcs.length === 0 && exits.length === 0) {
        return '城镇档案至少需要 1 个 NPC 或 1 个出城口';
      }
      if (npcs.length > 0 && !npcs.some((n) => (n.recipeName ?? '').trim()) && exits.length === 0) {
        return '城镇档案里至少要有一个 NPC 选了「配方」,或至少配一个出城口';
      }
    }
    if (taskType === 'dialog-recipe') {
      const cfg = buildConfig();
      if ((cfg.type === 'dialog-recipe' ? cfg.steps : []).length === 0) {
        return '对话配方至少需要 1 个步骤';
      }
    }
    if (taskType === 'map-profile') {
      const cfg = buildConfig();
      if (cfg.type === 'map-profile') {
        if (!cfg.mapName.trim()) return '过图路线需要填「本图地图名」(游戏内 OCR 读到的中文名)';
        if (!cfg.entrance.toMap.trim()) return '过图路线需要填「入口口子」通向的图名(返程要用)';
        if (!cfg.exit.toMap.trim()) return '过图路线需要填「出口口子」通向的图名(去下一张图)';
      }
      // NPC 途经点:名字与配方都必须选(看原始表单 —— buildConfig 会把没填名字的 npc 丢掉)
      for (const wp of mapProfile.waypoints ?? []) {
        if (!wp.npc) continue;
        if (!(wp.npc.name ?? '').trim()) return `途经点 (${wp.x},${wp.y}) 的 NPC 没选名字(或点「移除 NPC」当作普通途经点)`;
        if (!(wp.npc.recipeName ?? '').trim()) return `途经点 (${wp.x},${wp.y}) 配了 NPC「${wp.npc.name}」,请给它选一份对话配方`;
      }
    }
    if (taskType === 'pet-training') {
      const cfg = buildConfig();
      if (cfg.type === 'pet-training') {
        if (cfg.triggers.length === 0) return '宠物带练至少要选一个触发点(否则不会执行)';
        if (cfg.petCount <= 0) return '宠物带练要填「要带练的宠物数量」(至少 1 只)';
        if (!cfg.targetLevel && !cfg.targetSkill) return '宠物带练要填「目标等级」或「目标技能」其中之一(否则不知道什么时候换下一只)';
      }
    }
    // 挂机打怪:勾了辅助配置就判一下引用是否还在(启动时 resolveAuxConfigs 还会再拦一次)
    if (taskType === 'farm') {
      const unknownAux = auxConfigNames.filter(Boolean).filter((n) => !savedFarmAux.some((h) => h.name === n));
      if (unknownAux.length > 0) return `勾选的辅助配置不存在:${unknownAux.join('、')}(可能已删除,请重新勾选)`;
    }
    return null;
  };

  /**
   * config 步骤的保存按钮:
   * - 新建(editingName 空) → 跳到 name 步骤让用户起名字(Electron 不支持 window.prompt)
   * - 编辑历史任务(editingName 有值) → 直接调 onSaved 覆盖持久化,启动与否由 opts.start 决定
   *   失败时 setSaveError 在 config 步骤顶部展示红色 banner
   *   成功由父组件(WindowCard / HistoryTaskDialog)关 dialog + 刷新 history 列表
   */
  const handleSave = async (opts?: { start?: boolean }) => {
    if (readOnly || saving) return;
    setSaveError(null);
    // 校验不过就留在 config 步骤显示红条(新建时也不要进 name 步骤,免得起好名字才发现配错了)
    const cfgErr = validateConfig();
    if (cfgErr) {
      setSaveError(cfgErr);
      return;
    }
    if (editingName) {
      // 编辑历史任务:覆盖保存,不跳命名步骤;是否启动 worker 由调用方(opts.start)决定
      setSaving(true);
      try {
        const config = buildConfig();
        const res = await onSaved(config, editingName, { existing: true, start: opts?.start ?? false });
        if (res && res.ok === false) {
          setSaveError(res.error || '保存失败');
        }
      } finally {
        setSaving(false);
      }
      return;
    }
    // 新建:跳到 name 步骤输入名字
    setNameError(null);
    setTaskName(`任务-${hwnd}-${new Date().toLocaleDateString()}`);
    setStep('name');
  };

  /**
   * 「另存为…」:脱离当前历史任务(清掉 editingName),带着"{原名} 副本"进入新建命名步骤,
   * 避免覆盖原任务
   */
  const handleSaveAs = () => {
    if (readOnly) return;
    const base = editingName;
    setEditingName(null);
    setSaveError(null);
    setNameError(null);
    setTaskName(base ? `${base} 副本` : `任务-${hwnd}-${new Date().toLocaleDateString()}`);
    setStep('name');
  };

  /**
   * 在 name 步骤点"确认保存":
   * 1. 校验名字(trim + 非空)
   * 2. 调 onSaved(config, name) — WindowCard.handleTaskSaved 负责 saveByName + startTask
   * 3. 失败:停留在 name 步骤 + 显示错误(用户可以改名重试)
   * 4. 成功:由 WindowCard 关闭 dialog(此处不关)
   */
  const handleConfirmName = async () => {
    const trimmed = taskName.trim();
    if (!trimmed) {
      setNameError('任务名不能为空');
      return;
    }
    // 校验:城镇档案 / 对话配方至少要有 1 个 NPC / 1 个步骤(空配置保存下来也跑不了)
    const cfgErr = validateConfig();
    if (cfgErr) {
      // 自动跳回 config 步骤 + 顶部红色 banner
      setStep('config');
      setSaveError(cfgErr);
      return;
    }
    // 校验:缺省技能必须至少 1 个启用的步骤(空配置启动会被 worker 直接结束,UI 提前拦截)
    if (taskType === 'default-skill') {
      const cfg = buildConfig();
      const enabledSteps = (cfg.type === 'default-skill' ? cfg.steps : []).filter((s) => s.enabled !== false);
      if (enabledSteps.length === 0) {
        // 自动跳回 config 步骤 + 顶部红色 banner
        setStep('config');
        setSaveError('缺省技能任务至少需要 1 个启用的步骤');
        return;
      }
    }
    const config = buildConfig();
    const res = await onSaved(config, trimmed);
    if (res && res.ok === false) {
      // 失败 — 停留在 name 步骤,用户可以改名重试
      setNameError(res.error || '保存失败');
    }
    // 成功 — WindowCard 会关 dialog
  };

  const handleConfirm = () => {
    if (readOnly) return;
    const config = buildConfig();
    onConfirm?.(config);
  };

  /**
   * 从历史任务加载:把 cfg 灌进 dialog state,并进入"编辑这条历史任务"态
   * - farm / default-skill:全字段回显 + 跳 step 2
   * - 其他:只设置 type,跳 step 2
   * - 设 editingName = 这条任务名 → footer 的保存会默认覆盖它(想存新的走「另存为…」)
   */
  const handleHistoryApply = (stored: StoredTaskConfig) => {
    setHistoryOpen(false);
    const cfg = stored.config;
    applyConfig(cfg);
    setTaskType(cfg.type);
    setEditingName(stored.name);
    setSaveError(null);
    setNameError(null);
    setStep('config');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-card border border-border-base rounded-lg shadow-2xl w-[720px] max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <header className="px-5 py-3 border-b border-border-base flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-text-muted">hwnd {hwnd}</span>
            <ChevronRight size={14} className="text-text-muted" />
            <span className="text-text-primary font-medium">
              {readOnly ? '查看任务(只读)' : step === 'select' ? '选择任务' : '配置任务'}
            </span>
            {taskType && (
              <>
                <ChevronRight size={14} className="text-text-muted" />
                <span className="text-accent-cyan">{TASK_OPTIONS.find((o) => o.type === taskType)?.name}</span>
              </>
            )}
            {/* 当前任务运行状态回显 */}
            {workerState && step === 'config' && (
              <span className="ml-2 inline-flex items-center gap-2 text-[11px] text-text-muted">
                <span className={`px-1.5 py-0.5 rounded font-medium ${statusBg(workerState.status)}`}>
                  {statusLabel(workerState.status)}
                </span>
                {workerState.stats && (
                  <>
                    <span>击杀 {workerState.stats.killCount ?? 0}</span>
                    <span>·</span>
                    <span>死亡 {workerState.stats.deathCount ?? 0}</span>
                    <span>·</span>
                    <span>运行 {formatUptime(workerState.stats.uptimeMs ?? 0)}</span>
                  </>
                )}
                {workerState.statusDetail && (
                  <span className="text-accent-yellow/80" title={workerState.statusDetail}>
                    [{workerState.statusDetail}]
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 缩略图预览:确认游戏窗口已正确连接 */}
            <div
              className="w-[88px] h-[50px] rounded border border-border-base overflow-hidden bg-black/40 flex items-center justify-center"
              title={thumbnail ? '当前游戏窗口截图' : '暂无截图(worker 可能未就绪)'}
            >
              {thumbnail ? (
                <img src={thumbnail} alt="game preview" className="w-full h-full object-contain" />
              ) : (
                <span className="text-[10px] text-text-muted">无图像</span>
              )}
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'select' && (
            <>
              {/* 历史任务入口(放在选任务类型之前,只读模式下不显示;配置型任务不在这里) */}
              {!readOnly && runnableHistoryCount > 0 && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="w-full mb-3 p-2.5 rounded border border-accent-cyan/40 bg-accent-cyan/10 hover:bg-accent-cyan/20 flex items-center gap-2 text-sm transition-colors"
                  title="从已保存的任务列表中加载配置"
                >
                  <History size={14} className="text-accent-cyan" />
                  <span className="font-medium">从历史任务中选择</span>
                  <span className="ml-auto text-[11px] text-text-muted">{runnableHistoryCount} 条</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                {TASK_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    disabled={!opt.ready}
                    onClick={() => {
                      if (opt.ready) selectTaskType(opt.type);
                    }}
                    className={`
                    p-4 rounded-lg border text-left transition-all
                    ${
                      opt.ready
                        ? 'bg-bg-hover border-border-base hover:border-accent-cyan cursor-pointer'
                        : 'bg-bg-input/50 border-border-base/50 opacity-50 cursor-not-allowed'
                    }
                  `}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{opt.icon}</span>
                      <span className="text-base font-medium">{opt.name}</span>
                      {!opt.ready && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-text-muted/20 text-text-muted">即将推出</span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 编辑模式下直接保存失败时的错误展示(不进 name 步骤) */}
          {step === 'config' && saveError && (
            <div className="mb-3 text-[12px] text-accent-red bg-accent-red/10 border border-accent-red/30 rounded px-3 py-2">
              {saveError}
            </div>
          )}

          {/* 编辑态提示:告诉用户"保存 = 覆盖这条",想新建走「另存为…」 */}
          {step === 'config' && editingName && (
            <div className="mb-3 text-[12px] text-text-secondary bg-bg-input border border-border-base rounded px-3 py-2">
              正在编辑「{editingName}」:点「保存」会覆盖它,想存成新的点「另存为…」。
            </div>
          )}

          {step === 'config' && taskType === 'farm' && (
            <FarmConfig
              readOnly={readOnly}
              mapId={mapId}
              setMapId={setMapId}
              customMapName={customMapName}
              setCustomMapName={setCustomMapName}
              mode={mode}
              setMode={setMode}
              castMode={castMode}
              setCastMode={setCastMode}
              waypoints={waypoints}
              addWaypoint={addWaypoint}
              removeWaypoint={removeWaypoint}
              moveWaypoint={moveWaypoint}
              updateWaypoint={updateWaypoint}
              setWaypoints={setWaypoints}
              nameKeywords={nameKeywords}
              setNameKeywords={setNameKeywords}
              mobNameColors={mobNameColors}
              setMobNameColors={setMobNameColors}
              ocrRange={ocrRange}
              setOcrRange={setOcrRange}
              clickOffset={clickOffset}
              setClickOffset={setClickOffset}
              skills={skills}
              setSkills={setSkills}
              moveStepIntervalMs={moveStepIntervalMs}
              setMoveStepIntervalMs={setMoveStepIntervalMs}
              spotIdleMs={spotIdleMs}
              setSpotIdleMs={setSpotIdleMs}
              skipStuckWaypoint={skipStuckWaypoint}
              setSkipStuckWaypoint={setSkipStuckWaypoint}
              watchdog={watchdog}
              setWatchdog={setWatchdog}
              pickup={pickup}
              setPickup={setPickup}
              resupply={resupply}
              setResupply={setResupply}
              petRide={petRide}
              setPetRide={setPetRide}
              returnScroll={returnScroll}
              setReturnScroll={setReturnScroll}
              endReturn={endReturn}
              setEndReturn={setEndReturn}
              returnScrollIssue={returnScrollIssue}
              townProfileNames={townProfileNames}
              recipeIssue={recipeIssue}
              mapCrossings={mapCrossings}
              setMapCrossings={setMapCrossings}
              auxConfigNames={auxConfigNames}
              setAuxConfigNames={setAuxConfigNames}
              farmAuxOptions={farmAuxOptions}
              mapProfileNames={mapProfileNames}
              blockAllPlayersOnNewMap={blockAllPlayersOnNewMap}
              setBlockAllPlayersOnNewMap={setBlockAllPlayersOnNewMap}
              zoomOutMinimap={zoomOutMinimap}
              setZoomOutMinimap={setZoomOutMinimap}
              closeChatBackground={closeChatBackground}
              setCloseChatBackground={setCloseChatBackground}
              note={note}
              setNote={setNote}
            />
          )}

          {step === 'config' && taskType === 'default-skill' && (
            <DefaultSkillConfig
              readOnly={readOnly}
              steps={skillSteps}
              setSteps={setSkillSteps}
              loopCount={skillLoopCount}
              setLoopCount={setSkillLoopCount}
              loopIntervalMs={skillLoopIntervalMs}
              setLoopIntervalMs={setSkillLoopIntervalMs}
              note={skillNote}
              setNote={setSkillNote}
            />
          )}

          {step === 'config' && taskType === 'town-profile' && (
            <>
              <div className="mb-3 text-[12px] text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 rounded px-3 py-2">
                {CONFIG_ONLY_HINT}
              </div>
              {/* 卡片内管理:选择已保存的城镇档案查看/修改,或新建、删除 */}
              <div className="mb-3 p-2.5 rounded border border-border-base bg-bg-input/40 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-secondary shrink-0">已保存的城镇档案</span>
                <select
                  value={editingName ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) newTownProfile();
                    else {
                      const stored = savedTownProfiles.find((p) => p.name === name);
                      if (stored) loadTownProfile(stored);
                    }
                  }}
                  className="bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">＋ 新建城镇档案</option>
                  {savedTownProfiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {editingName && !readOnly && (
                  <button
                    onClick={() => void deleteSelectedTownProfile()}
                    disabled={deleting}
                    className="text-xs px-2 py-1 rounded bg-accent-red/10 hover:bg-accent-red/20 text-accent-red flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={`删除「${editingName}」(不可撤销)`}
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                )}
                <span className="ml-auto text-[10px] text-text-muted">
                  {editingName ? `正在编辑「${editingName}」` : '新建(保存时命名)'}
                </span>
              </div>
              <TownProfileForm readOnly={readOnly} value={townProfile} onChange={setTownProfile} hwnd={hwnd} recipeNames={recipeNames} />
            </>
          )}

          {step === 'config' && taskType === 'dialog-recipe' && (
            <>
              <div className="mb-3 text-[12px] text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 rounded px-3 py-2">
                {CONFIG_ONLY_HINT}
              </div>
              {/* 卡片内管理:选择已保存的对话配方查看/修改,或新建、删除 */}
              <div className="mb-3 p-2.5 rounded border border-border-base bg-bg-input/40 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-secondary shrink-0">已保存的对话配方</span>
                <select
                  value={editingName ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) newDialogRecipe();
                    else {
                      const stored = savedDialogRecipes.find((p) => p.name === name);
                      if (stored) loadDialogRecipe(stored);
                    }
                  }}
                  className="bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">＋ 新建对话配方</option>
                  {savedDialogRecipes.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {editingName && !readOnly && (
                  <button
                    onClick={() => void deleteSelectedDialogRecipe()}
                    disabled={deleting}
                    className="text-xs px-2 py-1 rounded bg-accent-red/10 hover:bg-accent-red/20 text-accent-red flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={`删除「${editingName}」(不可撤销)`}
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                )}
                <span className="ml-auto text-[10px] text-text-muted">
                  {editingName ? `正在编辑「${editingName}」` : '新建(保存时命名)'}
                </span>
              </div>
              <DialogRecipeForm readOnly={readOnly} value={dialogRecipe} onChange={setDialogRecipe} />
            </>
          )}

          {step === 'config' && taskType === 'map-profile' && (
            <>
              <div className="mb-3 text-[12px] text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 rounded px-3 py-2">
                {CONFIG_ONLY_HINT}
              </div>
              {/* 卡片内管理:选择已保存的过图路线查看/修改,或新建、删除 */}
              <div className="mb-3 p-2.5 rounded border border-border-base bg-bg-input/40 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-secondary shrink-0">已保存的过图路线</span>
                <select
                  value={editingName ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) newMapProfile();
                    else {
                      const stored = savedMapProfiles.find((p) => p.name === name);
                      if (stored) loadMapProfile(stored);
                    }
                  }}
                  className="bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">＋ 新建过图路线</option>
                  {savedMapProfiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {editingName && !readOnly && (
                  <button
                    onClick={() => void deleteSelectedMapProfile()}
                    disabled={deleting}
                    className="text-xs px-2 py-1 rounded bg-accent-red/10 hover:bg-accent-red/20 text-accent-red flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={`删除「${editingName}」(不可撤销)`}
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                )}
                <span className="ml-auto text-[10px] text-text-muted">
                  {editingName ? `正在编辑「${editingName}」` : '新建(保存时命名)'}
                </span>
              </div>
              <MapProfileForm readOnly={readOnly} value={mapProfile} onChange={setMapProfile} hwnd={hwnd} recipeNames={recipeNames} />
            </>
          )}

          {step === 'config' && taskType === 'pet-training' && (
            <>
              <div className="mb-3 text-[12px] text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 rounded px-3 py-2">
                {CONFIG_ONLY_HINT}
              </div>
              {/* 卡片内管理:选择已保存的宠物带练查看/修改,或新建、删除 */}
              <div className="mb-3 p-2.5 rounded border border-border-base bg-bg-input/40 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-secondary shrink-0">已保存的宠物带练</span>
                <select
                  value={editingName ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) newPetTraining();
                    else {
                      const stored = savedPetTrainings.find((p) => p.name === name);
                      if (stored) loadPetTraining(stored);
                    }
                  }}
                  className="bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">＋ 新建宠物带练</option>
                  {savedPetTrainings.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {editingName && !readOnly && (
                  <button
                    onClick={() => void deleteSelectedPetTraining()}
                    disabled={deleting}
                    className="text-xs px-2 py-1 rounded bg-accent-red/10 hover:bg-accent-red/20 text-accent-red flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={`删除「${editingName}」(不可撤销)`}
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                )}
                <span className="ml-auto text-[10px] text-text-muted">
                  {editingName ? `正在编辑「${editingName}」` : '新建(保存时命名)'}
                </span>
              </div>
              <PetTrainingForm readOnly={readOnly} value={petTraining} onChange={setPetTraining} />
            </>
          )}

          {step === 'config' &&
            taskType &&
            taskType !== 'farm' &&
            taskType !== 'default-skill' &&
            taskType !== 'town-profile' &&
            taskType !== 'dialog-recipe' &&
            taskType !== 'map-profile' &&
            taskType !== 'pet-training' && (
              <div className="text-center py-12 text-text-secondary">
                <div className="text-4xl mb-3 opacity-30">{TASK_OPTIONS.find((o) => o.type === taskType)?.icon}</div>
                <div className="text-base mb-1">{TASK_OPTIONS.find((o) => o.type === taskType)?.name}</div>
                <div className="text-xs text-text-muted">配置项留白,后续版本提供</div>
              </div>
            )}

          {/* 命名步骤(替代 Electron 不支持的 window.prompt) — 创建流程专属 */}
          {step === 'name' && (
            <div className="space-y-4 py-2">
              <div className="rounded border border-accent-cyan/40 bg-accent-cyan/5 p-4 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {isConfigOnlyTaskType(taskType) ? '为这份配置起个名字' : '为这个任务起个名字'}
                  </span>
                  <span className="text-[11px] text-text-muted">(全局唯一,跨窗口复用)</span>
                </div>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => {
                    setTaskName(e.target.value);
                    setNameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmName();
                    if (e.key === 'Escape') {
                      setStep('config');
                      setNameError(null);
                    }
                  }}
                  autoFocus
                  placeholder="任务名(全局唯一)"
                  readOnly={!!editingName}
                  disabled={!!editingName}
                  title={editingName ? '编辑模式下任务名锁定' : ''}
                  className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {nameError && <div className="text-[11px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">{nameError}</div>}
                <div className="text-[11px] text-text-muted">
                  {isConfigOnlyTaskType(taskType)
                    ? '💡 保存后这份配置会出现在「选择任务」里对应的卡片中,供挂机打怪的「城市事件 / 地图跨越 / 辅助配置」引用'
                    : '💡 保存后该任务会出现在"历史任务"列表,可以复用到其他窗口'}
                </div>
                {/* name 步骤的操作按钮(footer 在这一步只显示"取消",主要操作放这里) */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-accent-cyan/20">
                  <button
                    onClick={() => {
                      setStep('config');
                      setNameError(null);
                    }}
                    className="btn btn-secondary flex items-center gap-1"
                  >
                    返回配置
                  </button>
                  <button onClick={() => void handleConfirmName()} className="btn btn-primary flex items-center gap-1">
                    <Check size={14} />
                    确认保存
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 内嵌历史任务 dialog */}
        {historyOpen && (
          <HistoryTaskDialog
            history={taskHistory}
            currentHwnd={hwnd}
            variant="load"
            onClose={() => setHistoryOpen(false)}
            onApply={handleHistoryApply}
            onStart={onStartStored}
          />
        )}

        {/* 底部 */}
        <footer className="px-5 py-3 border-t border-border-base flex items-center justify-between">
          {readOnly ? (
            // 只读模式:只显示"关闭"按钮
            <div className="w-full flex justify-end">
              <button onClick={onClose} className="btn btn-secondary">
                关闭
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => {
                  if (step === 'config') {
                    // 回到任务类型选择 = 放弃当前编辑,清掉 editingName 避免误覆盖历史任务
                    setStep('select');
                    setTaskType(null);
                    setEditingName(null);
                    setSaveError(null);
                  } else if (step === 'name') {
                    setStep('config');
                    setNameError(null);
                  } else {
                    onClose();
                  }
                }}
                className="btn btn-secondary"
              >
                {step === 'config' ? '上一步' : step === 'name' ? '上一步' : '取消'}
              </button>
              {step === 'config' && (
                <div className="flex items-center gap-2">
                  {editingName ? (
                    <>
                      {/* 另存为…:脱离当前历史任务,走新建命名路径(避免误覆盖) */}
                      <button
                        onClick={handleSaveAs}
                        className="btn btn-secondary flex items-center gap-1.5"
                        title={`把当前配置存成一条新任务(默认名「${editingName} 副本」),不改动原任务`}
                      >
                        另存为…
                      </button>
                      {/* 保存:覆盖写回这条历史任务(不启动);配置型不可运行 → 它才是主按钮 */}
                      <button
                        onClick={() => void handleSave({ start: false })}
                        disabled={saving}
                        className={
                          isConfigOnlyTaskType(taskType)
                            ? PRIMARY_BTN_CLS
                            : 'btn btn-secondary flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed'
                        }
                        title="覆盖保存「{editingName}」(不启动 worker)"
                      >
                        {saving ? '保存中...' : '保存'}
                      </button>
                      {/* 保存并启动:覆盖保存 + 立即启动;配置型"任务"不可运行 → 不渲染 */}
                      {!isConfigOnlyTaskType(taskType) && (
                        <button
                          onClick={() => void handleSave({ start: true })}
                          disabled={saving}
                          className={PRIMARY_BTN_CLS}
                          title="覆盖保存这条历史任务,并立即在当前窗口启动 worker"
                        >
                          保存并启动
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {/* 新建:文案"存为记忆"会跳到 name 步骤起名字(保存 + 启动)
                          配置型"任务"文案为「保存配置」,只落盘、不启动 */}
                      <button
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="btn btn-secondary flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                        title={
                          isConfigOnlyTaskType(taskType)
                            ? '把这份配置保存到对应卡片,供挂机打怪的「城市事件」引用'
                            : '执行并保存当前任务，以便下次直接在“历史任务”中使用'
                        }
                      >
                        {saving ? '保存中...' : isConfigOnlyTaskType(taskType) ? '保存配置' : '存为记忆'}
                      </button>
                      {/* "仅本次运行":仅写内存,不持久化(关 app 丢,新流程会启动 worker)
                          配置型"任务"不提供:它们必须保存到历史任务里才能被 farm 引用 */}
                      {onConfirm && !isConfigOnlyTaskType(taskType) && (
                        <button
                          onClick={handleConfirm}
                          className="btn btn-secondary flex items-center gap-1.5"
                          title="不保存到磁盘,只运行这一次(关 app 后丢)"
                        >
                          仅本次运行
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {step === 'name' && <span className="text-[11px] text-text-muted">按 Enter 或点 panel 内"确认保存"</span>}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---- 挂机打怪配置子组件 ----

/** 技能可选键:第一页 F1-F10 / 第二页 TF1-TF10(按一次 Tab 切页,与 worker 的 skill-key.ts 对应) */
const SKILL_KEY_PAGE1 = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];
const SKILL_KEY_PAGE2 = ['TF1', 'TF2', 'TF3', 'TF4', 'TF5', 'TF6', 'TF7', 'TF8', 'TF9', 'TF10'];

/** 旧配置第二页写成 SF*,读入时归一成 TF*(与 worker 的 normalizeSkillKey 一致) */
const normalizeSkillKey = (key: string): string => key.replace(/^SF(\d+)$/, 'TF$1');

/** 某个技能 id 是否是启用中的「宠物技能」(骑乘/打怪前技能的引用只能指向它) */
function isPetSkillId(skills: FarmSkillConfig[], id?: string): boolean {
  if (!id) return false;
  return skills.some((s) => s.id === id && s.enabled !== false && s.method === 'pet');
}

/** 施法方式选项 */
const CAST_METHOD_OPTIONS: { value: SkillCastMethod; label: string; desc: string }[] = [
  { value: 'quick', label: '快捷施法', desc: '只按技能键' },
  { value: 'target', label: '缺省施法', desc: '按键 + 左键点击目标坐标' },
  { value: 'self', label: '状态施法', desc: '点击角色自身 + 按键' },
  { value: 'item', label: '物品使用', desc: '只按快捷键使用快捷栏物品(可由「生命回复」按血量自动使用)' },
  { value: 'pet', label: '宠物技能', desc: '只按技能键的宠物技能(不参与打怪,供「宠物技能」的骑乘/打怪前技能选择)' },
];

/** 新建任务时的看门狗默认值:只开验证码(与升级前行为一致,其余项按需勾选) */
const DEFAULT_WATCHDOG: FarmWatchdogConfig = { verifyCode: true };

interface FarmConfigProps {
  readOnly?: boolean;
  mapId: string;
  setMapId: (v: string) => void;
  customMapName: string;
  setCustomMapName: (v: string) => void;
  mode: FarmMode;
  setMode: (v: FarmMode) => void;
  /** 施法方式:smart=智能施法(默认) / custom=自定义施法(按路径点绑定技能) */
  castMode: FarmCastMode;
  setCastMode: (v: FarmCastMode) => void;
  waypoints: Waypoint[];
  addWaypoint: () => void;
  removeWaypoint: (id: string) => void;
  moveWaypoint: (id: string, dir: -1 | 1) => void;
  updateWaypoint: (id: string, field: keyof Waypoint, value: any) => void;
  setWaypoints: (v: Waypoint[] | ((prev: Waypoint[]) => Waypoint[])) => void;
  nameKeywords: string;
  setNameKeywords: (v: string) => void;
  /** 怪名颜色(多选;大漠颜色格式的数组) */
  mobNameColors: string[];
  setMobNameColors: (v: string[]) => void;
  /** 定点识别的 OCR 识别范围(客户区相对坐标;w/h=0 表示不配 = 整个画面) */
  ocrRange: ScreenRect;
  setOcrRange: (v: ScreenRect) => void;
  /** 定点识别:点击怪名的偏移(默认 0,0 = 点在名字上) */
  clickOffset: { x: number; y: number };
  setClickOffset: (v: { x: number; y: number }) => void;
  skills: FarmSkillConfig[];
  setSkills: (v: FarmSkillConfig[] | ((prev: FarmSkillConfig[]) => FarmSkillConfig[])) => void;
  /** 走位点击间隔(毫秒;沿路径点走位时每点一次地面后隔多久再读坐标) */
  moveStepIntervalMs: number;
  setMoveStepIntervalMs: (v: number) => void;
  /** 挂机点停留时间(毫秒;定点识别:连续这么久识别不到怪就前往下一个路径点) */
  spotIdleMs: number;
  setSpotIdleMs: (v: number) => void;
  /** 路径点卡住时是否跳过该点(缺省 true = 跳过) */
  skipStuckWaypoint: boolean;
  setSkipStuckWaypoint: (v: boolean) => void;
  /** 看门狗配置(组队申请/验证码/生命回复/角色停级) */
  watchdog: FarmWatchdogConfig;
  setWatchdog: (v: FarmWatchdogConfig | ((prev: FarmWatchdogConfig) => FarmWatchdogConfig)) => void;
  /** 物品拾取配置(nameKeywords 在界面里是逗号分隔文本) */
  pickup: PickupUiState;
  setPickup: (v: PickupUiState | ((prev: PickupUiState) => PickupUiState)) => void;
  /** 城市事件(引用已保存的城镇档案;启动 farm 时由 WindowCard 解析成 auxConfigs 下发) */
  resupply: FarmResupplyConfig;
  setResupply: (v: FarmResupplyConfig | ((prev: FarmResupplyConfig) => FarmResupplyConfig)) => void;
  /** 宠物技能(回城上骑、到挂机点下骑、打怪前开启宠物技能;都引用「宠物技能」) */
  petRide: FarmPetRideConfig;
  setPetRide: (v: FarmPetRideConfig | ((prev: FarmPetRideConfig) => FarmPetRideConfig)) => void;
  /** 回城卷轴(起点不认识时先回主城;引用「物品」技能) */
  returnScroll: FarmReturnScrollConfig;
  setReturnScroll: (v: FarmReturnScrollConfig | ((prev: FarmReturnScrollConfig) => FarmReturnScrollConfig)) => void;
  /** 条件回城(完成 N 圈后回城处理,再回挂机图继续下一轮;卷轴方式复用上面的「回城卷轴」技能) */
  endReturn: FarmEndReturnConfig;
  setEndReturn: (v: FarmEndReturnConfig | ((prev: FarmEndReturnConfig) => FarmEndReturnConfig)) => void;
  /** 条件回城用卷轴方式但「回城卷轴」没配好物品技能的问题(提示用,不阻断保存) */
  returnScrollIssue: string | null;
  /** 可选城镇档案名(历史任务里所有 town-profile 的 name) */
  townProfileNames: string[];
  /** 当前编辑的城镇档案里 NPC 引用配方的问题(提示用,不阻断保存) */
  recipeIssue: string | null;
  /** 地图跨越:中间地图的过图路线名,按穿越顺序(不含城镇、不含挂机图) */
  mapCrossings: string[];
  setMapCrossings: (v: string[] | ((prev: string[]) => string[])) => void;
  /** 辅助配置:勾选的辅助配置任务名(顺序 = 执行顺序) */
  auxConfigNames: string[];
  setAuxConfigNames: (v: string[] | ((prev: string[]) => string[])) => void;
  /** 可勾选的辅助配置(名字 + 一行摘要,来自 store.taskHistory) */
  farmAuxOptions: FarmAuxOption[];
  /** 可选的过图路线名(历史任务里所有 map-profile 的 name) */
  mapProfileNames: string[];
  /** 进入新地图时屏蔽所有人(worker 检测到换图就按 F11×4) */
  blockAllPlayersOnNewMap: boolean;
  setBlockAllPlayersOnNewMap: (v: boolean) => void;
  /** 小地图缩放:任务启动时按一次 Alt+- (缺省开启) */
  zoomOutMinimap: boolean;
  setZoomOutMinimap: (v: boolean) => void;
  /** 关闭聊天背景:任务启动时点一次聊天框(缺省开启) */
  closeChatBackground: boolean;
  setCloseChatBackground: (v: boolean) => void;
  note: string;
  setNote: (v: string) => void;
}

function FarmConfig(props: FarmConfigProps) {
  const {
    readOnly = false,
    mapId,
    setMapId,
    customMapName,
    setCustomMapName,
    mode,
    setMode,
    castMode,
    setCastMode,
    waypoints,
    addWaypoint,
    removeWaypoint,
    moveWaypoint,
    updateWaypoint,
    setWaypoints,
    nameKeywords,
    setNameKeywords,
    mobNameColors,
    setMobNameColors,
    ocrRange,
    setOcrRange,
    clickOffset,
    setClickOffset,
    skills,
    setSkills,
    moveStepIntervalMs,
    setMoveStepIntervalMs,
    spotIdleMs,
    setSpotIdleMs,
    skipStuckWaypoint,
    setSkipStuckWaypoint,
    watchdog,
    setWatchdog,
    pickup,
    setPickup,
    resupply,
    setResupply,
    petRide,
    setPetRide,
    returnScroll,
    setReturnScroll,
    endReturn,
    setEndReturn,
    returnScrollIssue,
    townProfileNames,
    recipeIssue,
    mapCrossings,
    setMapCrossings,
    auxConfigNames,
    setAuxConfigNames,
    farmAuxOptions,
    mapProfileNames,
    blockAllPlayersOnNewMap,
    setBlockAllPlayersOnNewMap,
    zoomOutMinimap,
    setZoomOutMinimap,
    closeChatBackground,
    setCloseChatBackground,
    note,
    setNote,
  } = props;

  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

  /** 「物品使用」技能 = 生命回复可选的药品池(与技能设置共用同一份快捷栏配置) */
  const itemSkills = skills.filter((s) => s.method === 'item' && s.enabled !== false);
  /** 「宠物技能」= 宠物骑乘的上骑/下骑、打怪前开启宠物技能的可选池(不参与打怪循环) */
  const petSkills = skills.filter((s) => s.method === 'pet' && s.enabled !== false);
  /** 参与打怪的技能(路径点绑定用;宠物技能只在骑乘/打怪前开启时用,不参与打怪) */
  const combatSkills = skills.filter((s) => s.method !== 'pet');
  const autoHealIds = watchdog.autoHeal?.itemIds ?? [];
  /** 把某个技能 id 从生命回复的药品选择里摘掉(技能被删/改成别的施法方式时) */
  const dropHealItem = (id: string) => {
    setWatchdog((w) => {
      if (!w.autoHeal) return w;
      const itemIds = (w.autoHeal.itemIds || []).filter((x) => x !== id);
      return { ...w, autoHeal: { itemIds } };
    });
  };
  /** 把某个技能 id 从宠物技能的引用(上骑/下骑/打怪前技能)里摘掉(技能被删/改成别的施法方式时) */
  const dropPetRideSkill = (id: string) => {
    setPetRide((p) => {
      if (p.mountSkillId !== id && p.dismountSkillId !== id && p.preFarmSkillId !== id) return p;
      return {
        ...p,
        mountSkillId: p.mountSkillId === id ? undefined : p.mountSkillId,
        dismountSkillId: p.dismountSkillId === id ? undefined : p.dismountSkillId,
        preFarmSkillId: p.preFarmSkillId === id ? undefined : p.preFarmSkillId,
      };
    });
  };

  /** 改自定义拾取范围的某一项 */
  const setPickupRange = (key: keyof ScreenRect, v: number) => setPickup((p) => ({ ...p, range: { ...p.range, [key]: v } }));

  // ---- 拾取规则编辑(每条 = 颜色 + 名称;规则之间是「或」)----
  const addPickupRule = () => {
    if (readOnly) return;
    setPickup((p) => ({ ...p, rules: [...p.rules, { colors: [], nameKeywords: '' }] }));
  };

  /** 删掉一条规则;只剩一条时不清空(留着让用户改,避免界面变空没处下手) */
  const removePickupRule = (idx: number) => {
    if (readOnly) return;
    setPickup((p) => (p.rules.length > 1 ? { ...p, rules: p.rules.filter((_, i) => i !== idx) } : p));
  };

  const updatePickupRule = (idx: number, patch: Partial<PickupRuleUi>) =>
    setPickup((p) => ({ ...p, rules: p.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));

  /** 每条都既没颜色也没名称 = 拾取不生效(存的时候也会被丢掉) */
  const pickupRuleEmpty = pickup.rules.every((r) => r.colors.length === 0 && !r.nameKeywords.trim());

  // ---- 任务级技能列表编辑 ----
  const addSkill = () => {
    if (readOnly) return;
    setSkills((ss) => [
      ...ss,
      {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        key: 'F1',
        name: '',
        cooldownMs: 5000,
        castMs: 400,
        rangePx: 0,
        method: 'target' as SkillCastMethod,
        enabled: true,
      },
    ]);
  };

  const removeSkill = (id: string) => {
    if (readOnly) return;
    setSkills((ss) => ss.filter((s) => s.id !== id));
    // 清掉路径点上对该技能的引用,避免留下失效 id
    setWaypoints((ws) => ws.map((w) => (w.skillIds ? { ...w, skillIds: w.skillIds.filter((sid) => sid !== id) } : w)));
    // 同时从生命回复的药品选择里摘掉
    dropHealItem(id);
    // 以及从宠物技能的引用(上骑/下骑/打怪前技能)里摘掉
    dropPetRideSkill(id);
  };

  const moveSkill = (id: string, dir: -1 | 1) => {
    setSkills((ss) => {
      const idx = ss.findIndex((s) => s.id === id);
      if (idx < 0) return ss;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= ss.length) return ss;
      const next = [...ss];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const updateSkill = (id: string, patch: Partial<FarmSkillConfig>) => {
    if (readOnly) return;
    setSkills((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-5">
      {/* 地图 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">地图</label>
        <select
          value={mapId}
          onChange={(e) => setMapId(e.target.value)}
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
        >
          {FARM_MAPS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {mapId === 'custom' && (
          <input
            type="text"
            placeholder="自定义地图名"
            value={customMapName}
            onChange={(e) => setCustomMapName(e.target.value)}
            disabled={readOnly}
            className={`mt-2 w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
          />
        )}
      </div>

      {/* 打怪模式 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">打怪模式</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              {
                value: 'fixed',
                label: '🎯 定点打怪',
                ready: true,
                desc: '在固定路径点上,释放固定技能(不做识别)',
              },
              {
                value: 'fixed-detect',
                label: '🔍 定点识别',
                ready: true,
                desc: '在固定路径点上,OCR 识别怪物名称,右键点击锁定(HUD 出现名字)后左键点击开始攻击(可不配技能 = 普通攻击)',
              },
              {
                value: 'move-detect',
                label: '🚶 移动识别',
                ready: false,
                desc: '移动途中识别到怪物名称,优先停下打怪,打完继续赶路',
              },
            ] as const
          ).map((m) => {
            const selectable = m.ready && !readOnly;
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => selectable && setMode(m.value)}
                disabled={!selectable}
                title={m.ready ? m.desc : `${m.desc}(即将推出)`}
                className={`
                  px-3 py-2 rounded border text-sm transition-colors relative
                  ${
                    active
                      ? 'bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan'
                      : selectable
                        ? 'bg-bg-input border-border-base text-text-secondary hover:border-border-active'
                        : 'bg-bg-input/50 border-border-base/50 text-text-muted/60 cursor-not-allowed'
                  }
                `}
              >
                <span>{m.label}</span>
                {!m.ready && (
                  <span className="absolute -top-2 -right-1 text-[9px] px-1 rounded bg-text-muted/30 text-text-muted">即将推出</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-text-muted mt-1.5">
          {mode === 'fixed' && '在固定路径点上,释放该点绑定的固定技能(不做识别;缺省施法技能落在固定方向上)'}
          {mode === 'fixed-detect' &&
            '在固定路径点上,按设定的 OCR 范围/颜色识别怪物名称,右键点击怪名锁定(HUD 出现名字才算锁上)后用左键点击怪名开打;右键点了 HUD 里却没出现名字 = 该目标已阵亡,不攻击,继续扫描;不配技能 = 识别到怪就普通攻击(左键点一下);连续识别不到怪后原地再等「挂机点停留时间」(默认 2 秒),仍没有怪才前往下一个点'}
          {mode === 'move-detect' && '移动途中识别到怪物名称,优先停下打怪,打完再继续前往路径点'}
        </div>
      </div>

      {/* 技能设置(先配技能,再在下方路径点上选择用哪些) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            技能设置 <span className="text-text-muted text-[11px]">(F1-F10 第一页 / TF1-TF10 第二页;路径点从这里选择要释放的技能)</span>
          </label>
          {!readOnly && (
            <button onClick={addSkill} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加技能
            </button>
          )}
        </div>

        {skills.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无技能,点"添加技能"配置(F1-F10 第一页 / TF1-TF10 第二页的名称/间隔/吟唱/施法距离/施法方式); 定点识别可以不配技能 =
            普通攻击(右键锁定后左键点一下)
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill, i) => {
              const method = skill.method ?? 'target';
              const isTarget = method === 'target';
              return (
                <div key={skill.id} className={`bg-bg-input p-2 rounded space-y-2 ${skill.enabled === false ? 'opacity-50' : ''}`}>
                  {/* 第一行:序号 / 启用 / 键位 / 名称 / 施法方式 / 操作 */}
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-[11px] w-5 text-center">#{i + 1}</span>
                    {!readOnly && (
                      <input
                        type="checkbox"
                        checked={skill.enabled !== false}
                        onChange={(e) => updateSkill(skill.id, { enabled: e.target.checked })}
                        title="启用 / 临时禁用"
                        className="accent-accent-cyan"
                      />
                    )}
                    <select
                      value={skill.key}
                      onChange={(e) => updateSkill(skill.id, { key: e.target.value })}
                      disabled={readOnly}
                      className={`w-16 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      title="技能键:第一页 F1-F10 / 第二页 TF1-TF10(按一次 Tab 切页)"
                    >
                      <optgroup label="第一页 F1-F10">
                        {SKILL_KEY_PAGE1.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="第二页 TF1-TF10(Tab)">
                        {SKILL_KEY_PAGE2.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      type="text"
                      placeholder="技能名称"
                      value={skill.name || ''}
                      onChange={(e) => updateSkill(skill.id, { name: e.target.value })}
                      disabled={readOnly}
                      className={`w-28 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      title="技能名称(便于在路径点辨认)"
                    />
                    <select
                      value={method}
                      onChange={(e) => {
                        const next = e.target.value as SkillCastMethod;
                        updateSkill(skill.id, { method: next });
                        // 改成非「物品使用」后,不能再作为生命回复的药品
                        if (next !== 'item') dropHealItem(skill.id);
                        // 改成非「宠物技能」后,不能再被宠物技能的引用(骑乘/打怪前技能)指向
                        if (next !== 'pet') dropPetRideSkill(skill.id);
                      }}
                      disabled={readOnly}
                      className={`w-24 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      title={CAST_METHOD_OPTIONS.find((o) => o.value === method)?.desc}
                    >
                      {CAST_METHOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => moveSkill(skill.id, -1)}
                          disabled={i === 0}
                          className="text-text-muted hover:text-text-primary disabled:opacity-30"
                          title="上移"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          onClick={() => moveSkill(skill.id, 1)}
                          disabled={i === skills.length - 1}
                          className="text-text-muted hover:text-text-primary disabled:opacity-30"
                          title="下移"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          onClick={() => removeSkill(skill.id)}
                          className="text-accent-red/70 hover:text-accent-red"
                          title="删除该技能(已绑定到路径点的引用会一并清掉)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* 第二行:参数 — 吟唱 / 施法距离只有「缺省施法」需要 */}
                  <div className="flex items-center gap-2 pl-7">
                    <span className="text-text-muted text-[10px] shrink-0">间隔</span>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={skill.cooldownMs}
                      onChange={(e) => updateSkill(skill.id, { cooldownMs: parseInt(e.target.value) || 0 })}
                      disabled={readOnly}
                      className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                      title="技能时间间隔(毫秒,两次释放之间的最短间隔)"
                    />
                    <span className="text-text-muted text-[10px]">ms</span>
                    {isTarget ? (
                      <>
                        <span className="text-text-muted text-[10px] shrink-0">吟唱</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={skill.castMs ?? 400}
                          onChange={(e) => updateSkill(skill.id, { castMs: parseInt(e.target.value) || 0 })}
                          disabled={readOnly}
                          className={`w-16 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                          title="吟唱时间(毫秒):按键后等多久再点鼠标"
                        />
                        <span className="text-text-muted text-[10px]">ms</span>
                        <span className="text-text-muted text-[10px] shrink-0">施法距离</span>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={skill.rangePx ?? 0}
                          onChange={(e) => updateSkill(skill.id, { rangePx: parseInt(e.target.value) || 0 })}
                          disabled={readOnly}
                          className={`w-16 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                          title="施法距离(屏幕像素,以角色为圆心):落点离自身的距离(0=用默认300px)"
                        />
                        <span className="text-text-muted text-[10px]">px</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-text-muted">
                        {method === 'quick'
                          ? '只按键,不需要吟唱/施法距离'
                          : method === 'item'
                            ? '只按快捷键使用物品,不需要吟唱/施法距离(可在下方「生命回复」里选用)'
                            : method === 'pet'
                              ? '只按键的宠物技能,不需要吟唱/施法距离(在下方「宠物技能」里选用)'
                              : '点角色自身 + 按键,不需要吟唱/施法距离'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          施法方式:快捷施法 = 只按键;缺省施法 = 按键 + 左键点击目标(定点打怪时点「移动反方向、 施法距离处」,定点识别时点已锁定的怪);状态施法
          = 点击角色自身 + 按键;物品使用 = 只按快捷键消耗快捷栏物品(血药等,可在下方「生命回复」里勾选);宠物技能 =
          只按键的宠物技能(不参与打怪,供下方「宠物技能」的骑乘/打怪前技能选择)。配好技能后,
          {castMode === 'smart'
            ? mode === 'fixed-detect'
              ? '定点识别 + 智能施法会在每个挂机点循环释放全部已配置技能,直到锁定的怪名消失,再重新识别'
              : '智能施法会在每个挂机点自动释放所有就绪的状态施法技能,并从其余技能里选一个可释放的'
            : '在下方"挂机点"类型的路径点上选择要释放的技能'}
          。定点识别也可以不配任何技能:不配 = 普通攻击(右键锁定后左键点一下)。技能键位:F1-F10 = 第一页,TF1-TF10 = 第二页(按一次 Tab
          在第一页/第二页之间切换;worker 放第二页技能时会「切到第二页 → 按 F 键 → 立刻切回第一页」,用完停在第一页)
        </div>
      </div>

      {/* 路径点(定点打怪按此循环:走到点 → 挂机点放技能;休息点/路径点只路过) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            路径点 <span className="text-text-muted text-[11px]">{castMode === 'custom' ? '(挂机点可选择释放的技能)' : ''}</span>
          </label>
          {!readOnly && (
            <button onClick={addWaypoint} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加点
            </button>
          )}
        </div>

        {/* 施法方式:智能施法(默认)= 到每个挂机点自动选一个可释放技能(CD 最长的);
            自定义施法 = 在每个挂机点上自己选择要释放的技能 */}
        <div className="flex items-center gap-4 mb-2 pl-0.5">
          {(
            [
              { value: 'smart', label: '智能施法' },
              { value: 'custom', label: '自定义施法' },
            ] as { value: FarmCastMode; label: string }[]
          ).map((o) => (
            <label
              key={o.value}
              className={`inline-flex items-center gap-1.5 text-xs ${readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="farm-cast-mode"
                className="accent-accent-cyan"
                disabled={readOnly}
                checked={castMode === o.value}
                onChange={() => setCastMode(o.value)}
              />
              <span className={castMode === o.value ? 'text-text-primary' : 'text-text-secondary'}>{o.label}</span>
            </label>
          ))}
          <span className="text-text-muted text-[10px]">
            {castMode === 'smart'
              ? mode === 'fixed-detect'
                ? '定点识别:到每个挂机点后循环释放全部已配置技能(各自按 CD,物品使用除外),直到锁定的怪名消失才停手,再重新 OCR 识别;识别不到怪后原地再等「挂机点停留时间」(默认 2 秒,等刷新),仍没有怪才前往下一个点'
                : '到每个挂机点,状态施法技能(CD 已好)一次性全部释放;其余技能自动选一个未冷却的释放(多个可释放时选 CD 最长的;都在冷却则跳过);物品使用技能不参与自动挑选(交给看门狗的「生命回复」)'
              : '在下方每个挂机点上勾选要释放的技能(不选 = 释放全部;物品使用需在此显式绑定)'}
          </span>
        </div>

        {waypoints.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs border border-dashed border-border-base rounded">暂无路径点</div>
        ) : (
          <div className="space-y-2">
            {waypoints.map((wp, i) => (
              <div key={wp.id} className="bg-bg-input p-2 rounded space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-[11px] w-5 text-center">#{i + 1}</span>
                  <select
                    value={wp.type}
                    onChange={(e) => {
                      const t = e.target.value;
                      // 从挂机点切成休息点/路径点时,清掉技能绑定(避免留下不可见的失效引用)
                      updateWaypoint(wp.id, 'type', t);
                      if (t !== 'farm-spot') updateWaypoint(wp.id, 'skillIds', []);
                    }}
                    disabled={readOnly}
                    className={`w-24 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                  >
                    <option value="farm-spot">挂机点</option>
                    <option value="rest">休息点</option>
                    <option value="path">路径点</option>
                    <option value="entry">入图点</option>
                  </select>
                  <span className="text-text-muted text-[10px]">X</span>
                  <input
                    type="number"
                    value={wp.x}
                    onChange={(e) => updateWaypoint(wp.id, 'x', parseInt(e.target.value) || 0)}
                    disabled={readOnly}
                    className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                  />
                  <span className="text-text-muted text-[10px]">Y</span>
                  <input
                    type="number"
                    value={wp.y}
                    onChange={(e) => updateWaypoint(wp.id, 'y', parseInt(e.target.value) || 0)}
                    disabled={readOnly}
                    className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                  />
                  <div className="flex-1" />
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => moveWaypoint(wp.id, -1)}
                        disabled={i === 0}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveWaypoint(wp.id, 1)}
                        disabled={i === waypoints.length - 1}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => removeWaypoint(wp.id)} className="text-accent-red/70 hover:text-accent-red">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>

                {/* 自定义施法:挂机点选择该点释放的技能(休息点/路径点不显示;智能施法下也不显示) */}
                {wp.type === 'farm-spot' && castMode === 'custom' && (
                  <div className="flex items-center gap-x-1.5 gap-y-1 pl-7 flex-wrap">
                    <span className="text-text-muted text-[10px] shrink-0 mr-0.5">释放技能</span>
                    {combatSkills.length === 0 ? (
                      <span className="text-[10px] text-text-muted">先在上方"技能设置"里添加技能(不选 = 到点释放全部技能)</span>
                    ) : (
                      <>
                        {combatSkills.map((s) => {
                          const checked = (wp.skillIds ?? []).includes(s.id);
                          const unavailable = s.enabled === false;
                          const method = s.method ?? 'target';
                          return (
                            <label
                              key={s.id}
                              title={`${s.key}${s.name ? ` ${s.name}` : ''}(${CAST_METHOD_OPTIONS.find((o) => o.value === method)?.label})`}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                                unavailable
                                  ? 'border-border-base/50 text-text-muted/50 cursor-not-allowed'
                                  : checked
                                    ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                                    : 'border-border-base text-text-secondary hover:border-border-active cursor-pointer'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="accent-accent-cyan"
                                disabled={readOnly || unavailable}
                                checked={checked}
                                onChange={(e) => {
                                  const cur = wp.skillIds ?? [];
                                  const next = e.target.checked ? [...cur, s.id] : cur.filter((sid) => sid !== s.id);
                                  updateWaypoint(wp.id, 'skillIds', next);
                                }}
                              />
                              <span>
                                {s.key}
                                {s.name ? `·${s.name}` : ''}
                              </span>
                            </label>
                          );
                        })}
                        {(wp.skillIds ?? []).length === 0 && <span className="text-[10px] text-text-muted">(不选 = 释放全部技能)</span>}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 入图点说明:死了回城再回来 / 开工补给从城镇回来时,落点在地图入口,离挂机点还有一段路 */}
        <div className="text-[10px] text-text-muted mt-1.5 pl-0.5">
          「入图点」= 回城补给/开工补给重新进入挂机地图后,从地图入口走到挂机点的途经点(按列表从上到下的顺序走)。
          入口到挂机点直线走会被地形/走廊卡住时,在这里按走过的路线补几个点;平时的挂机循环会跳过入图点
        </div>
        {waypoints.some((w) => w.type === 'entry') && !resupply.enabled && (
          <div className="text-[10px] text-accent-yellow/80 mt-1 pl-0.5">
            ⚠ 已配入图点,但「城市事件」没开启 —— 入图点只在回城/开工处理重新进图时才会走
          </div>
        )}
      </div>

      {/* 识别配置:只有需要识别的模式(定点识别/移动识别)才展示 */}
      {mode !== 'fixed' && (
        <>
          {/* 定点识别:OCR 识别范围(x,y,w,h) */}
          {mode === 'fixed-detect' && (
            <div>
              <label className="text-sm text-text-secondary mb-1.5 block">
                OCR 识别范围 <span className="text-text-muted text-[11px]">(窗口客户区坐标 x / y / 宽 / 高;宽高留 0 = 整个游戏画面)</span>
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                {(
                  [
                    ['x', 'X'],
                    ['y', 'Y'],
                    ['w', '宽 W'],
                    ['h', '高 H'],
                  ] as [keyof ScreenRect, string][]
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1">
                    <span className="text-text-muted text-[10px] shrink-0">{label}</span>
                    <input
                      type="number"
                      min={0}
                      value={ocrRange[key]}
                      onChange={(e) => setOcrRange({ ...ocrRange, [key]: Math.max(0, parseInt(e.target.value) || 0) })}
                      disabled={readOnly}
                      className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                    />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-text-muted mt-1">在这块区域里 OCR 找怪名(配合下面的颜色);范围越小识别越快、越准</div>
            </div>
          )}

          {/* 定点识别:点击怪名的偏移 */}
          {mode === 'fixed-detect' && (
            <div>
              <label className="text-sm text-text-secondary mb-1.5 block">
                点击偏移 <span className="text-text-muted text-[11px]">(像素;默认 0,0 = 点在怪名上)</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-text-muted text-[10px] shrink-0">X</span>
                  <input
                    type="number"
                    value={clickOffset.x}
                    onChange={(e) => setClickOffset({ ...clickOffset, x: parseInt(e.target.value) || 0 })}
                    disabled={readOnly}
                    className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-text-muted text-[10px] shrink-0">Y</span>
                  <input
                    type="number"
                    value={clickOffset.y}
                    onChange={(e) => setClickOffset({ ...clickOffset, y: parseInt(e.target.value) || 0 })}
                    disabled={readOnly}
                    className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                  />
                </div>
              </div>
              <div className="text-[10px] text-text-muted mt-1">点击怪名(右键锁定 / 左键攻击)时的偏移;点不到怪时再往下 / 往右调一点</div>
            </div>
          )}

          {/* 怪名颜色(OCR / 找字用):多选 tag + 自定义色值 */}
          <div>
            <label className="text-sm text-text-secondary mb-1.5 block">
              怪名颜色 <span className="text-text-muted text-[11px]">(可多选;OCR / 找字按这些颜色识别)</span>
            </label>
            <ColorTagPicker options={MONSTER_COLOR_OPTIONS} value={mobNameColors} onChange={setMobNameColors} readOnly={readOnly} />
            <div className="text-[10px] text-text-muted mt-1">
              对应 core/constant-ocr/color.ts;多选时拼成一个颜色串(任一颜色命中即算),颜色越多识别越慢。
              不确定就先选「白色」,识别不到再换/再加别的颜色
            </div>
          </div>

          {/* 找怪关键字(可选) */}
          <div>
            <label className="text-sm text-text-secondary mb-1.5 block">
              找怪关键字 <span className="text-text-muted text-[11px]">(可选,逗号分隔;留空 = 纯 OCR)</span>
            </label>
            <input
              type="text"
              value={nameKeywords}
              onChange={(e) => setNameKeywords(e.target.value)}
              placeholder="留空 = 范围内识别到的任意文字都算怪名"
              disabled={readOnly}
              className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
            />
            <div className="text-[10px] text-text-muted mt-1">
              定点识别:配了关键字 = 只认含关键字的怪名(用找字定位,更快更准);留空 = 纯 OCR 识别
            </div>
          </div>
        </>
      )}

      {/* 走位点击间隔 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          走位点击间隔 <span className="text-text-muted text-[11px]">(毫秒,沿路径点走位时每次点击移动的间隔)</span>
        </label>
        <input
          type="number"
          min={100}
          step={100}
          value={moveStepIntervalMs}
          onChange={(e) => setMoveStepIntervalMs(parseInt(e.target.value) || 800)}
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
        />
        <div className="text-[10px] text-text-muted mt-1">
          每点一次地面(走一步)后等多久再读坐标纠偏;调小 = 走位更频繁、更贴点(如 500),调大 = 走位更省(如 1000)
          <br />
          只影响挂机点之间的走位,不影响角色实际移速,也不影响过图/回城那些段落
        </div>
      </div>

      {/* 挂机点停留时间(定点识别) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          挂机点停留时间 <span className="text-text-muted text-[11px]">(毫秒;仅「定点识别」生效)</span>
        </label>
        <input
          type="number"
          min={0}
          step={500}
          value={spotIdleMs}
          onChange={(e) => setSpotIdleMs(parseInt(e.target.value) || 0)}
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
        />
        <div className="text-[10px] text-text-muted mt-1">
          在挂机点连续这么久没锁定到怪(打光了 / 没刷出来)就前往下一个路径点;填 0 = 不设置(用默认 2000ms)
          <br />
          怪刷得慢、想多点时间等刷新就调大,免得空等
        </div>
      </div>

      {/* 路径点卡住:跳过 / 不跳过 */}
      <div>
        <label className="inline-flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent-cyan"
            disabled={readOnly}
            checked={skipStuckWaypoint}
            onChange={(e) => setSkipStuckWaypoint(e.target.checked)}
          />
          <span>路径点卡住时跳过该点</span>
        </label>
        <div className="text-[10px] text-text-muted mt-1">
          {skipStuckWaypoint
            ? '默认:走不到的点(坐标一直没变化)记一条日志就跳过,本点的技能也不放'
            : '取消勾选 = 不跳过:走不到的点会在该点周围 10 像素内随机点一下尽量就近落脚,并照常执行该点的技能'}
        </div>
      </div>

      {/* 物品拾取:挂机期间在打怪间隙捡地上的掉落物(不打断施法) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          物品拾取 <span className="text-text-muted text-[11px]">(捡掉落物优先;正在打的怪也会先放下)</span>
        </label>
        <div className="space-y-2.5 bg-bg-input/40 border border-border-base rounded p-2.5">
          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={!!pickup.enabled}
              onChange={(e) => setPickup((p) => ({ ...p, enabled: e.target.checked }))}
            />
            <span>开启物品拾取</span>
            <span className="text-text-muted text-[10px]">识别到可拾取物品时左键点击拾取,直到物品名字消失</span>
          </label>

          {pickup.enabled && (
            <>
              {/* 拾取范围:默认 / 自定义 */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xs text-text-secondary">拾取范围</span>
                  {(
                    [
                      { value: 'default', label: '默认' },
                      { value: 'custom', label: '自定义' },
                    ] as { value: 'default' | 'custom'; label: string }[]
                  ).map((o) => (
                    <label key={o.value} className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                      <input
                        type="radio"
                        name="pickup-range-mode"
                        className="accent-accent-cyan"
                        disabled={readOnly}
                        checked={(pickup.rangeMode ?? 'default') === o.value}
                        onChange={() => setPickup((p) => ({ ...p, rangeMode: o.value }))}
                      />
                      <span className={(pickup.rangeMode ?? 'default') === o.value ? 'text-text-primary' : 'text-text-secondary'}>
                        {o.label}
                      </span>
                    </label>
                  ))}
                </div>
                {(pickup.rangeMode ?? 'default') === 'custom' ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    {(
                      [
                        ['x', 'X'],
                        ['y', 'Y'],
                        ['w', '宽 W'],
                        ['h', '高 H'],
                      ] as [keyof ScreenRect, string][]
                    ).map(([key, label]) => (
                      <div key={key} className="flex items-center gap-1">
                        <span className="text-text-muted text-[10px] shrink-0">{label}</span>
                        <input
                          type="number"
                          min={0}
                          value={pickup.range?.[key] ?? 0}
                          onChange={(e) => setPickupRange(key, Math.max(0, parseInt(e.target.value) || 0))}
                          disabled={readOnly}
                          className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-text-muted">默认 = 整个游戏画面去掉上下 UI 边距(顶部头像/血条、底部技能栏)</div>
                )}
              </div>

              {/* 拾取规则:每条 = 颜色(可多选)+ 名称(可空),规则之间是「或」 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-text-secondary">
                    拾取规则{' '}
                    <span className="text-text-muted text-[10px]">
                      (每条规则 = 颜色 + 名称,满足任一条就捡;名称留空 = 这个颜色的所有物品)
                    </span>
                  </div>
                  {!readOnly && (
                    <button onClick={addPickupRule} className="text-xs btn btn-secondary flex items-center gap-1">
                      <Plus size={12} />
                      添加规则
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {pickup.rules.map((rule, i) => (
                    <div key={i} className="bg-bg-input/60 border border-border-base rounded p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-text-muted">规则 {i + 1}</span>
                        {!readOnly && pickup.rules.length > 1 && (
                          <button
                            onClick={() => removePickupRule(i)}
                            title="删除这条规则"
                            className="text-text-muted hover:text-accent-red"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>

                      <div>
                        <div className="text-[11px] text-text-secondary mb-1">
                          颜色 <span className="text-text-muted text-[10px]">(可多选;不选 = 不限颜色)</span>
                        </div>
                        <ColorTagPicker
                          options={PICKUP_COLOR_OPTIONS}
                          value={rule.colors}
                          onChange={(v) => updatePickupRule(i, { colors: v })}
                          readOnly={readOnly}
                        />
                      </div>

                      <div>
                        <div className="text-[11px] text-text-secondary mb-1">
                          物品名称 <span className="text-text-muted text-[10px]">(可选,逗号分隔)</span>
                        </div>
                        <input
                          type="text"
                          value={rule.nameKeywords}
                          onChange={(e) => updatePickupRule(i, { nameKeywords: e.target.value })}
                          placeholder="留空 = 这个颜色的所有物品都要;填了 = 只捡这些名字"
                          disabled={readOnly}
                          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-[10px] text-text-muted mt-1">
                  颜色值对应 core/constant-ocr/color.ts 的品质色。名称填了就用「找字」定位(依赖字库收录这些字), 留空就用「找色」只认颜色。
                  <br />
                  例:要捡「所有紫色装备 + 蓝色装备里只捡无极剑」→ 配两条规则: 规则1 只勾紫色、名称留空;规则2 只勾蓝色、名称填「无极剑」
                </div>
              </div>

              {/* 点击偏移 */}
              <div>
                <div className="text-xs text-text-secondary mb-1">
                  点击偏移 <span className="text-text-muted text-[10px]">(像素;默认 0,0 = 点在物品名上)</span>
                </div>
                <div className="flex items-center gap-3">
                  {(['x', 'y'] as const).map((key) => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="text-text-muted text-[10px] shrink-0">{key.toUpperCase()}</span>
                      <input
                        type="number"
                        value={pickup.clickOffset[key] ?? 0}
                        onChange={(e) =>
                          setPickup((p) => ({
                            ...p,
                            clickOffset: { ...p.clickOffset, [key]: parseInt(e.target.value) || 0 },
                          }))
                        }
                        disabled={readOnly}
                        className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-text-muted mt-1">点物品名字捡不动时再调(和「怪名点击偏移」同理)</div>
              </div>

              {pickupRuleEmpty && (
                <div className="text-[10px] text-accent-yellow/80">
                  所有规则都既没选颜色也没填名称 = 物品拾取不生效,请至少给一条规则配点东西
                </div>
              )}
            </>
          )}

          <div className="text-[10px] text-text-muted">
            拾取优先:定点识别里每轮先捡一次,正在打的怪也会先放下(捡东西要走位,会丢掉锁定,
            下一轮重新识别);走在路径点之间也会捡。一轮把能捡的都捡完再继续下一个动作; 不打断正在释放的那一个技能;单件点 2
            次仍没捡起来就跳过这件,不会卡死
          </div>
        </div>
      </div>

      {/* 看门狗:挂机期间并发执行的检查(四项全不勾 = worker 不启动看门狗,不产生额外开销) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          看门狗 <span className="text-text-muted text-[11px]">(组队申请 / 神医验证码 / 生命回复 / 角色停级;全不勾 = 不启动)</span>
        </label>
        <div className="space-y-2.5 bg-bg-input/40 border border-border-base rounded p-2.5">
          {/* 组队申请:勾选后再选 同意 / 拒绝 */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent-cyan"
                disabled={readOnly}
                checked={!!watchdog.teamInvite}
                onChange={(e) =>
                  setWatchdog((w) => ({
                    ...w,
                    teamInvite: e.target.checked ? { action: w.teamInvite?.action ?? 'reject' } : undefined,
                  }))
                }
              />
              <span>组队申请</span>
            </label>
            {watchdog.teamInvite && (
              <>
                {(
                  [
                    { value: 'agree', label: '同意' },
                    { value: 'reject', label: '拒绝' },
                  ] as { value: TeamInviteAction; label: string }[]
                ).map((o) => (
                  <label key={o.value} className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                    <input
                      type="radio"
                      name="team-invite-action"
                      className="accent-accent-cyan"
                      disabled={readOnly}
                      checked={watchdog.teamInvite?.action === o.value}
                      onChange={() => setWatchdog((w) => ({ ...w, teamInvite: { action: o.value } }))}
                    />
                    <span className={watchdog.teamInvite?.action === o.value ? 'text-text-primary' : 'text-text-secondary'}>{o.label}</span>
                  </label>
                ))}
                <span className="text-text-muted text-[10px]">收到邀请弹框时自动点击</span>
              </>
            )}
          </div>

          {/* 神医验证码 */}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={watchdog.verifyCode === true}
              onChange={(e) => setWatchdog((w) => ({ ...w, verifyCode: e.target.checked }))}
            />
            <span>神医验证码验证</span>
            <span className="text-text-muted text-[10px]">弹出「神医问题来啦」时自动识别作答(需在设置里配图鉴账号)</span>
          </label>

          {/* 生命回复:药品来自「技能设置」里「物品使用」的条目 */}
          <div className="space-y-1">
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent-cyan"
                disabled={readOnly}
                checked={!!watchdog.autoHeal}
                onChange={(e) =>
                  setWatchdog((w) => ({
                    ...w,
                    autoHeal: e.target.checked ? { itemIds: w.autoHeal?.itemIds ?? [] } : undefined,
                  }))
                }
              />
              <span>生命回复</span>
              <span className="text-text-muted text-[10px]">血条见底时自动使用下列药品</span>
            </label>
            {watchdog.autoHeal && (
              <div className="pl-6 space-y-1">
                {itemSkills.length === 0 ? (
                  <div className="text-[10px] text-text-muted">
                    先在上方「技能设置」里添加施法方式为「物品使用」的药品(与它共用快捷栏配置)
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                      <span className="text-text-muted text-[10px] shrink-0">回血药品</span>
                      {itemSkills.map((s) => {
                        const checked = autoHealIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            title={`${s.key}${s.name ? ` ${s.name}` : ''} 间隔 ${s.cooldownMs}ms`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                              checked
                                ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                                : 'border-border-base text-text-secondary hover:border-border-active cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="accent-accent-cyan"
                              disabled={readOnly}
                              checked={checked}
                              onChange={(e) =>
                                setWatchdog((w) => {
                                  const cur = w.autoHeal?.itemIds ?? [];
                                  return {
                                    ...w,
                                    autoHeal: {
                                      itemIds: e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                                    },
                                  };
                                })
                              }
                            />
                            <span>
                              {s.key}
                              {s.name ? `·${s.name}` : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {autoHealIds.length === 0 && <div className="text-[10px] text-accent-yellow/80">未选择药品 = 生命回复不生效</div>}
                    <div className="text-[10px] text-text-muted">
                      按勾选顺序依次尝试,使用第一个 CD 已好的药品(CD 用技能设置里的「间隔」, 与打怪循环共用同一份冷却记录)
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 角色停级 */}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={watchdog.stopLevelUp === true}
              onChange={(e) => setWatchdog((w) => ({ ...w, stopLevelUp: e.target.checked }))}
            />
            <span>角色停级</span>
            <span className="text-text-muted text-[10px]">经验条快满时停止自动打怪,避免角色升级</span>
          </label>

          <div className="text-[10px] text-text-muted">看门狗与打怪循环并发运行;四项全部不勾选时 worker 不会启动看门狗</div>
        </div>
      </div>

      {/* 进入新地图时屏蔽所有人:worker 检测到换图就按 F11×4(见 shared/game-hotkeys.ts) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          其他 <span className="text-text-muted text-[11px]">(与挂机循环并行的环境处理)</span>
        </label>
        <div className="bg-bg-input/40 border border-border-base rounded p-2.5 space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={blockAllPlayersOnNewMap}
              onChange={(e) => setBlockAllPlayersOnNewMap(e.target.checked)}
            />
            <span>进入新地图时屏蔽所有人</span>
            <span className="text-text-muted text-[10px]">
              每进入一张新地图(含回城补给返回挂机图)自动按一次 F11×4,把其他玩家的名字/模型屏蔽掉
            </span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={zoomOutMinimap}
              onChange={(e) => setZoomOutMinimap(e.target.checked)}
            />
            <span>小地图缩放</span>
            <span className="text-text-muted text-[10px]">任务启动时按一次 Alt+- 把右上角小地图缩小(地图放大 Alt++)</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={closeChatBackground}
              onChange={(e) => setCloseChatBackground(e.target.checked)}
            />
            <span>关闭聊天背景</span>
            <span className="text-text-muted text-[10px]">任务启动时点击聊天框(11,727)一次,关掉聊天背景</span>
          </label>
        </div>
      </div>

      {/* 地图跨越:出发图 → 挂机图之间依次穿越的中间地图(引用「过图路线」) */}
      <MapCrossingsSection readOnly={readOnly} value={mapCrossings} onChange={setMapCrossings} mapProfileNames={mapProfileNames} />

      {/* 辅助配置:勾选要启用的辅助配置(引用「宠物带练」这类辅助配置型任务) */}
      <FarmAuxSection readOnly={readOnly} value={auxConfigNames} onChange={setAuxConfigNames} options={farmAuxOptions} />

      {/* 城市事件:死亡后复活回城 / 开工前先处理一遍 → 按城镇档案(检查项 + 商人 NPC)→ 走到出城口返回野外 */}
      <FarmResupplySection
        readOnly={readOnly}
        value={resupply}
        onChange={setResupply}
        townProfileNames={townProfileNames}
        recipeIssue={recipeIssue}
      />

      {/* 宠物技能:回城后检查宠物激活并上骑,到挂机点下骑;打怪前按需再开启宠物技能 */}
      <FarmPetRideSection readOnly={readOnly} value={petRide} onChange={setPetRide} petSkills={petSkills} />

      {/* 回城卷轴:起点在野外/任意地图时,先按卷轴回主城,再前往挂机图 */}
      <FarmReturnScrollSection readOnly={readOnly} value={returnScroll} onChange={setReturnScroll} itemSkills={itemSkills} />

      {/* 条件回城:完成 N 圈后结束本轮打怪 → 回城处理 → 回挂机图继续下一轮 */}
      <FarmEndReturnSection
        readOnly={readOnly}
        value={endReturn}
        onChange={setEndReturn}
        returnScrollIssue={returnScrollIssue}
        colorOptions={MONSTER_COLOR_OPTIONS}
        farmMobFilter={{ ocrRange, nameColors: mobNameColors, nameKeywords }}
      />

      {/* 备注 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">备注(可选)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan resize-none ${disabledCls}`}
          placeholder="备注这个任务的特殊事项..."
        />
      </div>
    </div>
  );
}

// ---- 缺省技能配置子组件 ----

interface DefaultSkillConfigProps {
  readOnly?: boolean;
  steps: DefaultSkillStep[];
  setSteps: (v: DefaultSkillStep[] | ((prev: DefaultSkillStep[]) => DefaultSkillStep[])) => void;
  loopCount: number;
  setLoopCount: (v: number) => void;
  loopIntervalMs: number;
  setLoopIntervalMs: (v: number) => void;
  note: string;
  setNote: (v: string) => void;
}

function DefaultSkillConfig(props: DefaultSkillConfigProps) {
  const { readOnly = false, steps, setSteps, loopCount, setLoopCount, loopIntervalMs, setLoopIntervalMs, note, setNote } = props;

  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

  const addStep = () => {
    if (readOnly) return;
    const newStep: DefaultSkillStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      key: 'F1',
      intervalMs: 1000,
      holdMs: 50,
      enabled: true,
    };
    setSteps((ss) => [...ss, newStep]);
  };

  const removeStep = (id: string) => {
    if (readOnly) return;
    setSteps((ss) => ss.filter((s) => s.id !== id));
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    setSteps((ss) => {
      const idx = ss.findIndex((s) => s.id === id);
      if (idx < 0) return ss;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= ss.length) return ss;
      const next = [...ss];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const updateStep = (id: string, patch: Partial<DefaultSkillStep>) => {
    if (readOnly) return;
    setSteps((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  // 单轮估算:每个 step 的 (holdMs + intervalMs)
  const totalMsPerLoop = steps.reduce((sum, s) => sum + (s.holdMs ?? 50) + (s.enabled === false ? 0 : s.intervalMs), 0);

  return (
    <div className="space-y-5">
      {/* 顶部说明 */}
      <div className="rounded border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-[12px] text-text-secondary space-y-1">
        <div className="flex items-center gap-2">
          <Keyboard size={14} className="text-accent-cyan" />
          <span className="font-medium text-text-primary">按键编排</span>
        </div>
        <div>按数组顺序执行,跑完一轮后等待轮间间隔再开始下一轮。可临时禁用某步骤而不删除。</div>
        <div className="text-text-muted">
          支持 <span className="font-mono text-accent-cyan">F1-F12</span>、<span className="font-mono text-accent-cyan"> Alt+F1-F12</span>、
          <span className="font-mono text-accent-cyan"> Shift+F1-F10</span>
        </div>
      </div>

      {/* 步骤列表 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            步骤列表 <span className="text-text-muted text-[11px]">(按顺序执行)</span>
          </label>
          {!readOnly && (
            <button onClick={addStep} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加步骤
            </button>
          )}
        </div>

        {steps.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无步骤,点"添加步骤"开始编排
          </div>
        ) : (
          <div className="space-y-1.5">
            {steps.map((step, i) => {
              const valid = isValidKeyCombo(step.key);
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-1.5 bg-bg-input p-1.5 rounded ${step.enabled === false ? 'opacity-50' : ''}`}
                >
                  <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={step.enabled !== false}
                      onChange={(e) => updateStep(step.id, { enabled: e.target.checked })}
                      title="启用 / 临时禁用"
                      className="accent-accent-cyan"
                    />
                  )}
                  <select
                    value={valid ? step.key : '__invalid__'}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__invalid__') return;
                      updateStep(step.id, { key: v });
                    }}
                    disabled={readOnly}
                    className={`bg-bg-card border rounded px-1.5 py-0.5 text-xs outline-none ${
                      valid ? 'border-border-base' : 'border-accent-red'
                    } ${disabledCls}`}
                    title={valid ? `已选: ${step.key}` : `不支持的按键: ${step.key}`}
                  >
                    {!valid && <option value="__invalid__">{step.key} (不支持)</option>}
                    {ALL_KEY_COMBOS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <span className="text-text-muted text-[10px]">间隔</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={step.intervalMs}
                    onChange={(e) => updateStep(step.id, { intervalMs: parseInt(e.target.value) || 0 })}
                    disabled={readOnly}
                    className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                    title="抬起主键后到下一次按键的间隔(毫秒)"
                  />
                  <span className="text-text-muted text-[10px]">ms</span>
                  <span className="text-text-muted text-[10px]">按住</span>
                  <input
                    type="number"
                    min={10}
                    step={10}
                    value={step.holdMs ?? 50}
                    onChange={(e) => updateStep(step.id, { holdMs: parseInt(e.target.value) || 50 })}
                    disabled={readOnly}
                    className={`w-16 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                    title="按键按住的时长(毫秒,默认 50ms)"
                  />
                  <span className="text-text-muted text-[10px]">ms</span>
                  <input
                    type="text"
                    placeholder="备注"
                    value={step.note || ''}
                    onChange={(e) => updateStep(step.id, { note: e.target.value })}
                    disabled={readOnly}
                    className={`flex-1 min-w-0 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                  />
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => moveStep(step.id, -1)}
                        disabled={i === 0}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                        title="上移"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveStep(step.id, 1)}
                        disabled={i === steps.length - 1}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                        title="下移"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => removeStep(step.id)} className="text-accent-red/70 hover:text-accent-red" title="删除该步骤">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 循环参数 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-text-secondary mb-1.5 block">循环次数</label>
          <input
            type="number"
            min={0}
            step={1}
            value={loopCount}
            onChange={(e) => setLoopCount(parseInt(e.target.value) || 0)}
            disabled={readOnly}
            className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
            placeholder="0 = 无限"
          />
          <div className="text-[10px] text-text-muted mt-1">0 = 无限循环(直到点停止)</div>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1.5 block">轮间间隔(毫秒)</label>
          <input
            type="number"
            min={0}
            step={100}
            value={loopIntervalMs}
            onChange={(e) => setLoopIntervalMs(parseInt(e.target.value) || 0)}
            disabled={readOnly}
            className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
          />
          <div className="text-[10px] text-text-muted mt-1">一轮跑完到下一轮的等待时间</div>
        </div>
      </div>

      {/* 单轮时长估算 */}
      {steps.length > 0 && (
        <div className="text-[11px] text-text-muted bg-bg-input/50 rounded px-3 py-1.5">
          估算单轮时长:
          <span className="font-mono text-accent-cyan ml-1">{(totalMsPerLoop / 1000).toFixed(2)}s</span>
          <span className="ml-2">
            ({steps.length} 步 × 平均 {steps.length > 0 ? Math.round(totalMsPerLoop / steps.length) : 0}ms)
          </span>
        </div>
      )}

      {/* 备注 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">备注(可选)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan resize-none ${disabledCls}`}
          placeholder="备注这个任务的特殊事项..."
        />
      </div>
    </div>
  );
}
