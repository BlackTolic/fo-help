// 任务配置服务:按 hwnd 存/读 TaskConfig
// 简单用 JSON 文件存储,放在 %APPDATA%/QQ幻想助手/task-configs/<hwnd>.json

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { StoredTaskConfig, TaskConfig } from '../../shared/types';

const STORAGE_DIR = path.join(app.getAppPath(), 'task-configs');

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function fileFor(hwnd: number): string {
  return path.join(STORAGE_DIR, `${hwnd}.json`);
}

export class TaskConfigService {
  /** 保存某 hwnd 的任务配置 */
  save(hwnd: number, config: TaskConfig): StoredTaskConfig {
    ensureDir();
    const now = Date.now();
    const existing = this.load(hwnd);
    const stored: StoredTaskConfig = {
      id: existing?.id ?? `task-${hwnd}-${now}`,
      taskType: config.type,
      config,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    fs.writeFileSync(fileFor(hwnd), JSON.stringify(stored, null, 2), 'utf-8');
    return stored;
  }

  /** 读某 hwnd 的任务配置,没有返回 null */
  load(hwnd: number): StoredTaskConfig | null {
    const f = fileFor(hwnd);
    if (!fs.existsSync(f)) return null;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** 列出所有任务配置 */
  listAll(): StoredTaskConfig[] {
    ensureDir();
    const results: StoredTaskConfig[] = [];
    for (const f of fs.readdirSync(STORAGE_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, f), 'utf-8'));
        results.push(raw);
      } catch {
        // skip
      }
    }
    return results;
  }

  /** 删除 */
  delete(hwnd: number): boolean {
    const f = fileFor(hwnd);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
  }
}
