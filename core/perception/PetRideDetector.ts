// 宠物骑乘检测:宠物是否已激活 / 是否已经骑上坐骑
//
// isPetActive 移植自 ffo-auto-tool 的 utils/ocr-check/base.ts 的 checkPetActive:
//   OCR 宠物激活区域,读到「暂时没有宠物」= 没激活(区域常量见 core/constant-ocr/pet.ts)。
// isPetMounted 用找字:在骑乘提示区域里找「飞毛腿来啦」/「骑驴看唱板儿」,
//   坐标解析成功才算命中(dm 没找到返回空串或 "-1|-1|-1":见 utils/parse 的 parseTextPos)。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { PET_ACTIVE_ROI, PET_INACTIVE_TEXT, PET_MOUNT_TEXT_COLOR, PET_MOUNT_TEXT_ROI, PET_MOUNT_TEXTS } from '../constant-ocr/pet';
import { DEFAULT_SIM } from '../constant-ocr/sim';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import { parseTextPos } from '../utils/parse';

/** 宠物是否已激活(读到「暂时没有宠物」= 没激活;OCR 读空按参考实现视为已激活) */
export function isPetActive(client: DamooClient, size: WindowSizeKey): boolean {
  const roi = PET_ACTIVE_ROI[size];
  const text = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim) || '');
  return !text.includes(PET_INACTIVE_TEXT);
}

/** 是否已经骑上坐骑(骑乘提示区域里找字,命中任一即算已骑上) */
export function isPetMounted(client: DamooClient): boolean {
  const r = PET_MOUNT_TEXT_ROI;
  return PET_MOUNT_TEXTS.some((t) => parseTextPos(client.findStrE(r.x1, r.y1, r.x2, r.y2, t, PET_MOUNT_TEXT_COLOR, DEFAULT_SIM)) !== null);
}
