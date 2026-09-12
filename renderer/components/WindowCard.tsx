// WindowCard 重构版
// 两态:已配置(显示缩略图+角色名+状态) / 未配置(只显示缩略图+创建任务+启动)

import { useState } from 'react';
import { Play, Pause, Square, Settings, Pencil } from 'lucide-react';
import { Thumbnail } from './Thumbnail';
import { TaskConfigDialog } from './TaskConfigDialog';
import type { GameWindow, TaskConfig, WorkerState } from '../../shared/types';
import { StatusBadge } from './StatusBadge';

interface Props {
  gameWindow: GameWindow;
  worker?: WorkerState;
  characterName?: string;     // OCR mock 出来的角色名
  taskConfig?: TaskConfig | null;
  onStart: (hwnd: number, characterName: string, taskType: string) => void;
  onStop: (workerId: string) => void;
  onPause: (workerId: string) => void;
  onResume: (workerId: string) => void;
  onTaskSaved: (hwnd: number, config: TaskConfig) => void;
}

export function WindowCard({
  gameWindow, worker, characterName, taskConfig,
  onStart, onStop, onPause, onResume, onTaskSaved,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = worker?.status || 'idle';
  const isConfigured = !!taskConfig;
  const isRunning = worker && status !== 'idle' && status !== 'paused';
  const isPaused = worker && status === 'paused';

  return (
    <>
      <div className="card overflow-hidden flex flex-col">
        {/* 缩略图 */}
        <div className="relative aspect-[4/3] bg-bg-input border-b border-border-base">
          <Thumbnail hwnd={gameWindow.hwnd} refreshMs={3000} />
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-mono text-text-secondary">
            hwnd {gameWindow.hwnd}
          </div>
          {!isConfigured && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-accent-yellow/20 text-accent-yellow rounded text-[10px] font-medium">
              未配置
            </div>
          )}
          {isConfigured && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-accent-green/20 text-accent-green rounded text-[10px] font-medium">
              {taskConfig!.type === 'farm' && '挂机打怪'}
              {taskConfig!.type === 'mine' && '挖矿'}
              {taskConfig!.type === 'catch-pet' && '捕捉宠物'}
              {taskConfig!.type === 'refine' && '装备炼化'}
              {taskConfig!.type === 'reputation' && '名誉任务'}
            </div>
          )}
        </div>

        {/* 角色 + 状态(已配置才显示) */}
        {isConfigured && (
          <div className="px-3 py-2 border-b border-border-base space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">
                {characterName || worker?.character?.name || '(未识别)'}
              </span>
              <button
                onClick={() => setDialogOpen(true)}
                className="text-text-muted hover:text-accent-cyan"
                title="编辑任务"
              >
                <Pencil size={12} />
              </button>
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

        {/* 操作按钮 */}
        <div className="p-2 flex gap-1.5">
          {!isConfigured ? (
            <>
              <button
                onClick={() => setDialogOpen(true)}
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
              >
                <Settings size={12} />
                创建任务
              </button>
              <button
                disabled
                className="btn btn-secondary opacity-50 cursor-not-allowed flex-1"
                title="请先创建任务"
              >
                <Play size={12} />
                启动
              </button>
            </>
          ) : isRunning ? (
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
          ) : isPaused ? (
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
          ) : (
            <>
              <button
                onClick={() => {
                  const name = characterName || worker?.character?.name || '角色';
                  onStart(gameWindow.hwnd, name, taskConfig!.type);
                }}
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
        </div>
      </div>

      {/* 任务配置 dialog */}
      {dialogOpen && (
        <TaskConfigDialog
          hwnd={gameWindow.hwnd}
          initialConfig={taskConfig || null}
          onClose={() => setDialogOpen(false)}
          onSaved={(cfg) => {
            onTaskSaved(gameWindow.hwnd, cfg);
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}
