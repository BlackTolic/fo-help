// 任务配置对话框
// 两步:1.选任务类型(可从历史任务加载) 2.配置参数(挂机打怪详细,其他留白)

import { useState } from 'react';
import { X, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Check, History } from 'lucide-react';
import type { TaskType, TaskConfig, FarmTaskConfig, Waypoint, StoredTaskConfig } from '../../shared/types';
import { useStore } from '../store/useStore';
import { HistoryTaskDialog } from './HistoryTaskDialog';

const TASK_OPTIONS: { type: TaskType; name: string; icon: string; desc: string; ready: boolean }[] = [
  { type: 'farm', name: '挂机打怪', icon: '⚔', desc: '自动找怪 + 战斗 + 拾取', ready: true },
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
    case 'idle':     return '待启动';
    case 'moving':   return '移动中';
    case 'combat':   return '战斗中';
    case 'resupply': return '回城中';
    case 'paused':   return '已暂停';
    case 'alert':    return '异常';
    default:         return status || '未知';
  }
}
function statusBg(status?: string): string {
  switch (status) {
    case 'idle':     return 'bg-accent-cyan/20 text-accent-cyan';
    case 'moving':   return 'bg-yellow-500/20 text-yellow-500';
    case 'combat':   return 'bg-red-500/20 text-red-500';
    case 'resupply': return 'bg-blue-500/20 text-blue-500';
    case 'paused':   return 'bg-gray-500/20 text-gray-400';
    case 'alert':    return 'bg-orange-500/20 text-orange-500';
    default:         return 'bg-text-muted/20 text-text-muted';
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
  hwnd, initialConfig, thumbnail, workerState, readOnly = false,
  onClose, onSaved, onConfirm,
}: Props) {
  const [step, setStep] = useState<'select' | 'config' | 'name'>(
    initialConfig ? 'config' : 'select',
  );
  const [taskName, setTaskName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
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
  const [note, setNote] = useState('');

  // 初始化(initialConfig 是 FarmTaskConfig 时回填)
  useState(() => {
    if (initialConfig?.type === 'farm') {
      setMapId(initialConfig.mapId);
      setCustomMapName(initialConfig.customMapName || '');
      setMode(initialConfig.mode);
      setWaypoints(initialConfig.waypoints || []);
      setNameKeywords(initialConfig.mobFilter?.nameKeywords?.join(',') || '野,狼,鸡,鹿,狐,猫');
      setNote(initialConfig.note || '');
    }
  });

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
          nameKeywords: nameKeywords.split(',').map((s) => s.trim()).filter(Boolean),
        },
        note: note || undefined,
      };
    }
    return { type: taskType } as any;
  };

  /**
   * 跳转到命名步骤 — Electron 禁用了 window.prompt(),改成 inline UI
   * 自动生成默认名字:任务-<hwnd>-<日期>,用户可改
   */
  const handleSave = () => {
    if (readOnly) return;
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
   * 从历史任务加载:把 cfg 灌到 dialog state
   * - farm:全字段回显(mapId/mode/waypoints/mobFilter/note) + 跳 step 2
   * - 其他:只设置 type,跳 step 2
   */
  const handleHistoryApply = (stored: StoredTaskConfig) => {
    setHistoryOpen(false);
    const cfg = stored.config;
    if (cfg.type === 'farm') {
      const farm = cfg as FarmTaskConfig;
      setMapId(farm.mapId);
      setCustomMapName(farm.customMapName || '');
      setMode(farm.mode);
      setWaypoints(farm.waypoints || []);
      setNameKeywords((farm.mobFilter?.nameKeywords || []).join(','));
      setNote(farm.note || '');
    }
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
                    ${opt.ready
                      ? 'bg-bg-hover border-border-base hover:border-accent-cyan cursor-pointer'
                      : 'bg-bg-input/50 border-border-base/50 opacity-50 cursor-not-allowed'}
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
              note={note}
              setNote={setNote}
            />
          )}

          {step === 'config' && taskType && taskType !== 'farm' && (
            <div className="text-center py-12 text-text-secondary">
              <div className="text-4xl mb-3 opacity-30">
                {TASK_OPTIONS.find((o) => o.type === taskType)?.icon}
              </div>
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
                  onChange={(e) => { setTaskName(e.target.value); setNameError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmName();
                    if (e.key === 'Escape') { setStep('config'); setNameError(null); }
                  }}
                  autoFocus
                  placeholder="任务名(全局唯一)"
                  className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan"
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
                    onClick={() => { setStep('config'); setNameError(null); }}
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
              <button onClick={onClose} className="btn btn-secondary">关闭</button>
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
                  {/* "确认"按钮:仅写内存,不持久化(关闭 app 丢,新流程会启动 worker) */}
                  {onConfirm && (
                    <button
                      onClick={handleConfirm}
                      className="btn btn-secondary flex items-center gap-1.5"
                      title="不保存到磁盘,只在当前会话记住这个配置(关 app 后丢)"
                    >
                      <Check size={14} />
                      确认
                    </button>
                  )}
                  {/* "保存配置"按钮:持久化到磁盘(新流程会弹窗输入名字) */}
                  <button onClick={handleSave} className="btn btn-primary flex items-center gap-1.5">
                    <Check size={14} />
                    保存配置
                  </button>
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
  note: string;
  setNote: (v: string) => void;
}

function FarmConfig(props: FarmConfigProps) {
  const {
    readOnly = false,
    mapId, setMapId, customMapName, setCustomMapName,
    mode, setMode, waypoints, addWaypoint, removeWaypoint, moveWaypoint, updateWaypoint,
    nameKeywords, setNameKeywords, note, setNote,
  } = props;

  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

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
            <option key={m.id} value={m.id}>{m.name}</option>
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
                ${mode === m
                  ? 'bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan'
                  : 'bg-bg-input border-border-base text-text-secondary hover:border-border-active'}
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
          {mode === 'aoe' && '群刷,适合法师/道士有 AOE 技能'}
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
            <button onClick={addWaypoint} className="text-xs btn btn-secondary flex items-center gap-1">
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
