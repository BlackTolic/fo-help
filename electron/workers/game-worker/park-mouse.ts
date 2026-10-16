// 识别前把鼠标挪开(鼠标停在识别区域上会挡住字:OCR/找字都会读错或读不到)
//
// 固定挪到画面左上角:
//   - 另外三个角都压着游戏 UI:右上角是小地图(鼠标停上去会弹提示、又盖着地图),
//     左下角是聊天框,右下角是快捷栏 —— 只有左上角基本是空的,停在那里最不干扰识别;
//   - 固定一角比"离识别区域最远的那个角"更可预期:不用每次算,也不会这次右上、下次右下。
// 识别范围铺满整个画面时(没配「OCR 识别范围」就是这个情况),挪完鼠标仍落在区域内,效果打折 ——
// 把识别范围收小才是根治。
//
// 用它的地方:
//   - tasks/farm.ts:定点识别的怪名扫描 / 小退前清怪 / 物品拾取(这些流程刚点过字,鼠标就停在识别区域里)
//   - pet-training.ts:宠物列表 / 宠物等级 / 宠物技能名(双击换宠后鼠标正停在列表上)

import type { IInputProvider } from '../../../core/platform/input/IInputProvider';
import { sleep } from '../../../core/utils/sleep';

/** 停靠点离画面边的距离(px) */
const PARK_MARGIN_PX = 8;
/** 挪完之后等它生效(ms):给画面/捕获缓冲一点时间再识别 */
const PARK_SETTLE_MS = 150;

/**
 * 把鼠标挪到画面左上角,并等一小会儿。
 * @param input 该窗口的输入模拟(坐标用「窗口客户区相对坐标」,与大漠的识别区域同一坐标系)
 */
export async function parkMouseTopLeft(input: IInputProvider): Promise<void> {
  await input.moveMouse({ x: PARK_MARGIN_PX, y: PARK_MARGIN_PX }, { kind: 'instant' });
  await sleep(PARK_SETTLE_MS);
}
