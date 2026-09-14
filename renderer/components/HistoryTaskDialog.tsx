// 历史任务 dialog:列出所有已保存的任务配置,选一条加载到当前 hwnd
// 来源:renderer/store/useStore.savedHwnds(只含已持久化的)

import { X, FileText, Swords, Pickaxe, PawPrint, Hammer, Trophy } from 'lucide-react';
import type { TaskType, TaskConfig } from '../../shared/types';

const TASK_LABEL: Record<TaskType, { name: string; Icon: any }> = {
  farm: { name: '挂机打怪', Icon: Swords },
  mine: { name: '挖矿', Icon: Pickaxe },
  'catch-pet': { name: '捕捉宠物', Icon: PawPrint },
  refine: { name: '装备炼化', Icon: Hammer },
  reputation: { name: '名誉任务', Icon: Trophy },
};

interface HistoryItem {
  hwnd: number;
  config: TaskConfig;
  /** 是否已持久化(否则是仅内存的"未保存"配置) */
  saved: boolean;
  /** 当前游戏窗口的标题(从 gameWindows 查) */
  title?: string;
}

interface Props {
  history: HistoryItem[];
  currentHwnd: number;
  onClose: () => void;
  /** 选择一条后,加载到 currentHwnd(不持久化,走"未保存"路径) */
  onApply: (hwnd: number, config: TaskConfig) => void;
  /** true = 包含 currentHwnd 自身(用于在 TaskConfigDialog 内嵌时复用自己) */
  includeCurrent?: boolean;
}

export function HistoryTaskDialog({
  history, currentHwnd, onClose, onApply, includeCurrent = false,
}: Props) {
  // includeCurrent=false 时过滤掉当前 hwnd
  const visible = includeCurrent
    ? history
    : history.filter((it) => it.hwnd !== currentHwnd);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-card border border-border-base rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-border-base flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileText size={14} className="text-accent-cyan" />
            <span className="text-text-primary font-medium">历史任务</span>
            <span className="text-text-muted text-xs">({history.length} 条)</span>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {visible.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-xs">
              <div className="text-3xl mb-2 opacity-30">📋</div>
              <div>还没有保存过任何任务配置</div>
              <div className="mt-1">先在 WindowCard 上点"创建任务" → 选好 → 点"保存配置"</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visible.map((item) => {
                const { name, Icon } = TASK_LABEL[item.config.type] || { name: '未知', Icon: FileText };
                const isCurrent = item.hwnd === currentHwnd;
                return (
                  <div
                    key={item.hwnd}
                    className={`
                      flex items-center gap-3 p-3 rounded border
                      ${isCurrent
                        ? 'bg-accent-cyan/10 border-accent-cyan/40'
                        : 'bg-bg-input border-border-base hover:border-accent-cyan/50 cursor-pointer'}
                    `}
                    onClick={() => !isCurrent && onApply(item.hwnd, item.config)}
                    title={isCurrent ? '当前窗口' : '点击加载此配置到当前窗口'}
                  >
                    <Icon size={18} className="text-text-secondary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{name}</span>
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-accent-cyan/30 text-accent-cyan rounded">
                            当前
                          </span>
                        )}
                        {!item.saved && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-accent-yellow/20 text-accent-yellow rounded">
                            未保存
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        hwnd {item.hwnd} · {item.title || '(窗口已关闭)'}
                        {item.config.type === 'farm' && (
                          <> · 地图 {(item.config as any).mapId} · 模式 {(item.config as any).mode}</>
                        )}
                      </div>
                    </div>
                    {!isCurrent && (
                      <button
                        className="text-xs px-2 py-1 bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan rounded"
                        onClick={(e) => { e.stopPropagation(); onApply(item.hwnd, item.config); }}
                      >
                        加载
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border-base text-[11px] text-text-muted">
          点击某条记录将其配置加载到当前窗口(走"未保存"路径,关 app 丢)
        </footer>
      </div>
    </div>
  );
}
