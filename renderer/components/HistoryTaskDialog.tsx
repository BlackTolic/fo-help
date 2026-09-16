// 历史任务 dialog:列出全局所有已保存的任务(按名字),选一条应用到当前 hwnd
// 数据来源:store.taskHistory(全局,跨窗口复用)

import { X, FileText, Swords, Pickaxe, PawPrint, Hammer, Trophy } from 'lucide-react';
import type { TaskType, StoredTaskConfig } from '../../shared/types';

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
                    className="flex items-center gap-3 p-3 rounded border bg-bg-input border-border-base hover:border-accent-cyan/50 cursor-pointer"
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
    </div>
  );
}
