// 提醒用户(main 进程):应用内右下角浮层 + 系统通知
// 场景:worker 侧遇到"该提醒用户、但流程还得继续跑"的情况(如未配置图鉴账号),
//       上报 { type: 'notify' } 消息,由主进程统一提醒。
//
// 两条路同时发:
//   1) 应用内浮层(PushChannel.AppToast → renderer/ToastHost):主力。本应用始终以管理员运行
//      (win.requestedExecutionLevel = requireAdministrator),而 Windows 不显示提权进程发出的
//      toast 横幅;系统开了"专注助手/勿扰"时横幅同样会被吞掉,只有应用内浮层一定看得见。
//   2) 系统通知(Windows 右下角 toast):尽力而为,失败只记日志。
//
// 去重:同一个 key 在本次运行内只提醒一次 —— 多开时每个游戏窗口一个 worker(配置改一次会重建),
//       同一件事只提示一次,不重复打扰。不落盘:重启应用后允许再提醒一次。

import { BrowserWindow, Notification } from 'electron';
import { PushChannel } from '../../shared/ipc-channels';
import type { AppToastPayload } from '../../shared/types';
import { createLogger } from '../../core/logger';

const log = createLogger('notification');

/** 本次运行内已提醒过的 key */
const shownKeys = new Set<string>();

export interface NotifyOptions {
  /** 去重键(全局唯一标识"这件事"),如 'tujian-not-configured' */
  key: string;
  title: string;
  body: string;
}

/** 把提醒推给所有渲染窗口(右下角浮层) */
function pushToWindows(payload: AppToastPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PushChannel.AppToast, payload);
  }
}

/**
 * 提醒一次(应用内浮层 + 系统通知);同一 key 重复调用会被忽略
 * @returns 本次是否是首次提醒(去重命中返回 false)
 */
export function notifyOnce({ key, title, body }: NotifyOptions): boolean {
  if (shownKeys.has(key)) return false;
  // 先记 key:系统不支持 / 弹窗异常也不重复提示,避免每次触发都白跑一遍
  shownKeys.add(key);

  pushToWindows({ key, title, body });

  try {
    if (!Notification.isSupported()) {
      log.warn(`系统不支持通知,仅弹应用内浮层: ${title}`);
      return true;
    }
    new Notification({ title, body }).show();
    log.info(`已推送通知[${key}]: ${title} — ${body}`);
  } catch (e: any) {
    log.warn(`推送系统通知失败[${key}](应用内浮层已发): ${e?.message || e}`);
  }
  return true;
}
