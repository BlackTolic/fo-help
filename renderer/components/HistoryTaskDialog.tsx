// 历史任务 dialog:列出全局所有已保存的任务(按名字),
// 选用 → 应用到当前 hwnd + 立即启动 任务
// 编辑 → 弹 TaskConfigDialog 锁名字,保存后**不启动**,只更新磁盘
//
// 数据来源:store.taskHistory(全局,跨窗口复用)

import { useState } from 'react';
import { X, FileText, Swords, Pickaxe, PawPrint, Hammer, Trophy, Pencil } from 'lucide-react';
import type { TaskType, StoredTaskConfig, TaskConfig } from '../../shared/types';
import { useStore } from '../store/useStore';
import { TaskConfigDialog } from './TaskConfigDialog';

const TASK_LABEL: Record<TaskType, { name: string; Icon: any }> = {
  farm: { name: '挂机打怪', Icon: Swords },
  mine: { name: '挖矿', Icon: Pickaxe },
  'catch-pet': { name: '捕捉宠物', Icon: PawPrint },
  refine: { name: '装备炼化', Icon: Hammer },
  reputation: { name: '名誉任务', Icon: Trophy },
};

interface Props {
  /** 全局所有已保存的任务(去重后,每个 name 一条) */
  history: StoredTaskConfig[];
  /** 当前窗口(只用于 UI 显示) */
  currentHwnd: number;
  onClose: () => void;
  /**
   * 选择一条任务后,父组件会:
   *   1. 加载配置
   *   2. 应用到 currentHwnd(走"未保存"路径,关 app 丢,或重新保存)
   *   3. bootstrap + startTask,直接开始跑
   */
  onApply: (stored: StoredTaskConfig) => void;
}

export function HistoryTaskDialog({ history, currentHwnd, onClose, onApply }: Props) {
  /**
   * 编辑模式:点某行的「编辑」进入。这时整个 dialog 上叠一层 TaskConfigDialog。
   * - initialConfig = 该任务的 config
   * - initialTaskName = 锁定的任务名
   * - 走 updateTaskByName 后**不启动 worker**,只持久化
   * 保存成功后切回 null,关闭编辑对话框,刷新 history 让 user 看到改动。
   */
  const [editing, setEditing] = useState<StoredTaskConfig | null>(null);
  const updateTaskByName = useStore((s) => s.updateTaskByName);
  const loadTaskHistory = useStore((s) => s.loadTaskHistory);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-card border border-border-base rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-border-base flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileText size={14} className="text-accent-cyan" />
            <span className="text-text-primary font-medium">历史任务</span>
            <span className="text-text-muted text-xs">({history.length} 条,全局共享)</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {history.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-xs">
              <div className="text-3xl mb-2 opacity-30">📋</div>
              <div>还没有保存过任何任务</div>
              <div className="mt-1">
                先在 WindowCard 上点"创建任务" → 选好 → 点"保存配置" + 输入名字
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {history.map((stored) => {
                const { name, Icon } = TASK_LABEL[stored.config.type] || {
                  name: '未知',
                  Icon: FileText,
                };
                return (
                  <div
                    key={stored.name}
                    className="flex items-center gap-3 p-3 rounded border bg-bg-input border-border-base hover:border-accent-cyan/50"
                    onClick={() => onApply(stored)}
                    title={`点击将此任务应用到 hwnd ${currentHwnd}`}
                  >
                    <Icon size={18} className="text-text-secondary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{stored.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan">
                          {name}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {stored.config.type === 'farm' && (
                          <>
                            地图 {(stored.config as any).mapId} · 模式 {(stored.config as any).mode}{' '}
                            ·{' '}
                          </>
                        )}
                        更新于 {new Date(stored.updatedAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <button
                      className="text-xs px-2 py-1 bg-bg-hover hover:bg-bg-input text-text-secondary hover:text-text-primary rounded border border-border-base flex items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(stored);
                      }}
                      title="编辑这个任务(只更新磁盘,不启动)"
                    >
                      <Pencil size={11} />
                      编辑
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        onApply(stored);
                      }}
                    >
                      选用
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border-base text-[11px] text-text-muted">
          点击某条任务将其加载到 hwnd {currentHwnd} 并立即启动任务流程
        </footer>
      </div>

      {/* 编辑任务的子 dialog:叠在历史 dialog 之上 */}
      {editing && (
        <TaskConfigDialog
          hwnd={currentHwnd}
          initialConfig={editing.config}
          initialTaskName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={async (newConfig: TaskConfig, name: string) => {
            const res = await updateTaskByName(name, newConfig);
            if (res.ok) {
              // 刷新 history 列表,关掉编辑 dialog
              await loadTaskHistory();
              setEditing(null);
            } else {
              // 错误留在 dialog 内,因为 input 锁了,弹 alert 最直观
              alert(`保存失败: ${res.error || '未知错误'}`);
            }
            return res;
          }}
        />
      )}
    </div>
  );
}
