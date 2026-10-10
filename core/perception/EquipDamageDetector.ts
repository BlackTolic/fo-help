// 装备耐久检测器:打开人物(状态)面板,装备槽区域找红 = 有装备耐久见底
//
// 流程:按人物面板快捷键(Alt+C,见 shared/game-hotkeys.ts)→ 等面板展开 → findColor 在 EQUIP_DAMAGE_ROI 找红 → 关面板 → 返回结果。
// ⚠️ 面板打开成功与否不强制校验:游戏卡顿/焦点丢失时面板可能没打开,
//    此时装备槽区域找不到红,自然返回 false(相当于一次误检为"无损坏",不会误报损坏)。
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { EQUIP_DAMAGE_ROI } from '../constant-ocr/equipment';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import { pressGameHotkey } from '../../shared/game-hotkeys';
import { parseFindColor } from '../utils/parse';
import { sleep } from '../utils/sleep';

export interface EquipDamageOptions {
  /** 按下面板键后到检测的等待毫秒数(默认 800,面板展开动画) */
  openDelayMs?: number;
}

/** 是否有装备耐久见底(装备槽区域找到红);检测过程会打开再关闭人物(状态)面板 */
export async function isEquipmentDamaged(client: DamooClient, size: WindowSizeKey, opts: EquipDamageOptions = {}): Promise<boolean> {
  // 打开人物(状态)面板:键位走语义化快捷键表(shared/game-hotkeys.ts),不在这里散写键码
  // await pressGameHotkey(client, 'openCharacterPanel');
  // await sleep(opts.openDelayMs ?? 800);

  const roi = EQUIP_DAMAGE_ROI[size];
  const hit = parseFindColor(client.findColorE(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim));

  // 关面板:Esc 兜底(面板没开成功时多按一次 Esc 一般也只是打开系统菜单,任务层可再按一次关掉)
  // client.keyPress(27);
  // await sleep(300);

  return hit !== null;
}
