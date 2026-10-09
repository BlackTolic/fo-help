// 死亡检测器:判断角色是否死亡 + 定位「原地复活」按钮
//
// 原理:死亡后游戏弹出死亡弹框(「死亡」标题 + 「原地复活」按钮),均为定点 UI:
//   isDead()             OCR 死亡弹框标题区域(DEAD_TEXT_ROI),结果包含"死亡" = 已死
//   findReviveButton()   findStrE 在按钮区域找「原地复活」文字,命中坐标即按钮位置(用于点击复活)
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { DEAD_TEXT_ROI, REVIVE_TEXT, REVIVE_TEXT_ROI } from '../constant-ocr/death';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { parseFindColor } from '../utils/parse';

/** 角色是否已死亡(死亡弹框「死亡」标题 OCR 命中) */
export function isDead(client: DamooClient, size: WindowSizeKey): boolean {
  const roi = DEAD_TEXT_ROI[size];
  const text = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim) || '');
  return text.includes('死亡');
}

/** 找「原地复活」按钮,返回按钮文字坐标(用于点击);找不到返回 undefined */
export function findReviveButton(client: DamooClient, size: WindowSizeKey): Point | undefined {
  const roi = REVIVE_TEXT_ROI[size];
  const found = client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, REVIVE_TEXT, roi.color, roi.sim);
  return parseFindColor(found) ?? undefined;
}
