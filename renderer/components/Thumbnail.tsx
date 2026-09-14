// 缩略图组件:显示 game 窗口截图
// 支持自动定时刷新

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  hwnd: number;
  refreshMs?: number;       // 自动刷新间隔,0 = 不自动刷新
  className?: string;
}

export function Thumbnail({ hwnd, refreshMs = 0, className = '' }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const capture = async () => {
    if (!window.fohelp) return;
    setLoading(true);
    try {
      const url = await window.fohelp.captureWindow(hwnd);
      if (url) {
        setDataUrl(url);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    capture();
    if (refreshMs > 0) {
      const t = setInterval(capture, refreshMs);
      return () => clearInterval(t);
    }
    return undefined;
  }, [hwnd, refreshMs]);

  return (
    <div className={`relative w-full h-full bg-bg-input flex items-center justify-center ${className}`}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`hwnd ${hwnd}`}
          className="w-full h-full object-contain"
          draggable={false}
        />
      ) : error ? (
        <div className="text-text-muted text-xs text-center p-3">
          <div className="text-2xl mb-1 opacity-50">📷</div>
          <div>无法截取</div>
          <div className="text-text-muted/60 mt-1 text-[10px]">窗口被遮挡或最小化</div>
        </div>
      ) : (
        <div className="text-text-muted text-xs text-center p-3">
          <div className="text-2xl mb-1 opacity-30 animate-pulse">⏳</div>
          <div>截取中...</div>
        </div>
      )}

      {loading && dataUrl && (
        <div className="absolute top-1.5 right-1.5 bg-black/60 rounded px-1.5 py-0.5 text-[10px] text-text-muted flex items-center gap-1">
          <RefreshCw size={10} className="animate-spin" />
          刷新中
        </div>
      )}
    </div>
  );
}
