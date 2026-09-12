// Electron 主进程入口

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { RequestChannel } from '../shared/ipc-channels';
import type { GameWindow, TaskType, TaskConfig, WorkerState } from '../shared/types';
import { listGameWindows } from './services/window-registry';
import { WorkerManager } from './services/worker-manager';
import { ProfileService, type ProfileInfo } from './services/profile-service';
import { TaskConfigService } from './services/task-config-service';
import { ThumbnailService } from './services/thumbnail-service';

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

/** 广播给所有 BrowserWindow */
function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** 启动某个 hwnd 的后台截图 + 推送 */
function startThumbnailWatch(hwnd: number) {
  if (!thumbnailService) thumbnailService = new ThumbnailService();
  thumbnailService.startWatching(
    hwnd,
    (targetHwnd, dataUrl) => {
      broadcast('thumbnail:update', { hwnd: targetHwnd, dataUrl });
    },
    2000,  // 2 秒一张
  );
}

/** 停止某个 hwnd 的截图(预留给以后按需停) */
void function stopThumbnailWatch(hwnd: number) {
  thumbnailService?.stopWatching(hwnd);
};

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

function setupIpc() {
  // ---- 窗口相关 ----
  ipcMain.handle(RequestChannel.ListGameWindows, async (): Promise<GameWindow[]> => {
    const wins = await listGameWindows();
    // 启动后台截图 watcher(每个 hwnd 一个)
    for (const w of wins) startThumbnailWatch(w.hwnd);
    return wins;
  });

  ipcMain.handle(RequestChannel.RefreshGameWindows, async (): Promise<GameWindow[]> => {
    const wins = await listGameWindows();
    for (const w of wins) startThumbnailWatch(w.hwnd);
    return wins;
  });

  // 截图指定 hwnd 缩略图(dataURL) - 直接返回缓存,避免重复截
  ipcMain.handle(RequestChannel.CaptureWindow, async (_e, hwnd: number) => {
    if (!thumbnailService) thumbnailService = new ThumbnailService();
    const cached = thumbnailService.getCached(hwnd);
    if (cached) return cached;
    return await thumbnailService.capture(hwnd);
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

// 启动 app
app.whenReady().then(() => {
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
  thumbnailService?.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  workerManager?.shutdownAll();
  thumbnailService?.stopAll();
});
