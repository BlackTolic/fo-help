// 红药数量读取器:OCR 快捷栏红药数量文字,提取数字
//
// 快捷栏数量常见 "x99" / "×99" 前缀,OCR 结果里只取第一段连续数字;
// 区域内没有任何数字(红药栏空 / OCR 失败)返回 null,调用方自行决定按 0 处理还是跳过。
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { POTION_COUNT_ROI } from '../constant-ocr/potion';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';

/** 读快捷栏红药数量;提取不到数字返回 null */
export function readPotionCount(client: DamooClient, size: WindowSizeKey): number | null {
  const roi = POTION_COUNT_ROI[size];
  const text = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim) || '');
  const m = text.match(/(\d{1,4})/);
  return m ? parseInt(m[1], 10) : null;
}
