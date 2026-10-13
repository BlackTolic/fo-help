// 应用内提醒浮层(右下角)
//   来源:主进程 notifyOnce()(electron/services/notification-service.ts)推送 PushChannel.AppToast
//   为什么不用系统 toast:本应用始终以管理员运行,Windows 不显示提权进程的 toast 横幅,
//   开"专注助手/勿扰"时也会被吞掉;应用内浮层一定看得见。

import { useEffect } from 'react';
import { AlertTriangle, X } from '../icons';
import { useStore } from '../store/useStore';

/** 单条提醒自动消失时间(毫秒) */
const TOAST_TTL_MS = 15000;

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 w-[360px]">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} title={t.title} body={t.body} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

interface ItemProps {
  id: number;
  title: string;
  body: string;
  onDismiss: (id: number) => void;
}

function ToastItem({ id, title, body, onDismiss }: ItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className="card bg-bg-card shadow-lg border-amber-500/40 px-3 py-2 flex items-start gap-2">
      <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="text-xs text-text-secondary leading-relaxed mt-0.5">{body}</div>
      </div>
      <button className="text-text-muted hover:text-text-primary shrink-0" onClick={() => onDismiss(id)} title="关闭">
        <X size={14} />
      </button>
    </div>
  );
}
