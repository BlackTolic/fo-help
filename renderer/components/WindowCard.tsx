// WindowCard: 单个游戏窗口卡片
// 状态机(新流程):
//   unconfigured  → [创建任务] [历史任务]   (同级两个入口)
//     ↓ 选创建任务 → bootstrap + 开 dialog → 保存配置 / 确认 → 自动 startTask
//     ↓ 选历史任务 → 开 history dialog → 选中 → bootstrap + 自动 startTask
//   creating      → loading(bootstrap 中,等 thumbnail + worker ready)
//   running       → [查看详情(只读)] [暂停] [停止]
//   paused        → [查看详情(只读)] [继续] [停止]
//   editable      → [重新选择]            (停止后回到这,可以编辑/选历史/新建)
//
// 启动整合到 dialog:不再有独立的"启动"按钮,配置确认后自动进入战斗循环

import { Suspense, lazy, useState } from 'react';
import { Play, Pause, Square, Settings, RefreshCw, Loader2, Camera, Edit3 } from '../icons';
import { useStore } from '../store/useStore';
import type { GameWindow, TaskConfig, TaskType, WorkerState, StoredTaskConfig, StartTaskAuxConfigs } from '../../shared/types';
import { StatusBadge } from './StatusBadge';
import { isConfigOnlyTaskType, resolveAuxConfigs } from '../aux-configs';

// 两个 dialog 都是"点开才需要"的重量级组件(TaskConfigDialog 源码 100KB),
// 静态 import 会把它们算进首屏模块图;懒加载后只有用户点开时才请求。
const TaskConfigDialog = lazy(() => import('./TaskConfigDialog').then((m) => ({ default: m.TaskConfigDialog })));
const HistoryTaskDialog = lazy(() => import('./HistoryTaskDialog').then((m) => ({ default: m.HistoryTaskDialog })));

interface Props {
  gameWindow: GameWindow;
  worker?: WorkerState;
  characterName?: string;
  taskConfig?: TaskConfig | null;
  /** 当前已应用的任务名(用户自定义,显示在卡片上) */
  appliedTaskName?: string | null;
  /**
   * Bootstrap 模式启动 worker(返回 thumbnail + characterName)
   * 透传 taskType + taskConfig(默认 'farm' + null),
   * 让 worker 进入 idle 时 init.taskType 是用户真正的任务类型,
   * 后续点启动才会跑对应的引擎(farm = combat.start, default-skill = runDefaultSkill ...)
   */
  onBootstrap: (
    hwnd: number,
    characterName: string,
    taskType?: TaskType,
    taskConfig?: TaskConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
  onCancelBootstrap: (hwnd: number) => void;
  onStartTask: (
    hwnd: number,
    taskType?: TaskType,
    taskConfig?: TaskConfig | null,
    auxConfigs?: StartTaskAuxConfigs | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  onStop: (workerId: string) => void;
  onPause: (workerId: string) => void;
  onResume: (workerId: string) => void;
  /** 应用配置到当前 hwnd(创建保存后 / 历史选中后) */
  onApplyConfig: (hwnd: number, config: TaskConfig, name?: string) => void;
  /** 清除当前 hwnd 的应用配置(停止任务后回到 unconfigured) */
  onClearConfig: (hwnd: number) => void;
}

export function WindowCard({
  gameWindow,
  worker,
  characterName,
  taskConfig,
  appliedTaskName,
  onBootstrap,
  onCancelBootstrap,
  onStartTask,
  onStop,
  onPause,
  onResume,
  onApplyConfig,
  onClearConfig,
}: Props) {
  const taskHistory = useStore((s) => s.taskHistory);
  const saveTaskByName = useStore((s) => s.saveTaskByName);
  const updateTaskByName = useStore((s) => s.updateTaskByName);
  /** 历史任务里可运行的任务条数(城镇档案/对话配方是配置型,由各自卡片管理,不进历史任务) */
  const runnableHistoryCount = taskHistory.filter((h) => !isConfigOnlyTaskType(h.config.type)).length;

  // ---- dialog 状态 ----
  const [dialogOpen, setDialogOpen] = useState(false);
  // 历史任务 dialog 状态
  const [historyOpen, setHistoryOpen] = useState(false);
  // dialog 模式:创建/编辑/查看详情
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | 'view'>('create');
  /** dialog 打开期间,标记是否应该自动 startTask(创建流程用) */
  const [autoStartAfterClose, setAutoStartAfterClose] = useState(false);
  /** "创建任务"按钮 loading 状态 — bootstrap 中显示 spinner,bind+截图完成后打开 dialog */
  const [isCreating, setIsCreating] = useState(false);
  // 错误信息(bootstrap 失败 / 保存失败)
  const [error, setError] = useState<string | null>(null);

  const status = worker?.status || 'idle';
  const isConfigured = !!taskConfig;
  const isPending = worker && status === 'pending';
  const isRunning = worker && status !== 'idle' && status !== 'paused' && status !== 'pending';
  const isPaused = worker && status === 'paused';

  // ---- 派生 UI 状态 ----
  let uiState: 'unconfigured' | 'creating' | 'pending' | 'running' | 'paused' | 'editable';
  if (!isConfigured) {
    uiState = 'unconfigured';
  } else if (worker && status === 'alert') {
    // alert 状态:绑窗/启动失败 → 允许重新尝试
    uiState = 'editable';
  } else if (isPending) {
    // bootstrap 完成,等 start-task(通常 1-2 秒自动进 combat;若卡住可让用户重试)
    uiState = 'pending';
  } else if (isRunning) {
    uiState = 'running';
  } else if (isPaused) {
    uiState = 'paused';
  } else if (worker && worker.ready === false) {
    // worker 已存在但未 ready(bootstrap 中)
    uiState = 'creating';
  } else {
    // 任务停止后(worker 已 exit)/创建后未启动 → editable
    uiState = 'editable';
  }

  // ---- 入口按钮 handlers ----

  /**
   * 创建任务:按钮变 loading + dialog 立即弹出 + bootstrap 后台异步
   * ⚠️ 关键:dialog 不等 bootstrap 完成才弹,而是立刻弹
   *   原因:bootstrap 卡住(子进程 fork 慢/dm 加载慢/IPC 问题)时,dialog 也能立刻可见
   *   loading 状态让用户知道 worker 还在初始化,bootstrap 完成后 loading 消失
   *   bootstrap 失败时:loading 消失 + 显示错误条(dialog 保持打开,用户可手动关闭)
   */
  const handleCreateTask = () => {
    setError(null);
    setIsCreating(true); // 按钮变 loading(用户看到"系统准备中")
    // dialog 立刻弹,不等 bootstrap
    setDialogMode('create');
    setAutoStartAfterClose(true);

    // 后台异步 bootstrap
    const name = characterName || '角色';
    onBootstrap(gameWindow.hwnd, name)
      .then((res) => {
        setIsCreating(false); // loading 消失
        if (!res.ok) {
          setError(res.error || '启动 worker 失败');
          return;
        }
        setDialogOpen(true);
      })
      .catch((err) => {
        setIsCreating(false);
        setError(err?.message || '启动 worker 失败');
      });
  };

  /**
   * 选中历史任务后:加载配置 + 应用到当前 hwnd + 启动 worker
   *
   * ⚠️ 切历史任务 = 换任务类型/配置,worker 当前可能正在跑别的任务(比如 farm)
   *   直接发 start-task 不能让它重新分派:
   *     worker 的 start-task handler 只在 _startResolve 还在时才有效(bootstrap 等待期间)
   *     一旦任务在跑,start-task handler 只能打 warn,不会 resolve 等任何东西
   *   所以总是先 stop 现有 worker,等它 graceful exit + byHwnd 清理,再走 bootstrap + startTask
   */
  const handleHistorySelect = async (stored: StoredTaskConfig) => {
    setHistoryOpen(false);
    setError(null);
    onApplyConfig(gameWindow.hwnd, stored.config, stored.name);

    // 校验:缺省技能必须至少 1 个启用的步骤(防止历史任务里的空配置被启动)
    if (stored.config.type === 'default-skill') {
      const enabledSteps = (stored.config.steps || []).filter((s) => s.enabled !== false);
      if (enabledSteps.length === 0) {
        setError(`任务"${stored.name}"是缺省技能但没有启用的步骤,请先编辑添加步骤`);
        return;
      }
    }

    // 解析回城补给的附属配置(城镇档案 / 全部对话配方 / 挂机地图中文名);解析不出就阻止启动
    const auxRes = resolveAuxConfigs(stored.config, taskHistory);
    if (!auxRes.ok) {
      setError(`任务"${stored.name}"无法启动:${auxRes.error}`);
      return;
    }

    // 现有 worker 的处理:
    //   - status === 'pending'(bootstrap 完成、正等 start-task)→ 直接复用,不重开进程
    //   - 其余(运行/暂停/异常/即将退出)→ 停掉,并**等它真正从 store 消失**再重新 bootstrap,
    //     避免 bootstrap 命中"已有 worker"分支而只截图、没换任务(原固定 500ms 等待不可靠)
    const canReuse = worker?.status === 'pending';
    if (worker && !canReuse) {
      const oldWorkerId = worker.workerId;
      onStop(oldWorkerId);
      const deadline = Date.now() + 10000;
      while (useStore.getState().workers.has(oldWorkerId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const res = await onBootstrap(gameWindow.hwnd, characterName || '角色');
      if (!res.ok) {
        setError(res.error || '启动 worker 失败');
        return;
      }
    } else if (!worker) {
      // 无 worker → 全新 bootstrap
      const res = await onBootstrap(gameWindow.hwnd, characterName || '角色');
      if (!res.ok) {
        setError(res.error || '启动 worker 失败');
        return;
      }
    }

    // 复用 pending worker / 刚 bootstrap 完 → 发 start-task
    const startRes = await onStartTask(gameWindow.hwnd, stored.config.type, stored.config, auxRes.auxConfigs);
    if (!startRes.ok) {
      alert(`已应用配置,但启动失败: ${startRes.error || '未知错误'}\n请稍后重试`);
    }
  };

  // ---- dialog handlers ----

  /**
   * 配置型"任务"(城镇档案 / 对话配方)保存后调用:
   * 创建流程为拿缩略图 bootstrap 的 worker 会停在 idle(没收到 start-task),顺手停掉回到干净状态
   */
  const cancelThumbnailWorker = () => {
    if (dialogMode === 'create' && autoStartAfterClose && !worker?.taskConfig) {
      onCancelBootstrap(gameWindow.hwnd);
    }
  };

  /** dialog 关闭:取消自动启动标记,如果是 creating 流程且没保存则 cancelBootstrap */
  const handleDialogClose = () => {
    // 如果是 create 流程且还没自动启动 → cancel worker
    if (dialogMode === 'create' && autoStartAfterClose && !worker?.taskConfig) {
      // dialog 在配置阶段被关掉,worker 在 idle 等命令
      // → cancelBootstrap(停掉 worker,回到 unconfigured)
      // 不调 cancel,因为 worker 可能还活着(以后想用可以直接 startTask)
      // 这里选择:保留 worker(用户可以再次点创建),不 cancel
      // 但如果用户彻底关掉,下次进来还是看到 idle worker 孤儿
      // 简单起见:cancel
      onCancelBootstrap(gameWindow.hwnd);
    }
    setDialogOpen(false);
    setAutoStartAfterClose(false);
  };

  /**
   * 保存任务(TaskConfigDialog 的保存按钮调用):持久化到磁盘,可选启动 worker
   * - opts.existing=true → 覆盖保存同名历史任务(updateTaskByName);缺省新建(saveTaskByName,重名拒绝)
   * - opts.start=false   → 只保存,不启动 worker(缺省/true = 保存后自动跑,兼容旧调用)
   *
   * 关键修复:如果现有 worker 是不同 taskType(例:用户先点了"创建任务" → bootstrap 了一个
   * 'farm' worker 拿 thumbnail,现在保存的是 'default-skill'),
   * 直接 startTask 会跑老 taskType。
   * 所以这里检测不匹配 → 停掉旧 worker → 用新 taskType 重新 bootstrap → startTask。
   *
   * 配置型"任务"(town-profile / dialog-recipe)只落盘:它们不能作为任务运行,
   * 保存后不 bootstrap、不 startTask(引用它们的 farm 任务启动时再把它们放进 auxConfigs)。
   */
  const handleTaskSaved = async (
    config: TaskConfig,
    name: string,
    opts?: { existing?: boolean; start?: boolean },
  ): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { ok: false, error: '任务名不能为空' };
    }
    const existing = opts?.existing === true;
    const shouldStart = opts?.start !== false;

    // 配置型"任务":只存盘 + 关 dialog(不写内存的 taskConfig,也不启动 worker)
    if (isConfigOnlyTaskType(config.type)) {
      const saved = existing ? await updateTaskByName(trimmed, config) : await saveTaskByName(trimmed, config);
      if (!saved.ok) {
        return { ok: false, error: saved.error };
      }
      setDialogOpen(false);
      setAutoStartAfterClose(false);
      cancelThumbnailWorker();
      return { ok: true };
    }

    // 解析回城补给的附属配置(farm 开了补给才有);解析不出就直接返回 error 让用户先修配置
    const auxRes = resolveAuxConfigs(config, taskHistory);
    if (!auxRes.ok) {
      return { ok: false, error: auxRes.error };
    }

    const res = existing ? await updateTaskByName(trimmed, config) : await saveTaskByName(trimmed, config);
    if (!res.ok) {
      // 重名或其他错误 — 返回 error,dialog 停留在 name 步骤让用户改名重试
      return { ok: false, error: res.error };
    }
    // 保存成功:应用到当前 hwnd + 关 dialog
    onApplyConfig(gameWindow.hwnd, config, trimmed);
    setDialogOpen(false);
    setAutoStartAfterClose(false);
    // 只保存不启动:顺手把为拿缩略图 bootstrap 起来的 idle worker 收掉,别留孤儿
    if (!shouldStart) {
      cancelThumbnailWorker();
      return { ok: true };
    }
    // 把 taskType + taskConfig + auxConfigs 一起发给 worker,worker 收到后覆盖 init 字段分派
    const startRes = await onStartTask(gameWindow.hwnd, config.type, config, auxRes.auxConfigs);
    if (!startRes.ok) {
      // startTask 失败(worker 未 ready 超时等)— 提示用户
      alert(`已保存任务,但启动失败: ${startRes.error || '未知错误'}\n请稍后在 WindowCard 上重试`);
    }
    return { ok: true };
  };

  /**
   * "确认":仅写内存,不持久化 → 自动 startTask(关 app 丢)
   * 配置型"任务"不能运行:只关 dialog(不写内存、不启动)
   */
  const handleTaskConfirm = async (config: TaskConfig) => {
    if (isConfigOnlyTaskType(config.type)) {
      setDialogOpen(false);
      setAutoStartAfterClose(false);
      cancelThumbnailWorker();
      return;
    }
    const auxRes = resolveAuxConfigs(config, taskHistory);
    if (!auxRes.ok) {
      // onConfirm 没有返回通道 → 用 alert 提示,并保持 dialog 打开让用户回去改配置
      alert(`无法启动: ${auxRes.error}`);
      return;
    }
    onApplyConfig(gameWindow.hwnd, config);
    setDialogOpen(false);
    setAutoStartAfterClose(false);
    const startRes = await onStartTask(gameWindow.hwnd, config.type, config, auxRes.auxConfigs);
    if (!startRes.ok) {
      alert(`已应用配置,但启动失败: ${startRes.error || '未知错误'}\n请稍后重试`);
    }
  };

  /**
   * pending 状态的"启动":worker 已 ready 但还没收到 start-task
   * (上次因 race 暂存过 / 或 worker 还在 waitForConfig 等命令)
   * 重新发一次 start-task(worker 那边 _startResolve / _pendingStart 都能接住),auxConfigs 一并带上
   */
  const handlePendingStart = async () => {
    const auxRes = resolveAuxConfigs(taskConfig, taskHistory);
    if (!auxRes.ok) {
      setError(auxRes.error);
      return;
    }
    const res = await onStartTask(gameWindow.hwnd, taskConfig?.type, taskConfig, auxRes.auxConfigs);
    if (!res.ok) alert(`启动失败: ${res.error || '未知'}`);
  };

  /**
   * editable 状态下编辑:打开 dialog(允许编辑),保存后重启 worker
   */
  const handleEditConfig = () => {
    setDialogMode('edit');
    setAutoStartAfterClose(true);
    setDialogOpen(true);
  };

  /**
   * editable 状态下重新选择历史任务
   */
  const handleReselectHistory = () => {
    setHistoryOpen(true);
  };

  /**
   * editable 状态下放弃当前任务,回到 unconfigured
   */
  const handleAbandon = () => {
    onClearConfig(gameWindow.hwnd);
    // worker 已经退出了(exit 时 cleanup 了),不需要 cancelBootstrap
  };

  // ---- 运行控制 ----

  const handlePause = () => {
    if (worker) onPause(worker.workerId);
  };

  const handleResume = () => {
    if (worker) onResume(worker.workerId);
  };

  const handleStop = () => {
    if (worker) onStop(worker.workerId);
    // stop 后直接清掉当前 hwnd 的应用配置,回到 unconfigured 页面状态
    // (跟首次见到这个窗口一样,只有"创建任务"按钮)
    // —— 不再走中间 editable(编辑配置 / 重新选择 / 放弃)
    onClearConfig(gameWindow.hwnd);
  };

  return (
    <>
      <div className="card overflow-hidden flex flex-col">
        {/* 缩略图 */}
        <div className="relative aspect-[4/3] bg-bg-input border-b border-border-base flex items-center justify-center">
          {(() => {
            const thumbnail = useStore.getState().thumbnails.get(gameWindow.hwnd);
            if (thumbnail) {
              return <img src={thumbnail} alt={`hwnd ${gameWindow.hwnd}`} className="w-full h-full object-contain" draggable={false} />;
            }
            if (gameWindow.isMinimized) {
              return (
                <div className="text-text-muted text-xs text-center p-3">
                  <div className="text-2xl mb-1 opacity-50">📉</div>
                  <div>窗口已最小化</div>
                </div>
              );
            }
            if (uiState === 'creating') {
              return (
                <div className="text-text-muted text-xs text-center p-3">
                  <Loader2 size={24} className="mx-auto mb-1.5 opacity-50 animate-spin text-accent-cyan" />
                  <div>正在连接游戏…</div>
                  <div className="text-text-muted/60 mt-1 text-[10px]">大漠绑定 + 截图</div>
                </div>
              );
            }
            return (
              <div className="text-text-muted text-xs text-center p-3">
                <div className="text-2xl mb-1 opacity-50">🚫</div>
                <div>无法截取</div>
                <div className="text-text-muted/60 mt-1 text-[10px]">游戏可能启用了反截图保护</div>
              </div>
            );
          })()}
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-mono text-text-secondary">
            hwnd {gameWindow.hwnd}
          </div>
          {/* 右上角:状态标签 + 工具按钮 */}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5">
            {appliedTaskName && (
              <span className="px-1.5 py-0.5 bg-accent-cyan/20 text-accent-cyan rounded text-[10px] font-medium" title="当前任务">
                📋 {appliedTaskName}
              </span>
            )}
            <button
              onClick={async () => {
                if (!window.fohelp) return;
                await (window.fohelp as any).recaptureThumbnail?.(gameWindow.hwnd);
              }}
              className="p-1 bg-black/60 hover:bg-black/80 rounded text-text-muted hover:text-text-primary"
              title="刷新缩略图"
            >
              <RefreshCw size={10} />
            </button>
            <button
              onClick={async () => {
                if (!window.fohelp) return;
                const res = await window.fohelp.captureTest(gameWindow.hwnd);
                if (res.ok && res.filePath) {
                  await window.fohelp.showItemInFolder(res.filePath);
                } else {
                  alert(`截图失败: ${res.error || '未知错误'}\n(该 hwnd 需要先点"创建任务"启动 worker)`);
                }
              }}
              className="p-1 bg-black/60 hover:bg-black/80 rounded text-text-muted hover:text-text-primary"
              title="大漠截图测试"
            >
              <Camera size={10} />
            </button>
          </div>
        </div>

        {/* 角色 + 状态(已配置才显示) */}
        {isConfigured && (
          <div className="px-3 py-2 border-b border-border-base space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{characterName || worker?.character?.name || '(未识别)'}</span>
            </div>
            <div className="flex items-center justify-between">
              <StatusBadge status={status} animate={status === 'combat'} />
              {worker?.statusDetail && (
                <span className="text-[10px] text-text-muted truncate max-w-[140px]" title={worker.statusDetail}>
                  {worker.statusDetail}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="px-3 py-1.5 text-[11px] text-accent-red bg-accent-red/10 border-b border-accent-red/20">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-text-muted hover:text-text-primary">
              ×
            </button>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="p-2 flex gap-1.5">
          {uiState === 'unconfigured' && (
            <>
              <button
                onClick={handleCreateTask}
                disabled={isCreating}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-70"
              >
                {isCreating ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    连接中…
                  </>
                ) : (
                  <>
                    <Settings size={12} />
                    创建任务
                  </>
                )}
              </button>
            </>
          )}

          {uiState === 'creating' && (
            <button disabled className="btn btn-primary flex-1 flex items-center justify-center gap-1 opacity-70">
              <Loader2 size={12} className="animate-spin" />
              连接中…
            </button>
          )}

          {uiState === 'running' && (
            <>
              <button
                onClick={() => {
                  setDialogMode('view');
                  setDialogOpen(true);
                }}
                className="btn btn-secondary flex items-center justify-center"
                title="查看任务详情(只读)"
              >
                <Settings size={12} />
              </button>
              <button onClick={handlePause} className="btn btn-secondary flex-1 flex items-center justify-center gap-1">
                <Pause size={12} />
                暂停
              </button>
              <button onClick={handleStop} className="btn btn-danger flex-1 flex items-center justify-center gap-1">
                <Square size={12} />
                停止
              </button>
            </>
          )}

          {uiState === 'paused' && (
            <>
              <button
                onClick={() => {
                  setDialogMode('view');
                  setDialogOpen(true);
                }}
                className="btn btn-secondary flex items-center justify-center"
                title="查看任务详情(只读)"
              >
                <Settings size={12} />
              </button>
              <button onClick={handleResume} className="btn btn-primary flex-1 flex items-center justify-center gap-1">
                <Play size={12} />
                继续
              </button>
              <button onClick={handleStop} className="btn btn-danger flex-1 flex items-center justify-center gap-1">
                <Square size={12} />
                停止
              </button>
            </>
          )}

          {uiState === 'pending' && (
            <>
              <button
                onClick={handleEditConfig}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1"
                title="编辑当前配置"
              >
                <Edit3 size={12} />
                编辑配置
              </button>
              <button
                onClick={() => void handlePendingStart()}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
                title="向 worker 发送 start-task(bootstrap-race 兜底)"
              >
                <Play size={12} />
                启动
              </button>
              <button onClick={handleAbandon} className="btn btn-danger flex items-center justify-center" title="放弃当前任务">
                <Square size={12} />
              </button>
            </>
          )}

          {uiState === 'editable' && (
            <>
              <button
                onClick={handleEditConfig}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1"
                title="编辑当前配置"
              >
                <Edit3 size={12} />
                编辑配置
              </button>
              <button
                onClick={handleReselectHistory}
                disabled={runnableHistoryCount === 0}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title={runnableHistoryCount === 0 ? '还没有保存过的任务' : '从历史任务中选择其他任务'}
              >
                <Settings size={12} />
                历史任务
              </button>
              <button
                onClick={handleAbandon}
                className="btn btn-danger flex items-center justify-center"
                title="放弃当前任务,回到未配置状态"
              >
                <Square size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 任务配置 dialog — 渲染条件:dialogOpen + (已有 taskConfig 或 创建流程中)
          创建流程时 taskConfig 还是 null(没保存),但要能开 dialog 让用户配置 */}
      {dialogOpen && (taskConfig || dialogMode === 'create') && (
        <Suspense fallback={null}>
          <TaskConfigDialog
            hwnd={gameWindow.hwnd}
            initialConfig={taskConfig}
            thumbnail={useStore.getState().thumbnails.get(gameWindow.hwnd)}
            workerState={worker || null}
            readOnly={dialogMode === 'view'}
            onClose={handleDialogClose}
            onSaved={handleTaskSaved}
            onConfirm={dialogMode === 'view' ? undefined : handleTaskConfirm}
            onStartStored={(stored) => {
              // 编辑器里点「启动」:关掉编辑器(不走 handleDialogClose 的 cancelBootstrap,
              // 避免与 handleHistorySelect 的"停旧 worker + bootstrap"打架),交给它接管
              setDialogOpen(false);
              setAutoStartAfterClose(false);
              void handleHistorySelect(stored);
            }}
          />
        </Suspense>
      )}

      {/* 历史任务 dialog */}
      {historyOpen && (
        <Suspense fallback={null}>
          <HistoryTaskDialog
            history={taskHistory}
            currentHwnd={gameWindow.hwnd}
            onClose={() => setHistoryOpen(false)}
            onApply={(stored) => handleHistorySelect(stored)}
          />
        </Suspense>
      )}
    </>
  );
}
