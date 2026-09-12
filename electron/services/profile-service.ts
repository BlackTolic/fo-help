// Profile 服务:扫描 profiles 目录,提供加载/列表

import path from 'path';
import { app } from 'electron';
import { ProfileLoader } from '../../core/profile/ProfileLoader';
import type { Profile } from '../../core/profile/types';

const PROFILES_DIR = path.join(app.getAppPath(), 'profiles');

export interface ProfileInfo {
  id: string;
  name: string;
  description?: string;
  file: string;
}

export class ProfileService {
  /** 列出所有 Profile(仅元信息) */
  list(): ProfileInfo[] {
    return ProfileLoader.listProfiles(PROFILES_DIR).map((p) => {
      try {
        const full = ProfileLoader.load(p.file);
        return {
          id: full.id,
          name: full.name,
          description: full.description,
          file: p.file,
        };
      } catch {
        return { id: p.id, name: p.name, file: p.file };
      }
    });
  }

  /** 加载完整 Profile(传给 worker) */
  load(id: string): Profile | null {
    const list = ProfileLoader.listProfiles(PROFILES_DIR);
    const target = list.find((p) => p.id === id);
    if (!target) return null;
    return ProfileLoader.load(target.file);
  }
}
