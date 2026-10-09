// 死亡弹框的识别区域常量
// 坐标来源:1600*900 为 ffo-auto-tool 实测值;1280*800 按 x*0.8、y*0.8889 等比缩放估算(见 TODO 标注)
// 判定流程见 core/perception/DeathDetector.ts

import type { WindowSizeKey } from './popup';

type DM_OCR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/** 死亡弹框「死亡」文字区域:OCR 结果包含"死亡" = 角色已死 */
export const DEAD_TEXT_ROI: DM_OCR = {
  '1600*900': { x1: 707, y1: 377, x2: 891, y2: 541, color: 'a8a8b0-111111', sim: 1.0 },
  // TODO(标定): 由 1600*900 缩放估算,需用户实测修正
  '1280*800': { x1: 566, y1: 335, x2: 713, y2: 481, color: 'a8a8b0-111111', sim: 1.0 },
};

/** 死亡弹框「原地复活」按钮文字 */
export const REVIVE_TEXT = '原地复活';

/** 「原地复活」按钮文字的找字区域(findStrE 命中即返回按钮坐标) */
export const REVIVE_TEXT_ROI: DM_OCR = {
  '1600*900': { x1: 622, y1: 373, x2: 990, y2: 537, color: 'e8f0e8-111111', sim: 1.0 },
  // TODO(标定): 由 1600*900 缩放估算,需用户实测修正
  '1280*800': { x1: 498, y1: 298, x2: 792, y2: 430, color: 'e8f0e8-111111', sim: 1.0 },
};
