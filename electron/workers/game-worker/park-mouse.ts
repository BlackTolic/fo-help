// 识别前把鼠标挪出识别区域(鼠标停在区域上会挡住字:OCR/找字都会读错或读不到)
//
// 为什么挪到「离这块区域最远的那个画面角」:
//   - 肯定不在区域内(只要区域没铺满整个画面);
//   - 不会像贴着区域停靠那样,在它旁边弹出 tooltip 又盖住它。
// 区域铺满整个画面时没有角在它外面,只能挪到最远的那个角,效果打折 —— 把识别范围(如「OCR 识别范围」)收小才是根治。
//
// 用它的地方:
//   - tasks/farm.ts:定点识别的怪名扫描 / 小退前清怪 / 物品拾取(这些流程刚点过字,鼠标就停在识别区域里)
//   - pet-training.ts:宠物列表 / 宠物等级 / 宠物技能名(双击换宠后鼠标正停在列表上)

import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import type { IInputProvider } from '../../../core/platform/input/IInputProvider';
import type { Rect } from '../../../core/platform/vision/IVisionProvider';
import { sleep } from '../../../core/utils/sleep';

/** 停靠点离画面边的距离(px) */
const PARK_MARGIN_PX = 8;
/** 挪完之后等它生效(ms):给画面/捕获缓冲一点时间再识别 */
const PARK_SETTLE_MS = 150;

/**
 * 把鼠标挪到离 roi 最远的那个画面角,并等一小会儿。
 * @param size 窗口客户区分辨率(用来算四个角;写成 '宽*高')
 * @param roi 这次要识别的区域(客户区相对坐标)
 */
export async function parkMouseOutsideRoi(input: IInputProvider, size: WindowSizeKey, roi: Rect): Promise<void> {
  const [w, h] = String(size)
    .split('*')
    .map((n) => Number(n) || 0);
  if (!w || !h) return;
  const m = PARK_MARGIN_PX;
  const corners = [
    { x: m, y: m },
    { x: w - m, y: m },
    { x: m, y: h - m },
    { x: w - m, y: h - m },
  ];
  const cx = roi.x + roi.w / 2;
  const cy = roi.y + roi.h / 2;
  const far = corners.reduce((a, b) => (Math.hypot(b.x - cx, b.y - cy) > Math.hypot(a.x - cx, a.y - cy) ? b : a));
  await input.moveMouse(far, { kind: 'instant' });
  await sleep(PARK_SETTLE_MS);
}
