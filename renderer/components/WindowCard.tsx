// 单窗口卡片:4 元素(缩略图 + 角色名 + 任务名 + 状态)

import { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import type { GameWindow, WorkerState, TaskType } from '../../shared/types';
import { StatusBadge } from './StatusBadge';

const CLASS_ICON: Record<string, string> = {
  warrior: '⚔',
  mage: '🔮',
  taoist: '☯',
  archer: '🏹',
  assassin: '🗡',
};

interface Props {
  gameWindow: GameWindow;
  worker?: WorkerState;
  profiles: { id: string; name: string }[];
  onStart: (hwnd: number, characterName: string, taskType: TaskType, profileId?: string) => void;
  onStop: (workerId: string) => void;
  onPause: (workerId: string) => void;
  onResume: (workerId: string) => void;
}

export function WindowCard({ gameWindow, worker, profiles, onStart, onStop, onPause, onResume }: Props) {
  const [taskType, setTaskType] = useState<TaskType>('farm');
  const [characterName, setCharacterName] = useState(`角色-${gameWindow.hwnd}`);
  const [profileId, setProfileId] = useState<string>(profiles[0]?.id || '');

  const classIcon = worker ? (CLASS_ICON[worker.character?.class || ''] || '⚔') : '⚔';
  const status = worker?.status || 'idle';
  const animate = status === 'combat' || status === 'alert';

  return (
    <div className="card overflow-hidden flex flex-col">
      {/* 缩略图区(P1 占位) */}
      <div className="relative aspect-[4/3] bg-bg-input border-b border-border-base flex items-center justify-center">
        {worker ? (
          <div className="text-text-muted text-xs text-center p-4">
            <div className="text-2xl mb-2">🎮</div>
            <div>实时画面</div>
            <div className="text-text-muted/60 mt-1">(P2 接入截图)</div>
          </div>
        ) : (
          <div className="text-text-muted text-xs text-center p-4">
            <div className="text-2xl mb-2 opacity-50">○</div>
            <div>未启动</div>
          </div>
        )}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-mono text-text-secondary">
          hwnd {gameWindow.hwnd}
        </div>
      </div>

      {/* 信息区 */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        {/* 角色名 */}
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-base">{classIcon}</span>
          {worker ? (
            <span>{worker.character?.name || '未命名'}</span>
          ) : (
            <input
              className="bg-transparent border-b border-border-base outline-none focus:border-accent-cyan text-sm flex-1"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="角色名"
            />
          )}
        </div>

        {/* 任务名 */}
        <div className="text-xs text-text-secondary flex items-center gap-2">
          <span className="text-text-muted">任务:</span>
          {worker?.taskName ? (
            <span className="text-text-primary">{worker.taskName}</span>
          ) : (
            <select
              className="bg-bg-input border border-border-base rounded px-1.5 py-0.5 text-xs outline-none focus:border-accent-cyan"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
            >
              <option value="farm">挂机打怪</option>
              <option value="mine">挖矿</option>
              <option value="catch-pet">捕捉宠物</option>
              <option value="refine">装备炼化</option>
              <option value="reputation">名誉任务</option>
            </select>
          )}
        </div>

        {/* Profile 选择 */}
        {!worker && profiles.length > 0 && (
          <div className="text-xs text-text-secondary flex items-center gap-2">
            <span className="text-text-muted">Profile:</span>
            <select
              className="bg-bg-input border border-border-base rounded px-1.5 py-0.5 text-xs outline-none focus:border-accent-cyan flex-1 min-w-0"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* 状态 */}
        <div className="flex items-center justify-between">
          <StatusBadge status={status} animate={animate} />
          {worker?.statusDetail && (
            <span className="text-[10px] text-text-muted truncate max-w-[120px]" title={worker.statusDetail}>
              {worker.statusDetail}
            </span>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="border-t border-border-base p-2 flex gap-1.5">
        {!worker ? (
          <button
            className="btn btn-primary flex-1 flex items-center justify-center gap-1"
            onClick={() => onStart(gameWindow.hwnd, characterName, taskType, profileId)}
          >
            <Play size={12} />
            启动
          </button>
        ) : (
          <>
            {worker.status === 'paused' ? (
              <button
                className="btn btn-primary flex-1 flex items-center justify-center gap-1"
                onClick={() => onResume(worker.workerId)}
              >
                <Play size={12} />
                继续
              </button>
            ) : (
              <button
                className="btn btn-secondary flex-1 flex items-center justify-center gap-1"
                onClick={() => onPause(worker.workerId)}
              >
                <Pause size={12} />
                暂停
              </button>
            )}
            <button
              className="btn btn-danger flex items-center justify-center gap-1"
              onClick={() => onStop(worker.workerId)}
            >
              <Square size={12} />
              停止
            </button>
          </>
        )}
      </div>
    </div>
  );
}
