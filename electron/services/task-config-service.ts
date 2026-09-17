// 任务配置服务:按"任务名(name)"存/读 TaskConfig
// 用户为每个任务起唯一名字,跨游戏窗口复用
// 文件名 = sanitize(name).json,放在 %APPDATA%/QQ幻想助手/task-configs/

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { StoredTaskConfig, TaskConfig } from '../../shared/types';

const STORAGE_DIR = path.join(app.getAppPath(), 'task-configs');

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * 文件名安全化:把用户输入的任务名转成可作文件名的字符串
 * - Windows 非法字符: \ / : * ? " < > |
 * - 控制字符、空格保留
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function fileFor(name: string): string {
  return path.join(STORAGE_DIR, `${sanitizeFilename(name)}.json`);
}

export interface SaveResult {
  ok: boolean;
  stored?: StoredTaskConfig;
  error?: string;
}

export class TaskConfigService {
  /** 检查任务名是否已存在(全局唯一) */
  exists(name: string): boolean {
    return fs.existsSync(fileFor(name));
  }

  /**
   * 保存任务配置(按 name)
   * - 重名拒绝(error: 'name exists'),让用户换名字
   * - 不修改文件保留原 id/createdAt,只更新 updatedAt + config
   */
  saveByName(name: string, config: TaskConfig): SaveResult {
    if (!name || !name.trim()) {
      return { ok: false, error: '任务名不能为空' };
    }
    ensureDir();
    const trimmedName = name.trim();
    if (this.exists(trimmedName)) {
      return { ok: false, error: `任务名"${trimmedName}"已存在,请换一个名字` };
    }
    const now = Date.now();
    const stored: StoredTaskConfig = {
      id: `task-${trimmedName}-${now}`,
      name: trimmedName,
      taskType: config.type,
      config,
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(fileFor(trimmedName), JSON.stringify(stored, null, 2), 'utf-8');
    return { ok: true, stored };
  }

  /**
   * 原地更新已有任务(历史任务编辑流程)
   * - 必须已存在,否则 reject
   * - 保留 id / createdAt,只更新 config + updatedAt
   * - 不改文件名
   */
  updateByName(name: string, config: TaskConfig): SaveResult {
    if (!name || !name.trim()) {
      return { ok: false, error: '任务名不能为空' };
    }
    const trimmedName = name.trim();
    const existing = this.loadByName(trimmedName);
    if (!existing) {
      return { ok: false, error: `任务"${trimmedName}"不存在,无法更新` };
    }
    const stored: StoredTaskConfig = {
      ...existing,
      taskType: config.type,
      config,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(fileFor(trimmedName), JSON.stringify(stored, null, 2), 'utf-8');
    return { ok: true, stored };
  }

  /** 按 name 读 */
  loadByName(name: string): StoredTaskConfig | null {
    const f = fileFor(name);
    if (!fs.existsSync(f)) return null;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** 列出所有保存的任务配置(全局,按 updatedAt 倒序) */
  listAll(): StoredTaskConfig[] {
    ensureDir();
    const results: StoredTaskConfig[] = [];
    for (const f of fs.readdirSync(STORAGE_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(STORAGE_DIR, f), 'utf-8'),
        ) as StoredTaskConfig;
        // 跳过旧版本数据(没 name 字段)
        if (!raw.name) continue;
        results.push(raw);
      } catch {
        // skip corrupted file
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按 name 删除 */
  deleteByName(name: string): boolean {
    const f = fileFor(name);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
  }
}
