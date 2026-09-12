// IPC 通道定义

/** Renderer → Main(请求) */
export enum RequestChannel {
  // 窗口
  ListGameWindows = 'window:list',
  RefreshGameWindows = 'window:refresh',

  // Worker
  StartWorker = 'worker:start',
  StopWorker = 'worker:stop',
  PauseWorker = 'worker:pause',
  ResumeWorker = 'worker:resume',
  ListWorkers = 'worker:list',

  // Profile
  ListProfiles = 'profile:list',
  LoadProfile = 'profile:load',
  GetDefaultProfile = 'profile:getDefault',
}

/** Main → Renderer(推送事件) */
export enum PushChannel {
  GameWindowsChanged = 'window:changed',   // 游戏窗口列表变化
  WorkerStateChanged = 'worker:state',     // Worker 状态变化
  WorkerLog = 'worker:log',                 // Worker 日志
  WorkerError = 'worker:error',             // Worker 错误
}
