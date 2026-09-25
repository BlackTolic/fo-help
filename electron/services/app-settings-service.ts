// 应用设置服务:设置面板(分辨率 / 大漠注册码 / 大模型 API key)的本地持久化
// 存储为单个 JSON 文件:
//   - dev:      <项目根>/app-settings.json
//   - packaged: %APPDATA%/QQ幻想助手/app-settings.json
// 每次读写都直接走文件(文件极小),保证主进程/worker 随时拿到最新值。

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { AppSettings } from '../../shared/types';

const SETTINGS_FILE = app.isPackaged
  ? path.join(app.getPath('userData'), 'app-settings.json')
  : path.join(app.getAppPath(), 'app-settings.json');

const DEFAULTS: AppSettings = {
  resolution: null,
  damooRegisterCode: '',
  damooAttachCode: '',
  dashscopeApiKey: '',
};

function read(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return {
        ...DEFAULTS,
        ...(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as AppSettings),
      };
    }
  } catch {
    /* 文件损坏时按未设置处理 */
  }
  return { ...DEFAULTS };
}

function write(settings: AppSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

/** 读取当前设置(不存在时返回默认值) */
export function getAppSettings(): AppSettings {
  return read();
}

/** 合并保存设置,返回保存后的完整设置 */
export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...read(), ...patch };
  write(next);
  return next;
}
