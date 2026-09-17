// 主面板

import { useEffect } from 'react';
import {
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useStore, subscribeToIpc } from './store/useStore';
import { WindowCard } from './components/WindowCard';

function App() {
  const gameWindows = useStore((s) => s.gameWindows);
  const workers = useStore((s) => s.workers);
  const taskConfigs = useStore((s) => s.taskConfigs);
  const appliedTaskNames = useStore((s) => s.appliedTaskNames);
  const characterNames = useStore((s) => s.characterNames);
  const refreshWindows = useStore((s) => s.refreshWindows);
  const loadTaskHistory = useStore((s) => s.loadTaskHistory);
  const applyTaskConfig = useStore((s) => s.applyTaskConfig);
  const clearTaskConfig = useStore((s) => s.clearTaskConfig);
  const startWorker = useStore((s) => s.startWorker);
  void startWorker; // 旧 API 保留(直接启动战斗循环),新流程用 bootstrapWorker
  const bootstrapWorker = useStore((s) => s.bootstrapWorker);
  const startTask = useStore((s) => s.startTask);
  const cancelBootstrap = useStore((s) => s.cancelBootstrap);
  const stopWorker = useStore((s) => s.stopWorker);
  const pauseWorker = useStore((s) => s.pauseWorker);
  const resumeWorker = useStore((s) => s.resumeWorker);

  // 大漠注册相关状态
  const damooStatus = useStore((s) => s.damooStatus);
  const damooMessage = useStore((s) => s.damooMessage);
  const damooExpectedPath = useStore((s) => s.damooExpectedPath);
  const checkDamoo = useStore((s) => s.checkDamoo);
  const registerDamoo = useStore((s) => s.registerDamoo);

  useEffect(() => {
    // 订阅 IPC 事件
    subscribeToIpc();
    // 刷新窗口列表
    refreshWindows();
    // 加载全局历史任务列表
    loadTaskHistory();
    // 启动体检:大漠注册状态(异步,横幅会自己刷新)
    checkDamoo();
    // 每 3 秒刷新窗口列表
    const t = setInterval(refreshWindows, 3000);
    return () => clearInterval(t);
  }, [refreshWindows, loadTaskHistory, checkDamoo]);

  // ⚠️ 新流程:不再自动 loadTaskConfig(每个窗口都需要用户主动选"创建/历史")

  const workersByHwnd = new Map<number, string>();
  for (const [wid, w] of workers) workersByHwnd.set(w.hwnd, wid);

  const allWorkers = Array.from(workers.values());
  const runningCount = allWorkers.filter(
    (w) => w.status !== 'paused' && w.status !== 'idle',
  ).length;

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
            游戏窗口 <span className="text-text-primary font-mono">{gameWindows.length}</span>
          </span>
          <span className="text-text-muted">·</span>
          <span>
            运行中 <span className="text-accent-green font-mono">{runningCount}</span>
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

      {/* 大漠插件健康条 */}
      {(damooStatus === 'warn' ||
        damooStatus === 'checking' ||
        damooStatus === 'registering' ||
        damooStatus === 'error') && (
        <div
          className={[
            'flex items-center gap-3 px-6 py-2 text-sm border-b border-border-base',
            damooStatus === 'warn'
              ? 'bg-amber-500/10 text-amber-200'
              : damooStatus === 'registering'
                ? 'bg-blue-500/10 text-blue-200'
                : damooStatus === 'checking'
                  ? 'bg-bg-card/40 text-text-secondary'
                  : 'bg-red-500/10 text-red-200',
          ].join(' ')}
        >
          {damooStatus === 'warn' && <AlertTriangle size={16} className="shrink-0" />}
          {damooStatus === 'registering' && <Loader2 size={16} className="shrink-0 animate-spin" />}
          {damooStatus === 'checking' && <Loader2 size={16} className="shrink-0 animate-spin" />}
          {damooStatus === 'error' && <AlertTriangle size={16} className="shrink-0" />}
          <span className="flex-1 truncate">
            {damooStatus === 'checking' && '正在检查大漠注册状态...'}
            {damooStatus === 'registering' && '正在等待 UAC 授权...'}
            {(damooStatus === 'warn' || damooStatus === 'error') &&
              (damooMessage || '大漠插件异常')}
            {damooExpectedPath && (damooStatus === 'warn' || damooStatus === 'error') && (
              <span className="ml-2 text-xs text-text-muted font-mono truncate">
                期望: {damooExpectedPath}
              </span>
            )}
          </span>
          {damooStatus === 'warn' && (
            <button
              className="btn btn-secondary text-xs"
              onClick={async () => {
                const res = await registerDamoo();
                if (!res.ok) {
                  console.warn('[damoo] 注册失败:', res.error);
                }
              }}
            >
              <ShieldCheck size={12} className="mr-1" />
              立即修复
            </button>
          )}
          {damooStatus === 'error' && (
            <button className="btn btn-secondary text-xs" onClick={() => checkDamoo()}>
              重试
            </button>
          )}
        </div>
      )}

      {/* 大漠健康绿色徽章(收起,不打扰) */}
      {damooStatus === 'ok' && (
        <div className="flex items-center gap-2 px-6 py-1.5 text-[11px] text-text-muted border-b border-border-base bg-bg-card/30">
          <CheckCircle2 size={12} className="text-accent-green shrink-0" />
          <span>大漠已就绪</span>
          <span className="font-mono truncate text-text-secondary">{damooExpectedPath}</span>
        </div>
      )}

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
                  characterName={characterNames.get(win.hwnd)}
                  taskConfig={taskConfigs.get(win.hwnd) || null}
                  appliedTaskName={appliedTaskNames.get(win.hwnd) || null}
                  onBootstrap={async (hwnd, name) => {
                    const res = await bootstrapWorker(hwnd, name);
                    return { ok: res.ok, error: res.error };
                  }}
                  onCancelBootstrap={cancelBootstrap}
                  onStartTask={startTask}
                  onStop={stopWorker}
                  onPause={pauseWorker}
                  onResume={resumeWorker}
                  onApplyConfig={(hwnd, config, name) => {
                    applyTaskConfig(hwnd, config, name);
                  }}
                  onClearConfig={(hwnd) => {
                    clearTaskConfig(hwnd);
                  }}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* 底部状态栏 */}
      <footer className="border-t border-border-base bg-bg-card/50 backdrop-blur px-6 py-2 text-[11px] text-text-muted flex items-center justify-between">
        <span>挂机打怪 / 挖矿 / 捕捉宠物 / 装备炼化 / 名誉任务</span>
        <span className="font-mono">大漠 7.2543 · 32-bit Electron</span>
      </footer>
    </div>
  );
}

export default App;
