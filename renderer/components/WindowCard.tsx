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

import { useState } from 'react';
import { Play, Pause, Square, Settings, RefreshCw, Loader2, Camera, Edit3 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { TaskConfigDialog } from './TaskConfigDialog';
import { HistoryTaskDialog } from './HistoryTaskDialog';
import type {
  GameWindow,
  TaskConfig,
  TaskType,
  WorkerState,
  StoredTaskConfig,
} from '../../shared/types';
import { StatusBadge } from './StatusBadge';

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
  onStartTask: (hwnd: number) => Promise<{ ok: boolean; error?: string }>;
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
   * 关键:bootstrap 时必须传 stored.config.type + stored.config,worker 的
   * init.taskType 才会匹配上,start-task 时才会跑对应引擎
   * (不传的话主进程默认 'farm',即使 config 是 default-skill 也会被 farm 抢跑)
   */
  const handleHistorySelect = async (stored: StoredTaskConfig) => {
    setHistoryOpen(false);
    setError(null);
    onApplyConfig(gameWindow.hwnd, stored.config, stored.name);

    // 如果已有 worker 但 taskType 不匹配(比如之前用了 'farm' 预览,现在想跑 default-skill),
    // 任务类型不一致的 worker 不能复用,先停掉重新 bootstrap
    let liveWorker = worker;
    if (liveWorker && liveWorker.taskType !== stored.config.type) {
      await onCancelBootstrap(gameWindow.hwnd);
      // 给 worker 一点时间真正退出(byHwnd 清理)
      await new Promise((r) => setTimeout(r, 200));
      liveWorker = undefined;
    }

    if (liveWorker) {
      // 已有同类型 worker,直接发 start-task
      const startRes = await onStartTask(gameWindow.hwnd);
      if (!startRes.ok) {
        alert(`启动失败: ${startRes.error || '未知错误'}\n请稍后重试`);
      }
    } else {
      // 还没有(或刚被 kill)正确 taskType 的 worker:bootstrap + 自动 startTask
      const res = await onBootstrap(
        gameWindow.hwnd,
        characterName || '角色',
        stored.config.type,
        stored.config,
      );
      if (!res.ok) {
        setError(res.error || '启动 worker 失败');
        return;
      }
      const startRes = await onStartTask(gameWindow.hwnd);
      if (!startRes.ok) {
        alert(`已应用配置,但启动失败: ${startRes.error || '未知错误'}\n请稍后重试`);
      }
    }
  };

  // ---- dialog handlers ----

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
   * "保存配置":接收 dialog 传来的 name(替代 Electron 不支持的 window.prompt)
   * 持久化到磁盘 + 自动 startTask;重名拒绝,返回 error 让 dialog 留在 name 步骤
   *
   * 关键修复:如果现有 worker 是不同 taskType(例:用户先点了"创建任务" → bootstrap 了一个
   * 'farm' worker 拿 thumbnail,现在保存的是 'default-skill'),
   * 直接 startTask 会跑老 taskType。
   * 所以这里检测不匹配 → 停掉旧 worker → 用新 taskType 重新 bootstrap → startTask。
   */
  const handleTaskSaved = async (
    config: TaskConfig,
    name: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { ok: false, error: '任务名不能为空' };
    }
    const res = await saveTaskByName(trimmed, config);
    if (!res.ok) {
      // 重名或其他错误 — 返回 error,dialog 停留在 name 步骤让用户改名重试
      return { ok: false, error: res.error };
    }
    // 保存成功:应用到当前 hwnd + 关 dialog
    onApplyConfig(gameWindow.hwnd, config, trimmed);
    setDialogOpen(false);
    setAutoStartAfterClose(false);

    // 如果现有 worker 的 taskType 与新 config 不一致,先停掉再重新 bootstrap
    let liveWorker = worker;
    if (liveWorker && liveWorker.taskType !== config.type) {
      await onCancelBootstrap(gameWindow.hwnd);
      await new Promise((r) => setTimeout(r, 200));
      liveWorker = undefined;
    }

    if (liveWorker) {
      // 已有同类型 worker,直接 start-task
      const startRes = await onStartTask(gameWindow.hwnd);
      if (!startRes.ok) {
        alert(`已保存任务,但启动失败: ${startRes.error || '未知错误'}\n请稍后在 WindowCard 上重试`);
      }
    } else {
      // 没有 worker(或刚被 kill 错类型)→ bootstrap with correct type
      const bRes = await onBootstrap(gameWindow.hwnd, characterName || '角色', config.type, config);
      if (!bRes.ok) {
        alert(
          `已保存任务,但 bootstrap 失败: ${bRes.error || '未知错误'}\n请稍后在 WindowCard 上重试`,
        );
        return { ok: true };
      }
      const startRes = await onStartTask(gameWindow.hwnd);
      if (!startRes.ok) {
        alert(`已保存任务,但启动失败: ${startRes.error || '未知错误'}\n请稍后在 WindowCard 上重试`);
      }
    }
    return { ok: true };
  };

  /**
   * "确认":仅写内存,不持久化 → 自动 startTask(关 app 丢)
   */
  const handleTaskConfirm = async (config: TaskConfig) => {
    onApplyConfig(gameWindow.hwnd, config);
    setDialogOpen(false);
    setAutoStartAfterClose(false);
    const startRes = await onStartTask(gameWindow.hwnd);
    if (!startRes.ok) {
      alert(`已应用配置,但启动失败: ${startRes.error || '未知错误'}\n请稍后重试`);
    }
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
              return (
                <img
                  src={thumbnail}
                  alt={`hwnd ${gameWindow.hwnd}`}
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              );
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
                  <Loader2
                    size={24}
                    className="mx-auto mb-1.5 opacity-50 animate-spin text-accent-cyan"
                  />
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
              <span
                className="px-1.5 py-0.5 bg-accent-cyan/20 text-accent-cyan rounded text-[10px] font-medium"
                title="当前任务"
              >
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
                  alert(
                    `截图失败: ${res.error || '未知错误'}\n(该 hwnd 需要先点"创建任务"启动 worker)`,
                  );
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
              <span className="text-sm font-medium truncate">
                {characterName || worker?.character?.name || '(未识别)'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <StatusBadge status={status} animate={status === 'combat'} />
              {worker?.statusDetail && (
                <span
                  className="text-[10px] text-text-muted truncate max-w-[140px]"
                  title={worker.statusDetail}
                >
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
            <button
              onClick={() => setError(null)}
              className="ml-2 text-text-muted hover:text-text-primary"
            >
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
            <button
              disabled
              className="btn btn-primary flex-1 flex items-center justify-center gap-1 opacity-70"
            >
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
              <button
                onClick={handlePause}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1"
              >
                <Pause size={12} />
                暂停
              </button>
              <button
                onClick={handleStop}
                className="btn btn-danger flex-1 flex items-center justify-center gap-1"
              >
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
              <button
                onClick={handleResume}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
              >
                <Play size={12} />
                继续
              </button>
              <button
                onClick={handleStop}
                className="btn btn-danger flex-1 flex items-center justify-center gap-1"
              >
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
                onClick={async () => {
                  // pending 状态:worker 已 ready 但还没收到 start-task
                  //   (上次因 race 暂存过 / 或 worker 还在 waitForConfig 等命令)
                  //   重新发一次 start-task,worker 那边 _startResolve / _pendingStart 都能接住
                  const res = await onStartTask(gameWindow.hwnd);
                  if (!res.ok) alert(`启动失败: ${res.error || '未知'}`);
                }}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
                title="向 worker 发送 start-task(bootstrap-race 兜底)"
              >
                <Play size={12} />
                启动
              </button>
              <button
                onClick={handleAbandon}
                className="btn btn-danger flex items-center justify-center"
                title="放弃当前任务"
              >
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
                disabled={taskHistory.length === 0}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title={taskHistory.length === 0 ? '还没有保存过的任务' : '从历史任务中选择其他任务'}
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
        <TaskConfigDialog
          hwnd={gameWindow.hwnd}
          initialConfig={taskConfig}
          thumbnail={useStore.getState().thumbnails.get(gameWindow.hwnd)}
          workerState={worker || null}
          readOnly={dialogMode === 'view'}
          onClose={handleDialogClose}
          onSaved={handleTaskSaved}
          onConfirm={dialogMode === 'view' ? undefined : handleTaskConfirm}
        />
      )}

      {/* 历史任务 dialog */}
      {historyOpen && (
        <HistoryTaskDialog
          history={taskHistory}
          currentHwnd={gameWindow.hwnd}
          onClose={() => setHistoryOpen(false)}
          onApply={(stored) => handleHistorySelect(stored)}
        />
      )}
    </>
  );
}
