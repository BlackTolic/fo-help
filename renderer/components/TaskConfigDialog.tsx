// 任务配置对话框
// 两步:1.选任务类型(可从历史任务加载) 2.配置参数(挂机打怪详细,其他留白)

import { useState, useEffect } from 'react';
import { X, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Check, History, Keyboard } from 'lucide-react';
import type {
  TaskType,
  TaskConfig,
  FarmTaskConfig,
  FarmSkillConfig,
  FarmMode,
  FarmCastMode,
  FarmWatchdogConfig,
  FarmPickupConfig,
  SkillCastMethod,
  TeamInviteAction,
  Waypoint,
  StoredTaskConfig,
  DefaultSkillTaskConfig,
  DefaultSkillStep,
  ScreenRect,
} from '../../shared/types';
import { ALL_KEY_COMBOS, isValidKeyCombo } from '../../shared/key-combo';
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
];

const FARM_MAPS = [
  { id: 'chang-an', name: '长安城周边' },
  { id: 'hu-ya-shan', name: '狐牙山' },
  { id: 'xue-yuan', name: '雪原' },
  { id: 'sha-mo', name: '沙漠' },
  { id: 'lan-yue', name: '蓝月谷' },
  { id: 'tian-yuan', name: '桃源村' },
  { id: 'custom', name: '自定义...' },
];

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
   * 编辑历史任务时锁定任务名。设了之后:
   * - taskName 默认填这个值,且 name 步骤里 input disabled
   * - onSaved 收到的是该值,用户改不动
   * (新建设置空,允许改名)
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
  /** "保存配置"按钮:持久化到磁盘(返回 Promise,失败时 dialog 保持打开) */
  onSaved: (config: TaskConfig, name: string) => Promise<{ ok: boolean; error?: string }> | void;
  /** "确认"按钮:仅写内存,关闭 app 丢(不传 = 隐藏按钮,如只读模式) */
  onConfirm?: (config: TaskConfig) => void;
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
}: Props) {
  const [step, setStep] = useState<'select' | 'config' | 'name'>(initialConfig ? 'config' : 'select');
  const [taskName, setTaskName] = useState(initialTaskName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  // config 步骤直接保存(编辑模式)的错误显示 — name 步骤走的是 nameError,这里独立
  const [saveError, setSaveError] = useState<string | null>(null);
  // 编辑模式直接保存时的 loading,防用户连点
  const [saving, setSaving] = useState(false);
  const [taskType, setTaskType] = useState<TaskType | null>(initialConfig?.type ?? null);
  // 内嵌"历史任务"弹窗(只读模式下不显示入口)
  const [historyOpen, setHistoryOpen] = useState(false);
  // 历史任务列表(全局,store.taskHistory)
  const taskHistory = useStore((s) => s.taskHistory);

  // 挂机打怪配置
  const [mapId, setMapId] = useState('hu-ya-shan');
  const [customMapName, setCustomMapName] = useState('');
  const [mode, setMode] = useState<FarmMode>('fixed');
  // 施法方式:智能施法(默认)= 到挂机点自动选一个可释放技能;自定义 = 按路径点绑定技能释放
  const [castMode, setCastMode] = useState<FarmCastMode>('smart');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  // 找怪关键字:定点识别下留空 = 纯 OCR(范围内任意文字都算怪名),不强制默认值
  const [nameKeywords, setNameKeywords] = useState('');
  // 找怪相关:怪名颜色(多选) / 定点识别的 OCR 范围与点击偏移 / 任务级技能列表 / 角色移动间隔
  const [mobNameColors, setMobNameColors] = useState<string[]>([COLOR_WHITE]);
  const [ocrRange, setOcrRange] = useState<ScreenRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [clickOffset, setClickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [skills, setSkills] = useState<FarmSkillConfig[]>([]);
  const [moveStepIntervalMs, setMoveStepIntervalMs] = useState(400);
  // 看门狗:组队申请 / 神医验证码 / 生命回复 / 角色停级;全空 = worker 不启动看门狗
  const [watchdog, setWatchdog] = useState<FarmWatchdogConfig>(DEFAULT_WATCHDOG);
  // 物品拾取:打怪间隙捡掉落物(范围/颜色/名称;关掉 = worker 不产生任何扫描开销)
  const [pickup, setPickup] = useState<PickupUiState>(DEFAULT_PICKUP);
  const [note, setNote] = useState('');

  // 缺省技能配置
  const [skillSteps, setSkillSteps] = useState<DefaultSkillStep[]>([]);
  const [skillLoopCount, setSkillLoopCount] = useState(0); // 0 = 无限
  const [skillLoopIntervalMs, setSkillLoopIntervalMs] = useState(1000);
  const [skillNote, setSkillNote] = useState('');

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
      setSkills(
        (farm.skills || []).map((s) => ({
          ...s,
          name: s.name || '',
          method: s.method ?? 'target',
          castMs: s.castMs ?? 400,
          rangePx: s.rangePx ?? 0,
        })),
      );
      setMoveStepIntervalMs(farm.movementSpeed ?? 800);
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
      setNote(farm.note || '');
    } else if (cfg.type === 'default-skill') {
      const skill = cfg as DefaultSkillTaskConfig;
      setSkillSteps(skill.steps || []);
      setSkillLoopCount(skill.loopCount ?? 0);
      setSkillLoopIntervalMs(skill.loopIntervalMs ?? 1000);
      setSkillNote(skill.note || '');
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
        movementSpeed: Math.max(100, moveStepIntervalMs | 0),
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
    return { type: taskType } as any;
  };

  /**
   * "保存配置"按钮(footer):
   * - 新建模式 → 跳到 name 步骤让用户起名字(Electron 不支持 window.prompt)
   * - 编辑模式(initialTaskName) → 名字已锁定,跳过 name,**直接调 onSaved 持久化**
   *   失败时 setSaveError 在 config 步骤顶部展示红色 banner
   *   成功由父组件(HistoryTaskDialog)关 dialog + 刷新 history 列表
   */
  const handleSave = async () => {
    if (readOnly || saving) return;
    setSaveError(null);
    if (initialTaskName) {
      // 编辑历史任务:跳过命名步骤,直接持久化(不启动 worker)
      setSaving(true);
      try {
        const config = buildConfig();
        const res = await onSaved(config, initialTaskName);
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
   * 从历史任务加载:把 cfg 灌进 dialog state
   * - farm / default-skill:全字段回显 + 跳 step 2
   * - 其他:只设置 type,跳 step 2
   */
  const handleHistoryApply = (stored: StoredTaskConfig) => {
    setHistoryOpen(false);
    const cfg = stored.config;
    applyConfig(cfg);
    setTaskType(cfg.type);
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
              {/* 历史任务入口(放在选任务类型之前,只读模式下不显示) */}
              {!readOnly && taskHistory.length > 0 && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="w-full mb-3 p-2.5 rounded border border-accent-cyan/40 bg-accent-cyan/10 hover:bg-accent-cyan/20 flex items-center gap-2 text-sm transition-colors"
                  title="从已保存的任务列表中加载配置"
                >
                  <History size={14} className="text-accent-cyan" />
                  <span className="font-medium">从历史任务中选择</span>
                  <span className="ml-auto text-[11px] text-text-muted">{taskHistory.length} 条</span>
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                {TASK_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    disabled={!opt.ready}
                    onClick={() => {
                      if (opt.ready) {
                        setTaskType(opt.type);
                        setStep('config');
                      }
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
              watchdog={watchdog}
              setWatchdog={setWatchdog}
              pickup={pickup}
              setPickup={setPickup}
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

          {step === 'config' && taskType && taskType !== 'farm' && taskType !== 'default-skill' && (
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
                  <span className="text-sm font-medium">为这个任务起个名字</span>
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
                  readOnly={!!initialTaskName}
                  disabled={!!initialTaskName}
                  title={initialTaskName ? '编辑模式下任务名锁定' : ''}
                  className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {nameError && <div className="text-[11px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">{nameError}</div>}
                <div className="text-[11px] text-text-muted">💡 保存后该任务会出现在"历史任务"列表,可以复用到其他窗口</div>
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
          <HistoryTaskDialog history={taskHistory} currentHwnd={hwnd} onClose={() => setHistoryOpen(false)} onApply={handleHistoryApply} />
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
                    setStep('select');
                    setTaskType(null);
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
                  {/* "保存配置" / "确定"按钮:持久化到磁盘
                      - 新建模式:文案"保存配置",会跳到 name 步骤让用户起名字
                      - 编辑模式(initialTaskName):文案"确定",直接保存 + 关闭 */}
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="btn btn-secondary flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={initialTaskName ? '保存修改后的历史任务(不启动 worker)' : '执行并保存当前任务，以便下次直接在“历史任务”中使用'}
                  >
                    {initialTaskName ? (saving ? '保存中...' : '确定') : '存为记忆'}
                  </button>
                  {/* "确认"按钮:仅写内存,不持久化(关闭 app 丢,新流程会启动 worker) */}
                  {onConfirm && (
                    <button
                      onClick={handleConfirm}
                      className="btn btn-secondary flex items-center gap-1.5"
                      title="不保存到磁盘,只在当前会话记住这个配置(关 app 后丢)"
                    >
                      确认
                    </button>
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

/** 技能可选键(F1-F10,与 worker 的 MoveAttackSkill.key 对应) */
const SKILL_KEY_OPTIONS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];

/** 施法方式选项 */
const CAST_METHOD_OPTIONS: { value: SkillCastMethod; label: string; desc: string }[] = [
  { value: 'quick', label: '快捷施法', desc: '只按技能键' },
  { value: 'target', label: '缺省施法', desc: '按键 + 左键点击目标坐标' },
  { value: 'self', label: '状态施法', desc: '点击角色自身 + 按键' },
  { value: 'item', label: '物品使用', desc: '只按快捷键使用快捷栏物品(可由「生命回复」按血量自动使用)' },
];

/** 新建任务时的看门狗默认值:只开验证码(与升级前行为一致,其余项按需勾选) */
const DEFAULT_WATCHDOG: FarmWatchdogConfig = { verifyCode: true };

interface ColorTagPickerProps {
  /** 预设颜色标签 */
  options: { value: string; label: string }[];
  /** 已选颜色(大漠颜色描述符) */
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
}

/**
 * 颜色多选(tag 标签 + 自定义色值)
 * 值是「主色-偏色」格式的大漠颜色描述符(见 core/constant-ocr/color.ts);
 * 不在预设里的值(旧配置 / 自定义)也渲染成标签,可以单独删掉。
 * 怪名颜色与物品拾取颜色共用这一个控件,只是传入的预设列表不同。
 */
function ColorTagPicker({ options, value, onChange, readOnly = false }: ColorTagPickerProps) {
  const [custom, setCustom] = useState('');

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const addCustom = () => {
    const v = custom.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setCustom('');
  };
  const extras = value.filter((v) => !options.some((o) => o.value === v));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              title={o.value}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                checked
                  ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                  : 'border-border-base text-text-secondary hover:border-border-active cursor-pointer'
              } ${readOnly ? 'cursor-default' : ''}`}
            >
              <input
                type="checkbox"
                className="accent-accent-cyan"
                disabled={readOnly}
                checked={checked}
                onChange={() => toggle(o.value)}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
        {extras.map((v) => (
          <span
            key={v}
            title={v}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan text-[11px] font-mono"
          >
            {v}
            {!readOnly && (
              <button onClick={() => onChange(value.filter((x) => x !== v))} title="移除" className="hover:text-accent-red">
                <X size={10} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCustom();
            }}
            placeholder="自定义色值(主色-偏色,如 e85048-111111)"
            className="w-64 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan font-mono"
          />
          <button onClick={addCustom} className="text-xs btn btn-secondary flex items-center gap-1">
            <Plus size={12} />
            添加
          </button>
        </div>
      )}
    </div>
  );
}

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
  moveStepIntervalMs: number;
  setMoveStepIntervalMs: (v: number) => void;
  /** 看门狗配置(组队申请/验证码/生命回复/角色停级) */
  watchdog: FarmWatchdogConfig;
  setWatchdog: (v: FarmWatchdogConfig | ((prev: FarmWatchdogConfig) => FarmWatchdogConfig)) => void;
  /** 物品拾取配置(nameKeywords 在界面里是逗号分隔文本) */
  pickup: PickupUiState;
  setPickup: (v: PickupUiState | ((prev: PickupUiState) => PickupUiState)) => void;
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
    watchdog,
    setWatchdog,
    pickup,
    setPickup,
    note,
    setNote,
  } = props;

  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

  /** 「物品使用」技能 = 生命回复可选的药品池(与技能设置共用同一份快捷栏配置) */
  const itemSkills = skills.filter((s) => s.method === 'item' && s.enabled !== false);
  const autoHealIds = watchdog.autoHeal?.itemIds ?? [];
  /** 把某个技能 id 从生命回复的药品选择里摘掉(技能被删/改成别的施法方式时) */
  const dropHealItem = (id: string) => {
    setWatchdog((w) => {
      if (!w.autoHeal) return w;
      const itemIds = (w.autoHeal.itemIds || []).filter((x) => x !== id);
      return { ...w, autoHeal: { itemIds } };
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
            '在固定路径点上,按设定的 OCR 范围/颜色识别怪物名称,右键点击怪名锁定(HUD 出现名字才算锁上)后用左键点击怪名开打;右键点了 HUD 里却没出现名字 = 该目标已阵亡,不攻击,继续扫描;不配技能 = 识别到怪就普通攻击(左键点一下);连续识别不到怪后原地再等约 3 秒,仍没有怪才前往下一个点'}
          {mode === 'move-detect' && '移动途中识别到怪物名称,优先停下打怪,打完再继续前往路径点'}
        </div>
      </div>

      {/* 技能设置(先配技能,再在下方路径点上选择用哪些) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            技能设置 <span className="text-text-muted text-[11px]">(F1-F10;路径点从这里选择要释放的技能)</span>
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
            暂无技能,点"添加技能"配置(F1-F10 的名称/间隔/吟唱/施法距离/施法方式); 定点识别可以不配技能 = 普通攻击(右键锁定后左键点一下)
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
                      className={`w-14 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      title="技能键"
                    >
                      {SKILL_KEY_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
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
          = 点击角色自身 + 按键;物品使用 = 只按快捷键消耗快捷栏物品(血药等,可在下方「生命回复」里勾选)。配好技能后,
          {castMode === 'smart'
            ? mode === 'fixed-detect'
              ? '定点识别 + 智能施法会在每个挂机点循环释放全部已配置技能,直到锁定的怪名消失,再重新识别'
              : '智能施法会在每个挂机点自动释放所有就绪的状态施法技能,并从其余技能里选一个可释放的'
            : '在下方"挂机点"类型的路径点上选择要释放的技能'}
          。定点识别也可以不配任何技能:不配 = 普通攻击(右键锁定后左键点一下)
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
                ? '定点识别:到每个挂机点后循环释放全部已配置技能(各自按 CD,物品使用除外),直到锁定的怪名消失才停手,再重新 OCR 识别;识别不到怪后原地再等约 3 秒(等刷新),仍没有怪才前往下一个点'
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
                    {skills.length === 0 ? (
                      <span className="text-[10px] text-text-muted">先在上方"技能设置"里添加技能(不选 = 到点释放全部技能)</span>
                    ) : (
                      <>
                        {skills.map((s) => {
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

      {/* 角色移动间隔 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          移动间隔 <span className="text-text-muted text-[11px]">(毫秒,角色移动速度)</span>
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
          每走一步后等多久再读坐标纠偏;移速快的角色可以调小(如 500),慢的角色调大(如 1000)
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
