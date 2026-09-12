// WindowCard: 单个游戏窗口卡片
// 状态机:
//   unconfigured  → [创建任务]
//     ↓ (点创建任务,启动 bootstrap)
//   creating      → loading(连接大漠/绑窗/截图)
//     ↓ (bootstrap 完成: thumbnail 已推送 + worker idle='等待启动')
//   ready         → [启动] [编辑]  (有 taskConfig + worker 已就绪等命令)
//     ↓ (点启动,发 start-task)
//   running       → [暂停] [停止]
//   paused        → [继续] [停止]
//
// ready/running/paused 状态下的"停止"会 exit worker,下次点"启动"要重新 bootstrap

import { useState } from 'react';
import { Play, Pause, Square, Settings, Pencil, RefreshCw, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { TaskConfigDialog } from './TaskConfigDialog';
import type { GameWindow, TaskConfig, WorkerState } from '../../shared/types';
import { StatusBadge } from './StatusBadge';

interface Props {
  gameWindow: GameWindow;
  worker?: WorkerState;
  characterName?: string;     // OCR mock 出来的角色名
  taskConfig?: TaskConfig | null;
  onStart: (hwnd: number, characterName: string, taskType: string) => void;
  onStartTask: (hwnd: number) => void;
  onBootstrap: (hwnd: number, characterName: string) => Promise<{ ok: boolean; error?: string }>;
  onCancelBootstrap: (hwnd: number) => void;
  onStop: (workerId: string) => void;
  onPause: (workerId: string) => void;
  onResume: (workerId: string) => void;
  onTaskSaved: (hwnd: number, config: TaskConfig) => void;
}

export function WindowCard({
  gameWindow, worker, characterName, taskConfig,
  onStart, onStartTask, onBootstrap, onCancelBootstrap,
  onStop, onPause, onResume, onTaskSaved,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // bootstrap 进行中(从点"创建任务"到 dialog 打开 / 失败)
  const [isCreating, setIsCreating] = useState(false);
  // 标记 dialog 是不是 create 流程开的(用于关闭时是否 cancel bootstrap)
  const [dialogFromCreate, setDialogFromCreate] = useState(false);
  // 错误信息(bootstrap 失败)
  const [error, setError] = useState<string | null>(null);

  // 从 store 读主进程推送的缩略图
  const thumbnail = useStore((s) => s.thumbnails.get(gameWindow.hwnd));
  const status = worker?.status || 'idle';
  const isConfigured = !!taskConfig;
  const isRunning = worker && status !== 'idle' && status !== 'paused';
  const isPaused = worker && status === 'paused';

  // 派生 UI 状态
  let uiState: 'unconfigured' | 'creating' | 'ready' | 'running' | 'paused';
  if (!isConfigured) {
    uiState = 'unconfigured';
  } else if (isCreating) {
    uiState = 'creating';
  } else if (isRunning) {
    uiState = 'running';
  } else if (isPaused) {
    uiState = 'paused';
  } else {
    uiState = 'ready';
  }

  // ---- handlers ----

  const handleCreateTask = async () => {
    setError(null);
    setIsCreating(true);
    const name = characterName || worker?.character?.name || '角色';
    const res = await onBootstrap(gameWindow.hwnd, name);
    if (!res.ok) {
      setIsCreating(false);
      setError(res.error || '启动 worker 失败');
      return;
    }
    setIsCreating(false);
    setDialogFromCreate(true);
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    // create 流程的 dialog 没保存就关闭 -> 停掉 worker
    if (dialogFromCreate) {
      onCancelBootstrap(gameWindow.hwnd);
      setDialogFromCreate(false);
    }
    setDialogOpen(false);
  };

  const handleTaskSaved = (cfg: TaskConfig) => {
    onTaskSaved(gameWindow.hwnd, cfg);
    setDialogFromCreate(false);
    setDialogOpen(false);
  };

  const handleStart = () => {
    if (worker) {
      // worker 已存在(从 create 流程来的) -> 发 start-task
      onStartTask(gameWindow.hwnd);
    } else {
      // 没 worker(reload 后) -> 走老逻辑(直接启动进战斗)
      const name = characterName || '角色';
      onStart(gameWindow.hwnd, name, taskConfig!.type);
    }
  };

  return (
    <>
      <div className="card overflow-hidden flex flex-col">
        {/* 缩略图 */}
        <div className="relative aspect-[4/3] bg-bg-input border-b border-border-base flex items-center justify-center">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={`hwnd ${gameWindow.hwnd}`}
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : gameWindow.isMinimized ? (
            <div className="text-text-muted text-xs text-center p-3">
              <div className="text-2xl mb-1 opacity-50">📉</div>
              <div>窗口已最小化</div>
            </div>
          ) : isCreating ? (
            <div className="text-text-muted text-xs text-center p-3">
              <Loader2 size={24} className="mx-auto mb-1.5 opacity-50 animate-spin text-accent-cyan" />
              <div>正在连接游戏…</div>
              <div className="text-text-muted/60 mt-1 text-[10px]">大漠绑定 + 截图</div>
            </div>
          ) : (
            <div className="text-text-muted text-xs text-center p-3">
              <div className="text-2xl mb-1 opacity-50">🚫</div>
              <div>无法截取</div>
              <div className="text-text-muted/60 mt-1 text-[10px]">游戏可能启用了反截图保护</div>
            </div>
          )}
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-mono text-text-secondary">
            hwnd {gameWindow.hwnd}
          </div>
          {/* 右上角状态标签 + 刷新按钮 */}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5">
            {!isConfigured && (
              <span className="px-1.5 py-0.5 bg-accent-yellow/20 text-accent-yellow rounded text-[10px] font-medium">
                未配置
              </span>
            )}
            {isConfigured && (
              <span className="px-1.5 py-0.5 bg-accent-green/20 text-accent-green rounded text-[10px] font-medium">
                {taskConfig!.type === 'farm' && '挂机打怪'}
                {taskConfig!.type === 'mine' && '挖矿'}
                {taskConfig!.type === 'catch-pet' && '捕捉宠物'}
                {taskConfig!.type === 'refine' && '装备炼化'}
                {taskConfig!.type === 'reputation' && '名誉任务'}
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
          </div>
        </div>

        {/* 角色 + 状态(已配置才显示) */}
        {isConfigured && (
          <div className="px-3 py-2 border-b border-border-base space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">
                {characterName || worker?.character?.name || '(未识别)'}
              </span>
              {uiState !== 'creating' && (
                <button
                  onClick={() => setDialogOpen(true)}
                  className="text-text-muted hover:text-accent-cyan"
                  title="编辑任务"
                >
                  <Pencil size={12} />
                </button>
              )}
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
            <button onClick={() => setError(null)} className="ml-2 text-text-muted hover:text-text-primary">×</button>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="p-2 flex gap-1.5">
          {uiState === 'unconfigured' && (
            <button
              onClick={handleCreateTask}
              className="btn btn-primary flex-1 flex items-center justify-center gap-1"
            >
              <Settings size={12} />
              创建任务
            </button>
          )}

          {uiState === 'creating' && (
            <button disabled className="btn btn-primary flex-1 flex items-center justify-center gap-1 opacity-70">
              <Loader2 size={12} className="animate-spin" />
              连接中…
            </button>
          )}

          {uiState === 'ready' && (
            <>
              <button
                onClick={handleStart}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
              >
                <Play size={12} />
                启动
              </button>
              <button
                onClick={() => setDialogOpen(true)}
                className="btn btn-secondary flex items-center justify-center"
                title="编辑任务"
              >
                <Pencil size={12} />
              </button>
            </>
          )}

          {uiState === 'running' && (
            <>
              <button
                onClick={() => worker && onPause(worker.workerId)}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1"
              >
                <Pause size={12} />
                暂停
              </button>
              <button
                onClick={() => worker && onStop(worker.workerId)}
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
                onClick={() => worker && onResume(worker.workerId)}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
              >
                <Play size={12} />
                继续
              </button>
              <button
                onClick={() => worker && onStop(worker.workerId)}
                className="btn btn-danger flex-1 flex items-center justify-center gap-1"
              >
                <Square size={12} />
                停止
              </button>
            </>
          )}
        </div>
      </div>

      {/* 任务配置 dialog */}
      {dialogOpen && (
        <TaskConfigDialog
          hwnd={gameWindow.hwnd}
          initialConfig={taskConfig || null}
          thumbnail={thumbnail}
          onClose={handleDialogClose}
          onSaved={handleTaskSaved}
        />
      )}
    </>
  );
}
