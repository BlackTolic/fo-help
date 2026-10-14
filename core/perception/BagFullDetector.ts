// 背包/装备已满检测器:在提示区域(见 core/constant-ocr/bag.ts)找那两句提示
//
// 两个信号(命中其一即算背包已满):
//   1) 找字「背包里放不下这件物品」/「背包里装备已装满」(主判据)
//   2) OCR 兜底:整段 OCR 里含「放不下」/「已装满」片段即算
//      —— 找字与 OCR 都依赖字库(SetDict):大漠找字只比对待查字符串里出现过的那些字,缺一个字就静默
//         匹配不上(见 core/constant-ocr/death.ts 顶部关于默认字库没有「死」「亡」的说明),
//         所以不能只留找字这一路。
//
// 判定是同步的(dm 的 FindStrFastEx / Ocr 都是同步调用),调用方按低频重操作对待:
// 只在勾了「背包已满时回城」时才调它(见 tasks/farm.ts 的 scanBagFullOnce)。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { BAG_FULL_OCR_KEYWORDS, BAG_FULL_ROI, BAG_FULL_TEXTS } from '../constant-ocr/bag';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import { parseTextPos } from '../utils/parse';

export interface BagFullDetection {
  /** 是否检测到「背包已满」提示 */
  full: boolean;
  /** 命中的文本(找字命中 = 常量文案;OCR 命中 = OCR 原文);没命中时是 OCR 原文,可能为空串 */
  text: string;
  /** 该分辨率档位没有检测区域常量 = 这个条件不可能生效(调用方应在启动时提示一次) */
  unsupported: boolean;
}

/**
 * 一次检测:先逐个找字,再 OCR 兜底。
 * 返回对象而不是布尔:text 带出来方便打日志排查(实测"为什么一直没命中"先看它)。
 */
export function detectBagFull(client: DamooClient, size: WindowSizeKey): BagFullDetection {
  const roi = BAG_FULL_ROI[size];
  if (!roi) return { full: false, text: '', unsupported: true };

  for (const text of BAG_FULL_TEXTS) {
    const hit = parseTextPos(client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, text, roi.color, roi.findSim));
    if (hit) return { full: true, text, unsupported: false };
  }

  const ocr = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.ocrSim) || '').trim();
  return { full: BAG_FULL_OCR_KEYWORDS.some((k) => ocr.includes(k)), text: ocr, unsupported: false };
}
