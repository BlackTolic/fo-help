// 按键组合字符串 → vkCode 数组(Windows VK_* 虚拟键码)
// 前后端共享:UI 编排时校验/预览,worker 执行时喂给 dmApi.keyDown/keyUp/keyPress
//
// 支持的格式(用户约定的范围):
//   F1 ~ F12              单键
//   Alt+F1 ~ Alt+F12      Alt 修饰 + F 键
//   Shift+F1 ~ Shift+F10  Shift 修饰 + F 键(只到 F10)
//
// 注:大漠 keyDown/keyUp/keyPress 都是基于 vkCode 的,组合键通过
//   keyDown(modifier) → keyPress(mainKey) → keyUp(modifier) 模拟

/** VK_* 修饰键常量 */
export const VK_SHIFT = 16;
export const VK_CTRL = 17;
export const VK_ALT = 18;

/** F1-F12 vkCode 映射(112-123) */
export const VK_F: Record<string, number> = {
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
};

/** 解析后的按键组合,主键 + 修饰键数组(顺序按下,反序抬起) */
export interface ParsedKeyCombo {
  /** 主键 vkCode */
  mainVk: number;
  /** 主键名(F1/F2/...) */
  mainName: string;
  /** 修饰键 vkCode 数组(按下顺序),反序抬起 */
  modifiers: number[];
  /** 修饰键名(["Alt", "Shift"] 等) */
  modifierNames: string[];
}

/**
 * 解析按键字符串为 vkCode 组合
 * @returns null 表示格式不支持
 */
export function parseKeyCombo(input: string): ParsedKeyCombo | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const modifiers: number[] = [];
  const modifierNames: string[] = [];
  let main = trimmed;

  // 最多识别一个前缀修饰(Alt/Shift),Ctrl 用户没要,先不支持
  if (main.startsWith('Alt+')) {
    modifiers.push(VK_ALT);
    modifierNames.push('Alt');
    main = main.slice(4);
  } else if (main.startsWith('Shift+')) {
    modifiers.push(VK_SHIFT);
    modifierNames.push('Shift');
    main = main.slice(6);
  } else if (main.startsWith('Ctrl+')) {
    modifiers.push(VK_CTRL);
    modifierNames.push('Ctrl');
    main = main.slice(5);
  }

  // main 必须是 F1-F12
  const mainVk = VK_F[main];
  if (mainVk === undefined) return null;

  return {
    mainVk,
    mainName: main,
    modifiers,
    modifierNames,
  };
}

/**
 * 所有合法的按键字符串(给 UI 下拉/校验用)
 * - 单键 F1-F12
 * - Alt+F1-F12
 * - Shift+F1-F10(用户约定只到 F10)
 */
export const ALL_KEY_COMBOS: string[] = [
  ...Object.keys(VK_F).map((k) => k),
  ...Object.keys(VK_F).map((k) => `Alt+${k}`),
  // Shift+F1-F10(只到 F10,根据用户约定)
  ...Object.keys(VK_F)
    .filter((k) => {
      const n = parseInt(k.slice(1), 10);
      return n >= 1 && n <= 10;
    })
    .map((k) => `Shift+${k}`),
];

/** 简单校验,UI 输入框 onChange 用 */
export function isValidKeyCombo(input: string): boolean {
  return parseKeyCombo(input) !== null;
}