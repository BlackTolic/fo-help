// ProfileLoader: 加载 + 验证 + 兜底默认值

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import type { Profile } from './types';
import {
  DEFAULT_ENGINE,
  DEFAULT_REGIONS,
  DEFAULT_COMBAT,
  DEFAULT_FARM,
} from './defaults';
import { createLogger } from '../logger';

const log = createLogger('profile');

export class ProfileLoader {
  /** 从 YAML 文件加载 Profile,缺失字段用默认值兜底 */
  static load(filePath: string): Profile {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Profile 文件不存在: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const raw = yaml.parse(content) as Partial<Profile>;

    if (!raw.id) throw new Error(`Profile 缺少 id 字段: ${filePath}`);
    if (!raw.name) throw new Error(`Profile 缺少 name 字段: ${filePath}`);
    if (!raw.class) throw new Error(`Profile 缺少 class 字段: ${filePath}`);

    // 合并默认值
    const profile: Profile = {
      id: raw.id,
      name: raw.name,
      game: raw.game || 'qqfantasy',
      version: raw.version || 1,
      description: raw.description,

      engine: { ...DEFAULT_ENGINE, ...(raw.engine || {}) },
      regions: { ...DEFAULT_REGIONS, ...(raw.regions || {}) },
      fontLib: raw.fontLib || './assets/font/0_ffo.txt',
      templates: {
        playerArrow: raw.templates?.playerArrow || './assets/templates/player_arrow.png',
        ...(raw.templates || {}),
      },

      class: raw.class,
      combat: { ...DEFAULT_COMBAT, ...(raw.combat || {}) },
      farm: raw.farm ? { ...DEFAULT_FARM, ...raw.farm } : undefined,

      tasks: raw.tasks || ['farm'],
    };

    // 验证关键字段
    this.validate(profile);
    return profile;
  }

  /** 列出目录下所有 .yaml Profile */
  static listProfiles(dir: string): { id: string; name: string; file: string }[] {
    if (!fs.existsSync(dir)) return [];
    const results: { id: string; name: string; file: string }[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
      const full = path.join(dir, f);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const raw = yaml.parse(content) as Partial<Profile>;
        if (raw?.id && raw?.name) {
          results.push({ id: raw.id, name: raw.name, file: full });
        }
      } catch (e: any) {
        log.warn(`[ProfileLoader] 跳过无效文件 ${f}: ${e.message}`);
      }
    }
    return results;
  }

  private static validate(p: Profile): void {
    // 至少要有一个技能
    const skills = Object.values(p.class.skills || {});
    if (skills.length === 0) {
      log.warn(`[ProfileLoader] Profile ${p.id} 没有配置任何技能`);
    }
    // 字体库存在性检查
    if (p.fontLib && !fs.existsSync(p.fontLib)) {
      log.warn(`[ProfileLoader] 字库文件不存在: ${p.fontLib}`);
    }
    // 模板文件存在性
    for (const [k, v] of Object.entries(p.templates)) {
      if (v && !fs.existsSync(v)) {
        log.warn(`[ProfileLoader] 模板 ${k} 不存在: ${v}`);
      }
    }
  }
}

