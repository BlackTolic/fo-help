// QQ幻想 常用快捷键的语义化定义 —— 全项目唯一维护点
//
// 业务代码需要「打开宠物面板」「屏蔽所有玩家」这类操作时,只引用这里的语义 id,
// 不要在各处散写 'Alt+P'、虚拟键码或连按次数。改键位/连按次数只改这一个文件,
// 全项目跟着变。
//
// 键位依据 QQ幻想 官方快捷键表:
//   Alt+P 宠物面板 / Alt+C 状态(人物)面板 / Alt+I 物品面板 / Alt+V 聊天区
//   F11   屏幕人名显示模式循环(连按 4 下 = 屏蔽所有玩家)
//   Alt+- 地图缩小 / Alt++ 地图放大
//
// 参考:QQ幻想官网-操作说明 https://fo.qq.com/web200604/information/operation.htm

import { VK_ALT, VK_CTRL, VK_F, VK_SHIFT, VK_OEM_MINUS, VK_OEM_PLUS } from './key-combo';

/** 语义化快捷键 id:业务代码只认这些名字 */
export type GameHotkeyId =
  | 'openPetPanel'
  | 'openCharacterPanel'
  | 'openItemPanel'
  | 'openChatPanel'
  | 'blockAllPlayers'
  | 'zoomOutMap'
  | 'zoomInMap';

/** 按键结构:修饰键 vkCode(按下顺序,反序抬起)+ 主键 vkCode */
export interface HotkeyCombo {
  modifiers: number[];
  mainVk: number;
}

export interface GameHotkey {
  id: GameHotkeyId;
  /** 中文说明,日志/UI 展示用 */
  label: string;
  combo: HotkeyCombo;
  /** 连按次数(默认 1);>1 时相邻两次之间隔 HOTKEY_PRESS_GAP_MS */
  repeat: number;
  /** 备注:键位来源或特殊约定 */
  note?: string;
}

/** 连按时相邻两次按下的间隔(ms) */
export const HOTKEY_PRESS_GAP_MS = 60;

/** 字母虚拟键码:Windows VK_A~VK_Z = 65~90,与大写 ASCII 相同 */
function letterVk(ch: string): number {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) throw new Error(`game-hotkeys: 不是字母键: ${ch}`);
  return code;
}

/** Alt + 字母 */
function altLetter(ch: string): HotkeyCombo {
  return { modifiers: [VK_ALT], mainVk: letterVk(ch) };
}

/**
 * 常用快捷键表:业务代码引用的唯一来源。
 * 新增一个快捷键 = 在 GameHotkeyId 加 id + 在这里补一条。
 */
export const GAME_HOTKEYS: Record<GameHotkeyId, GameHotkey> = {
  openPetPanel: {
    id: 'openPetPanel',
    label: '打开/关闭宠物面板',
    combo: altLetter('P'),
    repeat: 1,
  },
  openCharacterPanel: {
    id: 'openCharacterPanel',
    label: '打开/关闭人物(状态)面板',
    combo: altLetter('C'),
    repeat: 1,
  },
  openItemPanel: {
    id: 'openItemPanel',
    label: '打开/关闭物品面板',
    combo: altLetter('I'),
    repeat: 1,
    note: '官方键位为 Alt+I',
  },
  openChatPanel: {
    id: 'openChatPanel',
    label: '打开/关闭聊天面板',
    combo: altLetter('V'),
    repeat: 1,
  },
  blockAllPlayers: {
    id: 'blockAllPlayers',
    label: '屏蔽所有玩家',
    combo: { modifiers: [], mainVk: VK_F.F11 },
    repeat: 4,
    note: 'F11 循环切换人名显示,连按 4 下到"屏蔽所有人"',
  },
  zoomOutMap: {
    id: 'zoomOutMap',
    label: '地图缩小',
    combo: { modifiers: [VK_ALT], mainVk: VK_OEM_MINUS },
    repeat: 1,
    note: 'Alt+- 缩小右上角小地图',
  },
  zoomInMap: {
    id: 'zoomInMap',
    label: '地图放大',
    combo: { modifiers: [VK_ALT], mainVk: VK_OEM_PLUS },
    repeat: 1,
    note: 'Alt++ 放大右上角小地图',
  },
};

/** 修饰键 vkCode → 名字 */
const MODIFIER_NAMES: Record<number, string> = {
  [VK_ALT]: 'Alt',
  [VK_CTRL]: 'Ctrl',
  [VK_SHIFT]: 'Shift',
};

/** 主键 vkCode → 名字(F 键 / 字母 / 数字;认不出退回 VK 号) */
function mainKeyName(vk: number): string {
  for (const [name, code] of Object.entries(VK_F)) {
    if (code === vk) return name;
  }
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk === VK_OEM_MINUS) return '-';
  if (vk === VK_OEM_PLUS) return '+';
  return `VK${vk}`;
}

/** 快捷键的可读文本(日志/UI 用),如 "Alt+P"、"F11×4" */
export function hotkeyText(hotkey: GameHotkey): string {
  const names = hotkey.combo.modifiers.map((m) => MODIFIER_NAMES[m] ?? `VK${m}`);
  names.push(mainKeyName(hotkey.combo.mainVk));
  const combo = names.join('+');
  return hotkey.repeat > 1 ? `${combo}×${hotkey.repeat}` : combo;
}

/** 执行快捷键所需的最小子集:dmApi(即 DamooClient)天然满足 */
export interface HotkeySender {
  keyDown(vkCode: number): number;
  keyUp(vkCode: number): number;
  keyPress(vkCode: number): number;
}

/** 按一次快捷键:修饰键按下 → 主键 → 修饰键反序抬起 */
export function pressHotkeyOnce(sender: HotkeySender, hotkey: GameHotkey): void {
  for (const m of hotkey.combo.modifiers) sender.keyDown(m);
  sender.keyPress(hotkey.combo.mainVk);
  for (const m of [...hotkey.combo.modifiers].reverse()) sender.keyUp(m);
}

/**
 * 按语义 id 执行快捷键(自动处理 repeat)。
 * @param gapMs 连按间隔,默认 HOTKEY_PRESS_GAP_MS
 */
export async function pressGameHotkey(sender: HotkeySender, id: GameHotkeyId, opts: { gapMs?: number } = {}): Promise<void> {
  const hotkey = GAME_HOTKEYS[id];
  const gapMs = opts.gapMs ?? HOTKEY_PRESS_GAP_MS;
  for (let i = 0; i < hotkey.repeat; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    pressHotkeyOnce(sender, hotkey);
  }
}
