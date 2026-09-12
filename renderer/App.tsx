// 主面板

import { useEffect } from 'react';
import { RefreshCw, Activity } from 'lucide-react';
import { useStore, subscribeToIpc } from './store/useStore';
import { WindowCard } from './components/WindowCard';

function App() {
  const gameWindows = useStore((s) => s.gameWindows);
  const workers = useStore((s) => s.workers);
  const profiles = useStore((s) => s.profiles);
  const refreshWindows = useStore((s) => s.refreshWindows);
  const refreshProfiles = useStore((s) => s.refreshProfiles);
  const startWorker = useStore((s) => s.startWorker);
  const stopWorker = useStore((s) => s.stopWorker);
  const pauseWorker = useStore((s) => s.pauseWorker);
  const resumeWorker = useStore((s) => s.resumeWorker);

  useEffect(() => {
    subscribeToIpc();
    refreshWindows();
    refreshProfiles();
    // 每 3 秒自动刷新窗口列表
    const t = setInterval(refreshWindows, 3000);
    return () => clearInterval(t);
  }, [refreshWindows, refreshProfiles]);

  const workersByHwnd = new Map<number, string>();
  for (const [wid, w] of workers) workersByHwnd.set(w.hwnd, wid);

  const allWorkers = Array.from(workers.values());
  const runningCount = allWorkers.filter((w) => w.status !== 'paused' && w.status !== 'idle').length;

  return (
    <div className="h-full flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-border-base bg-bg-card/50 backdrop-blur px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-accent-cyan to-accent-purple flex items-center justify-center text-bg-base font-bold">
            ⚡
          </div>
          <div>
            <div className="text-base font-semibold">QQ幻想助手</div>
            <div className="text-[11px] text-text-muted">v0.1 · 本地版</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Activity size={14} />
          <span>
            发现 <span className="text-text-primary font-mono">{gameWindows.length}</span> 个游戏窗口
          </span>
          <span className="text-text-muted">·</span>
          <span>
            运行中 <span className="text-accent-green font-mono">{runningCount}</span> 个
          </span>
          <button
            className="ml-3 btn btn-secondary flex items-center gap-1"
            onClick={refreshWindows}
          >
            <RefreshCw size={12} />
            刷新
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto p-6">
        {gameWindows.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="text-6xl mb-4 opacity-30">🎮</div>
              <h2 className="text-lg font-medium mb-2">未检测到 QQ幻想 窗口</h2>
              <p className="text-sm text-text-secondary leading-relaxed">
                请先启动 QQ幻想 游戏,本应用会自动检测窗口并显示在这里。
                <br />
                如果游戏已经打开但没检测到,可能是窗口识别规则不匹配你的私服版本。
              </p>
              <div className="mt-4 text-xs text-text-muted">
                <span className="px-2 py-1 rounded bg-bg-card border border-border-base font-mono">
                  P1 当前识别规则: 进程名含 qq/fantasy/幻想 + 类名 TMainForm
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {gameWindows.map((win) => {
              const wid = workersByHwnd.get(win.hwnd);
              const worker = wid ? workers.get(wid) : undefined;
              return (
                <WindowCard
                  key={win.hwnd}
                  gameWindow={win}
                  worker={worker}
                  profiles={profiles}
                  onStart={(hwnd, name, task, pid) => startWorker(hwnd, name, task, pid)}
                  onStop={stopWorker}
                  onPause={pauseWorker}
                  onResume={resumeWorker}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* 底部状态栏 */}
      <footer className="border-t border-border-base bg-bg-card/50 backdrop-blur px-6 py-2 text-[11px] text-text-muted flex items-center justify-between">
        <span>
          F1-F9 技能 · 拟人化点击 · 多窗口并行
        </span>
        <span className="font-mono">
          P1 脚手架阶段 · 战斗/移动/识别模块待 P2 接入
        </span>
      </footer>
    </div>
  );
}

export default App;
