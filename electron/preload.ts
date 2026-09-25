/**
 * Electron 预加载脚本。
 *
 * 作用：
 * 1. 在开启 `contextIsolation` 时，向渲染进程安全暴露有限 IPC 能力；
 * 2. 统一收敛 renderer -> main 的调用入口；
 * 3. 为 renderer 侧提供稳定的类型边界，避免直接访问 `ipcRenderer`。
 */
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import { RequestChannel, PushChannel } from '../shared/ipc-channels';
import type {
  GameWindow,
  TaskType,
  TaskConfig,
  StoredTaskConfig,
  WorkerState,
  AppSettings,
} from '../shared/types';

type Unsubscribe = () => void;
interface WorkerLogPayload {
  workerId: string;
  level: string;
  msg: string;
  timestamp: number;
}
interface WorkerErrorPayload {
  workerId: string;
  error: unknown;
  timestamp: number;
}
interface ThumbnailUpdatePayload {
  hwnd: number;
  dataUrl: string | null;
}

/**
 * 订阅主进程推送事件，并返回取消订阅函数。
 * 渲染层组件卸载时应主动调用返回函数，避免重复监听。
 */
function onPush<T>(channel: PushChannel, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/** 渲染进程可访问的桥接 API。 */
const api = {
  // ===== 游戏窗口 =====
  /** 获取当前识别到的游戏窗口列表。 */
  listGameWindows: (): Promise<GameWindow[]> => ipcRenderer.invoke(RequestChannel.ListGameWindows),

  /** 主动触发一次窗口列表刷新。 */
  refreshGameWindows: (): Promise<GameWindow[]> =>
    ipcRenderer.invoke(RequestChannel.RefreshGameWindows),

  /** 读取指定窗口当前缓存的缩略图。 */
  captureWindow: (hwnd: number): Promise<string | null> =>
    ipcRenderer.invoke(RequestChannel.CaptureWindow, hwnd),

  /** 强制指定窗口重截缩略图，并刷新主进程缓存。 */
  recaptureThumbnail: (hwnd: number): Promise<string | null> =>
    ipcRenderer.invoke('thumbnail:recapture', hwnd),

  // ===== Worker 控制 =====
  /** 直接启动 worker，并立即按 `taskType` 进入对应任务流程。 */
  startWorker: (
    hwnd: number,
    characterName: string,
    taskType: TaskType,
  ): Promise<{ ok: boolean; workerId?: string; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.StartWorker, { hwnd, characterName, taskType }),

  /**
   * Bootstrap 模式:启动 worker 但停在 idle,等 thumbnail + start-task
   * taskType + taskConfig 由上层传过来(默认 'farm' + null):
   *   - 加载历史任务时:taskType=stored.config.type, taskConfig=stored.config
   *   - 创建新任务时:可不传,worker 仅作 thumbnail 预览用途
   */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
    taskType?: TaskType,
    taskConfig?: TaskConfig,
  ): Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.BootstrapWorker, {
      hwnd,
      characterName,
      taskType,
      taskConfig,
    }),

  /** 给已 bootstrap 的 worker 发送开始命令，进入战斗/任务流程。
   * taskType + taskConfig 由调用方在 dialog 保存后才确定,worker 收到后覆盖 init 字段分派
   */
  startTask: (
    hwnd: number,
    taskType?: TaskType,
    taskConfig?: TaskConfig | null,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.StartTask, { hwnd, taskType, taskConfig }),

  /** 通过窗口句柄停止 worker，常用于取消 bootstrap。 */
  stopWorkerByHwnd: (hwnd: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(RequestChannel.StopWorkerByHwnd, hwnd),

  /** 执行一次测试截图，返回实际写入的文件路径。 */
  captureTest: (hwnd: number): Promise<{ ok: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('worker:capture-test', hwnd),

  /** 在 Windows 资源管理器中定位并高亮某个文件。 */
  showItemInFolder: (filePath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath),

  /** 按 workerId 停止指定 worker。 */
  stopWorker: (workerId: string): Promise<boolean> =>
    ipcRenderer.invoke(RequestChannel.StopWorker, workerId),

  /** 暂停指定 worker。 */
  pauseWorker: (workerId: string): Promise<boolean> =>
    ipcRenderer.invoke(RequestChannel.PauseWorker, workerId),

  /** 恢复已暂停的 worker。 */
  resumeWorker: (workerId: string): Promise<boolean> =>
    ipcRenderer.invoke(RequestChannel.ResumeWorker, workerId),

  /** 获取当前所有 worker 的状态快照。 */
  listWorkers: (): Promise<WorkerState[]> => ipcRenderer.invoke(RequestChannel.ListWorkers),

  // 大漠插件注册
  /** 检查大漠 dll 是否已注册到当前项目自带的 dm.dll(返回 ok, status, message) */
  checkDamoo: (): Promise<{
    ok: boolean;
    status?: {
      kind: 'ok' | 'wrong' | 'missing' | 'no-dll';
      path?: string;
      registeredPath?: string;
      expectedPath?: string;
      reason?: string;
    };
    message?: string;
    error?: string;
  }> => ipcRenderer.invoke(RequestChannel.CheckDamoo),

  /** 触发 UAC → regsvr32 /s 注册项目自带的 dm.dll(用户需在桌面 UAC 弹窗点"是") */
  registerDamoo: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.RegisterDamoo),

  // ===== 应用设置 =====
  /** 读取应用设置(分辨率 / 大漠注册码 / 大模型 API key) */
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke(RequestChannel.GetAppSettings),

  /** 合并保存应用设置,返回保存后的完整设置 */
  saveAppSettings: (
    patch: Partial<AppSettings>,
  ): Promise<{ ok: boolean; settings: AppSettings; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.SaveAppSettings, patch),

  // 任务配置
  /** 保存任务配置(按 name 唯一存储,hwnd 参数保留仅用于兼容) */
  saveTaskConfig: (
    hwnd: number,
    config: TaskConfig,
    name: string,
  ): Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.SaveTaskConfig, { hwnd, config, name }),

  /** 列出所有已保存的任务(全局,按任务名) */
  listAllTaskConfigs: (): Promise<StoredTaskConfig[]> =>
    ipcRenderer.invoke(RequestChannel.ListAllTaskConfigs),

  /** 按任务名加载配置 */
  loadTaskByName: (name: string): Promise<StoredTaskConfig | null> =>
    ipcRenderer.invoke(RequestChannel.LoadTaskByName, name),

  /**
   * 按 name 删除任务(从磁盘移除 JSON 文件)
   * 用于历史任务列表的"删除"按钮
   */
  deleteTaskConfig: (name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.DeleteTaskConfig, name),

  /**
   * 原地更新已有任务的 config(保留 id/createdAt)
   * 用于历史任务编辑:保存到磁盘、不启动 worker
   */
  updateTaskConfig: (
    name: string,
    config: TaskConfig,
  ): Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }> =>
    ipcRenderer.invoke(RequestChannel.UpdateTaskConfig, { name, config }),

  /** 旧 API 保留(返回 null,新流程不再按 hwnd 加载) */
  getTaskConfig: (hwnd: number): Promise<TaskConfig | null> =>
    ipcRenderer.invoke(RequestChannel.GetTaskConfig, hwnd),

  // ===== 事件订阅 =====
  /** 订阅 worker 状态变化；返回值为取消订阅函数。 */
  onWorkerStateChanged: (cb: (state: WorkerState) => void): Unsubscribe =>
    onPush(PushChannel.WorkerStateChanged, cb),

  /** 订阅 worker 日志推送；适合驱动日志面板。 */
  onWorkerLog: (cb: (log: WorkerLogPayload) => void): Unsubscribe =>
    onPush(PushChannel.WorkerLog, cb),

  /** 订阅 worker 错误推送；用于 UI 告警或异常上报。 */
  onWorkerError: (cb: (err: WorkerErrorPayload) => void): Unsubscribe =>
    onPush(PushChannel.WorkerError, cb),

  /** 订阅弹框中断事件(验证码/组队邀请等弹框的检测与处理结果)。 */
  onWorkerInterrupt: (
    cb: (event: {
      workerId: string;
      kind: string;
      popupType: string;
      detail: string;
      at: number;
    }) => void,
  ): Unsubscribe => onPush(PushChannel.WorkerInterrupt, cb),

  /** 订阅后台缩略图更新。 */
  onThumbnailUpdate: (cb: (data: ThumbnailUpdatePayload) => void): Unsubscribe =>
    onPush(PushChannel.ThumbnailUpdate, cb),
};

contextBridge.exposeInMainWorld('fohelp', api);

export type FohelpAPI = typeof api;
