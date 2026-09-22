// 任务配置对话框
// 两步:1.选任务类型(可从历史任务加载) 2.配置参数(挂机打怪详细,其他留白)

import { useState, useEffect } from 'react';
import {
  X,
  ChevronRight,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Check,
  History,
  Keyboard,
} from 'lucide-react';
import type {
  TaskType,
  TaskConfig,
  FarmTaskConfig,
  FarmSkillConfig,
  Waypoint,
  StoredTaskConfig,
  DefaultSkillTaskConfig,
  DefaultSkillStep,
} from '../../shared/types';
import { ALL_KEY_COMBOS, isValidKeyCombo } from '../../shared/key-combo';
import { useStore } from '../store/useStore';
import { HistoryTaskDialog } from './HistoryTaskDialog';

const TASK_OPTIONS: { type: TaskType; name: string; icon: string; desc: string; ready: boolean }[] =
  [
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
  const [step, setStep] = useState<'select' | 'config' | 'name'>(
    initialConfig ? 'config' : 'select',
  );
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
  const [mode, setMode] = useState<'single' | 'aoe' | 'patrol'>('single');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [nameKeywords, setNameKeywords] = useState('野,狼,鸡,鹿,狐,猫');
  // 移动攻击相关:怪名颜色 / 技能列表 / 角色移动间隔
  const [mobNameColor, setMobNameColor] = useState('FFFFFF-FFFFFF');
  const [skills, setSkills] = useState<FarmSkillConfig[]>([]);
  const [moveStepIntervalMs, setMoveStepIntervalMs] = useState(800);
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
      setMode(farm.mode);
      setWaypoints(farm.waypoints || []);
      setNameKeywords(farm.mobFilter?.nameKeywords?.join(',') || '野,狼,鸡,鹿,狐,猫');
      setMobNameColor(farm.mobFilter?.nameColor || 'FFFFFF-FFFFFF');
      setSkills(farm.skills || []);
      setMoveStepIntervalMs(farm.movementSpeed ?? 800);
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
        waypoints,
        mobFilter: {
          nameKeywords: nameKeywords
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          nameColor: mobNameColor.trim() || undefined,
        },
        // 过滤掉未启用的技能 + 规范化 cooldownMs,保存前清洗(同缺省技能的清洗思路)
        skills: skills
          .filter((s) => s.enabled !== false)
          .map((s) => ({
            id: s.id,
            key: s.key,
            cooldownMs: Math.max(0, s.cooldownMs | 0),
            enabled: s.enabled !== false,
            note: s.note,
          })),
        movementSpeed: Math.max(100, moveStepIntervalMs | 0),
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
      const enabledSteps = (cfg.type === 'default-skill' ? cfg.steps : []).filter(
        (s) => s.enabled !== false,
      );
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
                <span className="text-accent-cyan">
                  {TASK_OPTIONS.find((o) => o.type === taskType)?.name}
                </span>
              </>
            )}
            {/* 当前任务运行状态回显 */}
            {workerState && step === 'config' && (
              <span className="ml-2 inline-flex items-center gap-2 text-[11px] text-text-muted">
                <span
                  className={`px-1.5 py-0.5 rounded font-medium ${statusBg(workerState.status)}`}
                >
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
                  <span className="ml-auto text-[11px] text-text-muted">
                    {taskHistory.length} 条
                  </span>
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
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-text-muted/20 text-text-muted">
                          即将推出
                        </span>
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
              waypoints={waypoints}
              addWaypoint={addWaypoint}
              removeWaypoint={removeWaypoint}
              moveWaypoint={moveWaypoint}
              updateWaypoint={updateWaypoint}
              nameKeywords={nameKeywords}
              setNameKeywords={setNameKeywords}
              mobNameColor={mobNameColor}
              setMobNameColor={setMobNameColor}
              skills={skills}
              setSkills={setSkills}
              moveStepIntervalMs={moveStepIntervalMs}
              setMoveStepIntervalMs={setMoveStepIntervalMs}
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
              <div className="text-4xl mb-3 opacity-30">
                {TASK_OPTIONS.find((o) => o.type === taskType)?.icon}
              </div>
              <div className="text-base mb-1">
                {TASK_OPTIONS.find((o) => o.type === taskType)?.name}
              </div>
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
                {nameError && (
                  <div className="text-[11px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">
                    {nameError}
                  </div>
                )}
                <div className="text-[11px] text-text-muted">
                  💡 保存后该任务会出现在"历史任务"列表,可以复用到其他窗口
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
                  <button
                    onClick={() => void handleConfirmName()}
                    className="btn btn-primary flex items-center gap-1"
                  >
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
            onClose={() => setHistoryOpen(false)}
            onApply={handleHistoryApply}
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
                    title={
                      initialTaskName
                        ? '保存修改后的历史任务(不启动 worker)'
                        : '执行并保存当前任务，以便下次直接在“历史任务”中使用'
                    }
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
              {step === 'name' && (
                <span className="text-[11px] text-text-muted">
                  按 Enter 或点 panel 内"确认保存"
                </span>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---- 挂机打怪配置子组件 ----

/** 移动攻击技能可选键(F1-F9,与 worker 的 MoveAttackSkill.key 对应) */
const SKILL_KEY_OPTIONS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];

interface FarmConfigProps {
  readOnly?: boolean;
  mapId: string;
  setMapId: (v: string) => void;
  customMapName: string;
  setCustomMapName: (v: string) => void;
  mode: 'single' | 'aoe' | 'patrol';
  setMode: (v: 'single' | 'aoe' | 'patrol') => void;
  waypoints: Waypoint[];
  addWaypoint: () => void;
  removeWaypoint: (id: string) => void;
  moveWaypoint: (id: string, dir: -1 | 1) => void;
  updateWaypoint: (id: string, field: keyof Waypoint, value: any) => void;
  nameKeywords: string;
  setNameKeywords: (v: string) => void;
  mobNameColor: string;
  setMobNameColor: (v: string) => void;
  skills: FarmSkillConfig[];
  setSkills: (v: FarmSkillConfig[] | ((prev: FarmSkillConfig[]) => FarmSkillConfig[])) => void;
  moveStepIntervalMs: number;
  setMoveStepIntervalMs: (v: number) => void;
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
    waypoints,
    addWaypoint,
    removeWaypoint,
    moveWaypoint,
    updateWaypoint,
    nameKeywords,
    setNameKeywords,
    mobNameColor,
    setMobNameColor,
    skills,
    setSkills,
    moveStepIntervalMs,
    setMoveStepIntervalMs,
    note,
    setNote,
  } = props;

  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';
  /**
   * 群刷模式的技能点击距离 = 移速 - 200(与 worker tasks/farm.ts 的 AOE_DISTANCE_OFFSET 一致)。
   * 这里只用于文案提示,真正生效的值由 worker 按 taskConfig.movementSpeed 算。
   */
  const aoeDistancePx = Math.max(0, (moveStepIntervalMs || 800) - 200);

  // ---- 移动攻击技能列表编辑 ----
  const addSkill = () => {
    if (readOnly) return;
    setSkills((ss) => [
      ...ss,
      {
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        key: 'F1',
        cooldownMs: 5000,
        enabled: true,
      },
    ]);
  };

  const removeSkill = (id: string) => {
    if (readOnly) return;
    setSkills((ss) => ss.filter((s) => s.id !== id));
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
          {(['single', 'aoe', 'patrol'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={readOnly}
              className={`
                px-3 py-2 rounded border text-sm transition-colors ${disabledCls}
                ${
                  mode === m
                    ? 'bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan'
                    : 'bg-bg-input border-border-base text-text-secondary hover:border-border-active'
                }
              `}
            >
              {m === 'single' && '🎯 单怪'}
              {m === 'aoe' && '💥 群刷'}
              {m === 'patrol' && '🚶 巡逻'}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-text-muted mt-1">
          {mode === 'single' && '每次打一只怪,适合近战/脆皮'}
          {mode === 'aoe' && '群刷:技能丢在自身移动反方向(移速-200px)处,适合法师/道士有 AOE 技能'}
          {mode === 'patrol' && '按路径点循环巡逻,适合大范围挂机'}
        </div>
      </div>

      {/* 路径点(patrol 模式才有意义) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            路径点 <span className="text-text-muted text-[11px]">(patrol 模式必填,其他选填)</span>
          </label>
          {!readOnly && (
            <button
              onClick={addWaypoint}
              className="text-xs btn btn-secondary flex items-center gap-1"
            >
              <Plus size={12} />
              添加点
            </button>
          )}
        </div>

        {waypoints.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无路径点
          </div>
        ) : (
          <div className="space-y-1.5">
            {waypoints.map((wp, i) => (
              <div key={wp.id} className="flex items-center gap-1.5 bg-bg-input p-1.5 rounded">
                <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                <select
                  value={wp.type}
                  onChange={(e) => updateWaypoint(wp.id, 'type', e.target.value)}
                  disabled={readOnly}
                  className={`bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  <option value="farm-spot">挂机点</option>
                  <option value="rest">休息点</option>
                  <option value="path">路径点</option>
                </select>
                <span className="text-text-muted text-xs">X</span>
                <input
                  type="number"
                  value={wp.x}
                  onChange={(e) => updateWaypoint(wp.id, 'x', parseInt(e.target.value) || 0)}
                  disabled={readOnly}
                  className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                />
                <span className="text-text-muted text-xs">Y</span>
                <input
                  type="number"
                  value={wp.y}
                  onChange={(e) => updateWaypoint(wp.id, 'y', parseInt(e.target.value) || 0)}
                  disabled={readOnly}
                  className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                />
                <input
                  type="text"
                  placeholder="备注"
                  value={wp.note || ''}
                  onChange={(e) => updateWaypoint(wp.id, 'note', e.target.value)}
                  disabled={readOnly}
                  className={`flex-1 min-w-0 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                />
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
                    <button
                      onClick={() => removeWaypoint(wp.id)}
                      className="text-accent-red/70 hover:text-accent-red"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 找怪关键字 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          找怪关键字 <span className="text-text-muted text-[11px]">(逗号分隔)</span>
        </label>
        <input
          type="text"
          value={nameKeywords}
          onChange={(e) => setNameKeywords(e.target.value)}
          placeholder="野,狼,鸡,鹿,狐,猫"
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
        />
      </div>

      {/* 怪名颜色(移动攻击测试找怪用) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          怪名颜色 <span className="text-text-muted text-[11px]">(大漠颜色格式)</span>
        </label>
        <input
          type="text"
          value={mobNameColor}
          onChange={(e) => setMobNameColor(e.target.value)}
          placeholder="FFFFFF-FFFFFF"
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
        />
        <div className="text-[10px] text-text-muted mt-1">
          找怪时按这个字的颜色匹配;不确定就用默认 FFFFFF-FFFFFF(白名)
        </div>
      </div>

      {/* 移动攻击技能列表(按技能键 → 点击怪物坐标释放) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            技能列表{' '}
            <span className="text-text-muted text-[11px]">(按技能键 → 点击怪坐标释放)</span>
          </label>
          {!readOnly && (
            <button
              onClick={addSkill}
              className="text-xs btn btn-secondary flex items-center gap-1"
            >
              <Plus size={12} />
              添加技能
            </button>
          )}
        </div>

        {skills.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无技能(移动攻击测试将用 worker 内置默认 F1-F4)
          </div>
        ) : (
          <div className="space-y-1.5">
            {skills.map((skill, i) => (
              <div
                key={skill.id}
                className={`flex items-center gap-1.5 bg-bg-input p-1.5 rounded ${
                  skill.enabled === false ? 'opacity-50' : ''
                }`}
              >
                <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
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
                  className={`bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                  title="技能键"
                >
                  {SKILL_KEY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <span className="text-text-muted text-[10px]">CD</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={skill.cooldownMs}
                  onChange={(e) =>
                    updateSkill(skill.id, { cooldownMs: parseInt(e.target.value) || 0 })
                  }
                  disabled={readOnly}
                  className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                  title="技能冷却(毫秒,3~10s = 3000~10000)"
                />
                <span className="text-text-muted text-[10px]">ms</span>
                <input
                  type="text"
                  placeholder="备注"
                  value={skill.note || ''}
                  onChange={(e) => updateSkill(skill.id, { note: e.target.value })}
                  disabled={readOnly}
                  className={`flex-1 min-w-0 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                />
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
                      title="删除该技能"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          到路径点后,对不在冷却中的技能依次:按键 → 点击目标点。
          {mode === 'aoe' ? (
            <>
              群刷:点「自身移动反方向、离自身 {aoeDistancePx}px」处(移速 - 200),范围技能丢在背后引怪
            </>
          ) : (
            <>单怪/巡逻:OCR 扫怪名点在怪身上,扫不到则点移动反方向兜底。</>
          )}{' '}
          短 CD 每个点都能放,长 CD 隔几个点自动轮到
        </div>
      </div>

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
  const {
    readOnly = false,
    steps,
    setSteps,
    loopCount,
    setLoopCount,
    loopIntervalMs,
    setLoopIntervalMs,
    note,
    setNote,
  } = props;

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
  const totalMsPerLoop = steps.reduce(
    (sum, s) => sum + (s.holdMs ?? 50) + (s.enabled === false ? 0 : s.intervalMs),
    0,
  );

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
          支持 <span className="font-mono text-accent-cyan">F1-F12</span>、
          <span className="font-mono text-accent-cyan"> Alt+F1-F12</span>、
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
                  className={`flex items-center gap-1.5 bg-bg-input p-1.5 rounded ${
                    step.enabled === false ? 'opacity-50' : ''
                  }`}
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
                    onChange={(e) =>
                      updateStep(step.id, { intervalMs: parseInt(e.target.value) || 0 })
                    }
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
                    onChange={(e) =>
                      updateStep(step.id, { holdMs: parseInt(e.target.value) || 50 })
                    }
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
                      <button
                        onClick={() => removeStep(step.id)}
                        className="text-accent-red/70 hover:text-accent-red"
                        title="删除该步骤"
                      >
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
          <span className="font-mono text-accent-cyan ml-1">
            {(totalMsPerLoop / 1000).toFixed(2)}s
          </span>
          <span className="ml-2">
            ({steps.length} 步 × 平均{' '}
            {steps.length > 0 ? Math.round(totalMsPerLoop / steps.length) : 0}ms)
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
