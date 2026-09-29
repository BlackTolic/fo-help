// 角色状态(血条 / 经验条)的找色区域常量
// 坐标来源:移植自 ffo-auto-tool 的 constant/OCR-pos.ts(DEFAULT_BLOOD_STATUS / DEFAULT_EXP_BAR 实测值)
// 判定语义与参考工程 utils/ocr-check/base.ts 的 getBloodStatus / checkExpBar 一致

import { DEFAULT_SIM } from './position';
import type { WindowSizeKey } from './popup';

type DM_FIND_COLOR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/** 大漠找色方向:0 = 从左到右、从上到下 */
export const FIND_COLOR_DIR = 0;

/**
 * 血条区域:区域内还能找到黄/绿色 = 血量安全,找不到 = 血量见底
 * (只看颜色不看具体数值:血条掉完时这一段就没有黄绿像素了)
 */
export const BLOOD_STATUS_ROI: DM_FIND_COLOR = {
  '1600*900': { x1: 124, y1: 26, x2: 168, y2: 36, color: '20ac00-111111|e89828-111111', sim: DEFAULT_SIM },
  '1280*800': { x1: 100, y1: 12, x2: 113, y2: 39, color: '20ac00-111111|e89828-111111', sim: DEFAULT_SIM },
};

/**
 * 经验条区域:区域内找到绿色 = 经验快满了(即将升级)
 * 参考工程两个分辨率用的是同一组坐标,这里原样保留;实测不符再按分辨率改
 */
export const EXP_BAR_ROI: DM_FIND_COLOR = {
  '1600*900': { x1: 1437, y1: 892, x2: 1480, y2: 900, color: '189850-111111', sim: DEFAULT_SIM },
  '1280*800': { x1: 1437, y1: 892, x2: 1480, y2: 900, color: '189850-111111', sim: DEFAULT_SIM },
};
