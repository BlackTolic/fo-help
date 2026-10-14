// 背包/装备已装满提示的检测区域常量(「条件回城 → 背包已满时回城」用)
//
// 判据(用户实测):聊天框一带出现「背包里放不下这件物品」或「背包里装备已装满」= 背包/装备已经装满
// (点地上的物品捡不起来时,游戏会把这句话打进聊天框)
// 判定流程见 core/perception/BagFullDetector.ts。
//
// 坐标来源:
//   1280*800 = 用户实测,区域 (0,575)-(410,790)。
//   1600*900 = 按比例换算(x × 1600/1280,y × 900/800),⚠️ 未实测。
//     ⚠️ 聊天框贴的是窗口左下角(见 farm.ts 的 BLOCK_RECTS_1280),1600*900 若实测发现提示落在区域外,
//        先试"整块区域跟着下边平移 100px"(不是等比放大 y)。
// 颜色:用户实测 e85048-111111(与 core/constant-ocr/color.ts 的 COLOR_RED 同值)。
// 相似度:找字用 DEFAULT_SIM(1.0)、OCR 兜底用 DEFAULT_FUZZY_SIM(0.9)。
// 字库:两条文案用到的字在默认字库 assets/font/0_ffo.txt 里都有(已核对),找字不必额外换字库。

import { COLOR_RED } from './color';
import type { WindowSizeKey } from './popup';
import { DEFAULT_FUZZY_SIM, DEFAULT_SIM } from './sim';

/** 一个分辨率档位下的检测区域 + 颜色 + 相似度 */
export interface BagFullRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 提示文字颜色(大漠颜色串) */
  color: string;
  /** 找字的相似度 */
  findSim: number;
  /** OCR 兜底的相似度(OCR 比找字松一点) */
  ocrSim: number;
}

/** 提示区域(按分辨率档位;缺档位 = 该分辨率没有实测值,检测不生效,由调用方提示一次) */
export const BAG_FULL_ROI: Partial<Record<WindowSizeKey, BagFullRoi>> = {
  '1280*800': { x1: 0, y1: 575, x2: 410, y2: 790, color: COLOR_RED, findSim: DEFAULT_SIM, ocrSim: DEFAULT_FUZZY_SIM },
  // 1600*900:按比例推算,未实测(见文件头)
  '1600*900': { x1: 0, y1: 647, x2: 513, y2: 889, color: COLOR_RED, findSim: DEFAULT_SIM, ocrSim: DEFAULT_FUZZY_SIM },
};

/** 提示文案(逐个找字,命中任意一条即算背包已满) */
export const BAG_FULL_TEXTS = ['背包里放不下这件物品', '背包里装备已装满'];

/** OCR 兜底用的片段(找字依赖字库/颜色,整串匹配不上时按片段判) */
export const BAG_FULL_OCR_KEYWORDS = ['放不下', '已装满'];
