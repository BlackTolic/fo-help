// IPC 通道定义

/** Renderer → Main(请求) */
export enum RequestChannel {
  // 窗口
  ListGameWindows = 'window:list',
  RefreshGameWindows = 'window:refresh',
  CaptureWindow = 'window:capture',         // 截取指定 hwnd 的缩略图

  // Worker
  StartWorker = 'worker:start',
  BootstrapWorker = 'worker:bootstrap',   // 启动 worker 但停在 idle 等命令(等任务配置 + 启动信号)
  StartTask = 'worker:start-task',        // 给已 bootstrap 的 worker 发"开始执行"信号
  StopWorkerByHwnd = 'worker:stop-by-hwnd', // 通过 hwnd 找到 workerId 停止(用于取消 bootstrap)
  StopWorker = 'worker:stop',
  PauseWorker = 'worker:pause',
  ResumeWorker = 'worker:resume',
  ListWorkers = 'worker:list',

  // 任务配置
  SaveTaskConfig = 'task:save',             // 保存任务配置(挂到 hwnd)
  GetTaskConfig = 'task:get',               // 读任务配置
  ListTaskConfigs = 'task:list',            // 列出所有任务

  // Profile
  ListProfiles = 'profile:list',
  LoadProfile = 'profile:load',
}

/** Main → Renderer(推送事件) */
export enum PushChannel {
  GameWindowsChanged = 'window:changed',   // 游戏窗口列表变化
  WorkerStateChanged = 'worker:state',     // Worker 状态变化
  WorkerLog = 'worker:log',                 // Worker 日志
  WorkerError = 'worker:error',             // Worker 错误
  ThumbnailUpdate = 'thumbnail:update',     // 后台截图推送
}
