// 快捷栏红药数量的 OCR 区域常量
// 坐标来源:1600*900 为 ffo-auto-tool 实测值;1280*800 按 x*0.8、y*0.8889 等比缩放估算(见 TODO 标注)
// 判定流程见 core/perception/PotionCounter.ts

import type { WindowSizeKey } from './popup';

type DM_OCR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/** 快捷栏红药数量文字区域:OCR 后用正则提取数字(容忍 'x99'、'×99' 等前缀) */
export const POTION_COUNT_ROI: DM_OCR = {
  '1600*900': { x1: 1245, y1: 858, x2: 1344, y2: 957, color: 'e8f0e8-111111', sim: 1.0 },
  // TODO(标定): 由 1600*900 缩放估算,需用户实测修正
  '1280*800': { x1: 996, y1: 763, x2: 1075, y2: 851, color: 'e8f0e8-111111', sim: 1.0 },
};
