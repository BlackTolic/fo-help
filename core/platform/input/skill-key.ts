// 技能栏键位:第一页 F1-F10 / 第二页 TF1-TF10(按一次 Tab 切页)
//
// 游戏技能栏有两页:正常 F1-F10 是第一页;按一次 Tab 切到第二页(同一排 F 键变成第二页技能),
// 再按一次 Tab 切回第一页 —— Tab 是「按一次切一页」的开关,不是按住。
// UI 把第二页键位记作 TF1-TF10(T = Tab)。
//
// 释放策略(不记页码):第一页技能直接按 F 键;第二页技能「按一次 Tab 切到第二页 →
// 按 F 键 → 再按一次 Tab 切回第一页」。这样两次技能之间技能栏恒停在第一页,
// 下一次不论放哪一页都从已知状态出发,无需记住当前在第几页。

import type { IInputProvider, KeyCode } from './IInputProvider';

/** 技能键位(与 shared/types.ts 的 FarmSkillConfig.key 对应) */
export type SkillKey =
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'TF1'
  | 'TF2'
  | 'TF3'
  | 'TF4'
  | 'TF5'
  | 'TF6'
  | 'TF7'
  | 'TF8'
  | 'TF9'
  | 'TF10';

/** 全部合法技能键位(F1-F10 第一页 / TF1-TF10 第二页;worker 侧校验用) */
export const SKILL_KEYS: SkillKey[] = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'TF1',
  'TF2',
  'TF3',
  'TF4',
  'TF5',
  'TF6',
  'TF7',
  'TF8',
  'TF9',
  'TF10',
];

/** 切页键 Tab 的按下时长(ms):大漠 KeyPress 按下即抬起,太短可能被游戏漏掉,给一点保持时间 */
const PAGE_SWITCH_HOLD_MS = 50;

/** 旧配置把第二页写成 SF*(S = Shift 的旧叫法):读入时归一成 TF*,兼容老配置 */
export function normalizeSkillKey(key: string): string {
  return key.replace(/^SF(\d+)$/, 'TF$1');
}

/** 是否第二页技能键(TF* 前缀) */
function isSecondPageKey(key: string): boolean {
  return key.length > 2 && key.startsWith('TF');
}

/** 第二页键位(TF1)→ 第一页 F 键(F1);第一页键位原样返回 */
function baseKeyOf(key: SkillKey): KeyCode {
  return (isSecondPageKey(key) ? key.slice(1) : key) as KeyCode;
}

/** 按一次技能键:第一页直接按 F 键;第二页「切到第二页 → 按 F 键 → 切回第一页」 */
export async function pressSkillKey(input: IInputProvider, key: SkillKey): Promise<void> {
  if (!isSecondPageKey(key)) {
    await input.pressKey(baseKeyOf(key));
    return;
  }
  await input.pressKey('Tab', PAGE_SWITCH_HOLD_MS);

  try {
    // 停顿100ms,确保切页完成
    await input.delay(100);
    await input.pressKey(baseKeyOf(key));
    // 停顿100ms,确保切页完成
    await input.delay(100);
  } finally {
    // 无论如何都切回第一页,保证下一次技能从第一页出发
    await input.pressKey('Tab', PAGE_SWITCH_HOLD_MS);
  }
}
