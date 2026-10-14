// 选择角色界面判据检测器:区域里出现「保护未成年人健康」= 已经退出到选择角色界面
//
// 选择角色界面有三个信号,本模块只管文案那一个(另外两个由调用方读地图名/坐标判断,
// 见 electron/workers/game-worker/relogin.ts):
//   ① 地图名读不出来 ② 坐标读不出来 ③ 这块区域出现「保护未成年人健康」
//
// 颜色用户没说 → 用「不限颜色」(见 core/constant-ocr/relogin.ts);同样有 OCR 兜底:
// 找字依赖字库与颜色,缺字/颜色不匹配会静默不命中(参考 core/constant-ocr/death.ts 顶部的说明)。
// ⚠️ 用「不限颜色」OCR 时等于把所有像素都当文字色,读出噪声的概率比找字高 ——
//    它只是兜底,找字命中时不会走到 OCR 那一路。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { RELOGIN_HINT_OCR_KEYWORDS, RELOGIN_HINT_ROI, RELOGIN_HINT_TEXT } from '../constant-ocr/relogin';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import { parseTextPos } from '../utils/parse';
import { COLOR_WHITE } from '../constant-ocr/color';

export interface CharacterSelectHint {
  /** 文案是否出现(找字或 OCR 片段命中) */
  present: boolean;
  /** 命中的文本(找字 = 常量文案;OCR = OCR 原文);没命中时是 OCR 原文,可能为空串 */
  text: string;
  /** 该分辨率档位没有区域常量 = 这个判据不可能生效(调用方报错/提示) */
  unsupported: boolean;
}

/** 一次检测:先找字「保护未成年人健康」,再 OCR 兜底「未成年人」/「健康」片段 */
export function detectCharacterSelectHint(client: DamooClient, size: WindowSizeKey): CharacterSelectHint {
  const roi = RELOGIN_HINT_ROI[size];
  if (!roi) return { present: false, text: '', unsupported: true };

  const found = parseTextPos(client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, RELOGIN_HINT_TEXT, COLOR_WHITE, roi.findSim));
  if (found) return { present: true, text: RELOGIN_HINT_TEXT, unsupported: false };

  const ocr = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, COLOR_WHITE, roi.ocrSim) || '').trim();
  return { present: RELOGIN_HINT_OCR_KEYWORDS.some((k) => ocr.includes(k)), text: ocr, unsupported: false };
}
