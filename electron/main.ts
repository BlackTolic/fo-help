// Electron 主进程入口

import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { RequestChannel } from '../shared/ipc-channels';
import type { GameWindow, TaskType, TaskConfig, WorkerState } from '../shared/types';
import { listGameWindows } from './services/window-registry';
import { WorkerManager } from './services/worker-manager';
import { TaskConfigService } from './services/task-config-service';
import { ThumbnailService } from './services/thumbnail-service';

/**
 * 缩略图本地存储方案:
 * - 不用 base64 dataURL(避免 IPC 传大字符串 + React img 解析慢)
 * - 大漠 dm.Capture 直接写 PNG 到 <项目根>/thumbnails/<hwnd>.png
 * - 测试截图:thumbnails/test-<hwnd>-<ts>.png
 * - renderer 通过自定义协议 thumb://image/<hwnd> 加载(主进程 protocol.handle 映射到本地文件)
 * - app 关闭时清理整个目录
 * - dev 模式放项目根方便看;packaged 放 userData(避免 asar 内写不进去)
 */
const THUMBS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'thumbnails')
  : path.join(app.getAppPath(), 'thumbnails');
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
  /**
   * 保存任务配置(按 name 唯一存储,重名拒绝)
   * payload: { hwnd?: number, config: TaskConfig, name: string }
   * 返回: { ok: boolean, stored?: StoredTaskConfig, error?: string }
   */
  ipcMain.handle(
    RequestChannel.SaveTaskConfig,
    (_e, payload: { hwnd?: number; config: TaskConfig; name: string }) => {
      if (!taskConfigService) taskConfigService = new TaskConfigService();
      if (!payload?.name || !payload?.config) {
        return { ok: false, error: '缺少 name 或 config' };
      }
      return taskConfigService.saveByName(payload.name, payload.config);
    },
  );

  ipcMain.handle(RequestChannel.GetTaskConfig, (_e, hwnd: number) => {
    // 旧 API:按 hwnd 加载(新流程不再使用,保留返回 null 兼容)
    void hwnd;
    return null;
  });

  ipcMain.handle(RequestChannel.ListTaskConfigs, () => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.listAll();
  });

  /**
   * 列出所有已保存的任务配置(全局,跨窗口)
   */
  ipcMain.handle(RequestChannel.ListAllTaskConfigs, () => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.listAll();
  });

  /**
   * 按任务名加载配置
   */
  ipcMain.handle(RequestChannel.LoadTaskByName, (_e, name: string) => {
    if (!taskConfigService) taskConfigService = new TaskConfigService();
    return taskConfigService.loadByName(name);
  });

  // ---- Worker 相关 ----
  ipcMain.handle(
    RequestChannel.StartWorker,
    (
      _e,
      payload: { hwnd: number; characterName: string; taskType: TaskType },
    ): { ok: boolean; workerId?: string; error?: string } => {
      console.log(`[IPC] StartWorker hwnd=${payload.hwnd} task=${payload.taskType}`);
      try {
        // 初始化缩略图缓存
        if (!thumbnailService) thumbnailService = new ThumbnailService();
        // 初始化 worker 管理器
        if (!workerManager) workerManager = new WorkerManager(thumbnailService);
        // 初始化任务配置服务
        if (!taskConfigService) taskConfigService = new TaskConfigService();
        // 新流程:不再按 hwnd 自动加载配置 — 配置由调用方(创建任务/历史任务)显式传入
        const taskConfig = null;
        // 不再读 profile YAML,worker 内部用默认 profile + taskConfig 覆盖 mobFilter
        const wid = workerManager.start(payload.hwnd, payload.characterName, payload.taskType, null, taskConfig);
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
      payload: { hwnd: number; characterName: string },
    ): Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }> => {
      console.log(`[IPC] BootstrapWorker hwnd=${payload.hwnd}`);
      try {
        if (!thumbnailService) thumbnailService = new ThumbnailService();
        if (!workerManager) workerManager = new WorkerManager(thumbnailService);
        // 不再读 profile,worker 用默认 profile + taskConfig 覆盖
        const { dataUrl, characterName } = await workerManager.bootstrap(
          payload.hwnd,
          payload.characterName,
          null,
        );
        console.log(`[IPC] BootstrapWorker OK hwnd=${payload.hwnd} thumb=${dataUrl ? 'yes' : 'no'}`);
        return { ok: true, dataUrl, characterName };
      } catch (err: any) {
        console.error(`[IPC] BootstrapWorker FAIL: ${err.message}`);
        return { ok: false, error: err.message };
      }
    },
  );

  /** 给已 bootstrap 的 worker 发 start-task 命令,进入战斗循环(等 worker ready 后再发) */
  ipcMain.handle(RequestChannel.StartTask, async (_e, hwnd: number): Promise<{ ok: boolean; error?: string }> => {
    console.log(`[IPC] StartTask hwnd=${hwnd}`);
    if (!workerManager) return { ok: false, error: 'WorkerManager 未初始化' };
    return await workerManager.startTask(hwnd);
  });

  /** 通过 hwnd 找到 workerId 停止(用于取消 bootstrap) */
  ipcMain.handle(RequestChannel.StopWorkerByHwnd, (_e, hwnd: number): { ok: boolean } => {
    if (!workerManager) return { ok: false };
    return { ok: workerManager.stopByHwnd(hwnd) };
  });

  /**
   * 截图测试:让 worker 截一张到 thumbnails/test-<hwnd>-<ts>.png
   * 用于评估大漠截图精度,不影响正常 thumbnail 流
   * 前提:该 hwnd 已有 worker(否则需先点"创建任务")
   */
  ipcMain.handle('worker:capture-test', async (_e, hwnd: number) => {
    if (!workerManager) return { ok: false, error: 'WorkerManager 未初始化' };
    return await workerManager.captureTest(hwnd);
  });

  /** 在 Windows 资源管理器里高亮显示某个文件 */
  ipcMain.handle('shell:showItemInFolder', (_e, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
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
      // thumb://image/<hwnd> 形式(hostname 固定 'image',避免纯数字 hwnd 被错认为 IPv4)
      const hwnd = url.pathname.replace(/^\//, '');
      if (!/^\d+$/.test(hwnd)) {
        return new Response('bad hwnd', { status: 400 });
      }
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
  console.log(`[thumbs] 目录: ${THUMBS_DIR} (协议 thumb://image/<hwnd>)`);

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
