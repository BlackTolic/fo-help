// Electron 主进程入口

import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { RequestChannel } from '../shared/ipc-channels';
import type { GameWindow, TaskType, TaskConfig, WorkerState } from '../shared/types';
import { listGameWindows } from './services/window-registry';
import { WorkerManager } from './services/worker-manager';
import { ProfileService, type ProfileInfo } from './services/profile-service';
import { TaskConfigService } from './services/task-config-service';
import { ThumbnailService } from './services/thumbnail-service';
import chokidar from 'chokidar';

/**
 * 缩略图本地存储方案:
 * - 不用 base64 dataURL(避免 IPC 传大字符串 + React img 解析慢)
 * - 大漠 dm.Capture 直接写 PNG 到 <temp>/fo-help-thumbnails/<hwnd>.png
 * - renderer 通过自定义协议 app://thumb/<hwnd> 加载(主进程 protocol.handle 映射到本地文件)
 * - app 关闭时清理整个目录
 */
const THUMBS_DIR = path.join(app.getPath('temp'), 'fo-help-thumbnails');
export function getThumbsDir(): string { return THUMBS_DIR; }

// 强制 stdout/stderr 用 UTF-8(Windows 默认 GBK,会让中文日志在 PowerShell 显示成乱码)
if (process.stdout && typeof (process.stdout as any).setDefaultEncoding === 'function') {
  (process.stdout as any).setDefaultEncoding('utf8');
}
if (process.stderr && typeof (process.stderr as any).setDefaultEncoding === 'function') {
  (process.stderr as any).setDefaultEncoding('utf8');
}

// 全局异常捕获(防止任何未捕获错误让 Electron 静默退出)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});
process.on('exit', (code) => {
  console.log(`[main process] exit code=${code}`);
});

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let workerManager: WorkerManager | null = null;
let profileService: ProfileService | null = null;
let taskConfigService: TaskConfigService | null = null;
let thumbnailService: ThumbnailService | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'QQ幻想助手',
    backgroundColor: '#0a0e1a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),  // dist-electron/electron/preload.js
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 加载页面
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
    // production auto-reload:监听 dist/ 变化,改了源码 rebuild 后自动刷新
    watchDistAndReload(path.join(__dirname, '..', '..', 'dist'));
  }

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 监听 dist/ 目录,文件变化时 debounce 300ms 后 reload renderer
 * 等价于 HMR 体验(只是全页面 reload,不是模块 hot replace)
 * 只在 production 模式生效 — dev 模式 vite 已经自带 HMR
 */
function watchDistAndReload(distPath: string): void {
  let timer: NodeJS.Timeout | null = null;
  chokidar.watch(distPath, {
    ignored: /(^|[\\/\\\\])\../,  // 忽略 dotfile
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  }).on('all', (event, filePath) => {
    if (filePath.includes('node_modules')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[auto-reload] ${event} ${filePath} → reload`);
        mainWindow.webContents.reload();
      }
    }, 300);
  });
  console.log(`[auto-reload] watching ${distPath}`);
}

function setupIpc() {
  // ---- 窗口相关 ----
  ipcMain.handle(RequestChannel.ListGameWindows, async (): Promise<GameWindow[]> => {
    return await listGameWindows();
  });

  ipcMain.handle(RequestChannel.RefreshGameWindows, async (): Promise<GameWindow[]> => {
    return await listGameWindows();
  });

  // 截图由 worker 用大漠完成,主进程只暴露缓存查询
  ipcMain.handle(RequestChannel.CaptureWindow, async (_e, hwnd: number) => {
    if (!thumbnailService) thumbnailService = new ThumbnailService();
    return thumbnailService.getCached(hwnd) || null;
  });

  // 触发 worker 重截某 hwnd 的缩略图
  ipcMain.handle('thumbnail:recapture', async (_e, hwnd: number) => {
    if (!workerManager) return null;
    return await workerManager.requestThumbnail(hwnd);
  });

  // ---- 任务配置 ----
  ipcMain.handle(RequestChannel.SaveTaskConfig, (_e, hwnd: number, config: TaskConfig) => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.save(hwnd, config);
  });

  ipcMain.handle(RequestChannel.GetTaskConfig, (_e, hwnd: number) => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.load(hwnd);
  });

  ipcMain.handle(RequestChannel.ListTaskConfigs, () => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.listAll();
  });

  // ---- Worker 相关 ----
  ipcMain.handle(
    RequestChannel.StartWorker,
    (
      _e,
      payload: { hwnd: number; characterName: string; taskType: TaskType; profileId?: string },
    ): { ok: boolean; workerId?: string; error?: string } => {
      console.log(`[IPC] StartWorker hwnd=${payload.hwnd} task=${payload.taskType} profile=${payload.profileId}`);
      try {
        if (!workerManager) workerManager = new WorkerManager();
        if (!profileService) profileService = new ProfileService();
        if (!taskConfigService) taskConfigService = new TaskConfigService();
        const profile = payload.profileId ? profileService.load(payload.profileId) : null;
        // 自动加载该 hwnd 的任务配置
        const storedTask = taskConfigService.load(payload.hwnd);
        const taskConfig = storedTask?.config || null;
        const wid = workerManager.start(payload.hwnd, payload.characterName, payload.taskType, profile, taskConfig);
        console.log(`[IPC] StartWorker OK wid=${wid} taskConfig=${taskConfig ? 'loaded' : 'none'}`);
        return { ok: true, workerId: wid };
      } catch (err: any) {
        console.error(`[IPC] StartWorker FAIL: ${err.message}`);
        return { ok: false, error: err.message };
      }
    },
  );

  /**
   * Bootstrap 模式:启动 worker 但停在 idle 等 start-task 命令
   * 等到 thumbnail 推送后返回,renderer 拿去做任务配置 dialog 的预览
   */
  ipcMain.handle(
    RequestChannel.BootstrapWorker,
    async (
      _e,
      payload: { hwnd: number; characterName: string; profileId?: string },
    ): Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }> => {
      console.log(`[IPC] BootstrapWorker hwnd=${payload.hwnd} profile=${payload.profileId}`);
      try {
        if (!workerManager) workerManager = new WorkerManager();
        if (!profileService) profileService = new ProfileService();
        const profile = payload.profileId ? profileService.load(payload.profileId) : null;
        const { dataUrl, characterName } = await workerManager.bootstrap(
          payload.hwnd,
          payload.characterName,
          profile,
        );
        console.log(`[IPC] BootstrapWorker OK hwnd=${payload.hwnd} thumb=${dataUrl ? 'yes' : 'no'}`);
        return { ok: true, dataUrl, characterName };
      } catch (err: any) {
        console.error(`[IPC] BootstrapWorker FAIL: ${err.message}`);
        return { ok: false, error: err.message };
      }
    },
  );

  /** 给已 bootstrap 的 worker 发 start-task 命令,进入战斗循环 */
  ipcMain.handle(RequestChannel.StartTask, (_e, hwnd: number): { ok: boolean } => {
    console.log(`[IPC] StartTask hwnd=${hwnd}`);
    if (!workerManager) return { ok: false };
    return { ok: workerManager.startTask(hwnd) };
  });

  /** 通过 hwnd 找到 workerId 停止(用于取消 bootstrap) */
  ipcMain.handle(RequestChannel.StopWorkerByHwnd, (_e, hwnd: number): { ok: boolean } => {
    if (!workerManager) return { ok: false };
    return { ok: workerManager.stopByHwnd(hwnd) };
  });

  ipcMain.handle(RequestChannel.StopWorker, (_e, workerId: string) => {
    return workerManager?.stop(workerId) ?? false;
  });

  ipcMain.handle(RequestChannel.PauseWorker, (_e, workerId: string) => {
    return workerManager?.pause(workerId) ?? false;
  });

  ipcMain.handle(RequestChannel.ResumeWorker, (_e, workerId: string) => {
    return workerManager?.resume(workerId) ?? false;
  });

  ipcMain.handle(RequestChannel.ListWorkers, (): WorkerState[] => {
    return workerManager?.list() ?? [];
  });

  // ---- Profile 相关 ----
  ipcMain.handle(RequestChannel.ListProfiles, (): ProfileInfo[] => {
    if (!profileService) profileService = new ProfileService();
    return profileService.list();
  });

  ipcMain.handle(RequestChannel.LoadProfile, (_e, id: string) => {
    if (!profileService) profileService = new ProfileService();
    return profileService.load(id);
  });
}

// 自定义协议 thumb://<hwnd> 必须在 app ready 之前注册 scheme privilege
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
  },
]);

/** 清理缩略图目录(关闭时调) */
function cleanupThumbs(): void {
  try {
    if (fs.existsSync(THUMBS_DIR)) {
      for (const f of fs.readdirSync(THUMBS_DIR)) {
        try { fs.unlinkSync(path.join(THUMBS_DIR, f)); } catch { /* noop */ }
      }
      try { fs.rmdirSync(THUMBS_DIR); } catch { /* noop */ }
      console.log(`[thumbs] 清理目录: ${THUMBS_DIR}`);
    }
  } catch (e) {
    console.warn('[thumbs] 清理失败:', (e as Error).message);
  }
}

// 启动 app
app.whenReady().then(() => {
  // 缩略图目录 + 自定义协议
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
  protocol.handle('thumb', (request) => {
    try {
      const url = new URL(request.url);
      // thumb://<hwnd> 形式,hostname 是 hwnd
      const hwnd = url.hostname;
      const filePath = path.join(THUMBS_DIR, `${hwnd}.png`);
      if (!fs.existsSync(filePath)) {
        return new Response('not found', { status: 404 });
      }
      return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`);
    } catch (e) {
      console.error('[thumb protocol] error:', (e as Error).message);
      return new Response('error', { status: 500 });
    }
  });
  console.log(`[thumbs] 目录: ${THUMBS_DIR} (协议 thumb://<hwnd>)`);

  setupIpc();
  createWindow();
  console.log('✅ QQ幻想助手 已启动 v0.1 · 本地版');
  console.log('   - 窗口枚举:PowerShell + Win32 API');
  console.log('   - 大漠:winax 32-bit COM 集成');
  console.log('   - 战斗引擎:挂机打怪 完整循环');
  console.log('   - Profile YAML:3 职业模板已加载');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  workerManager?.shutdownAll();
  thumbnailService?.clearAll();
  cleanupThumbs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  workerManager?.shutdownAll();
  thumbnailService?.clearAll();
});
