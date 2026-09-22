// 大漠输入模拟 Provider
// 用 dm-api.ts 统一封装,实现 IInputProvider

import type { IInputProvider, KeyCode, MouseButton, MoveStyle } from '../IInputProvider';
import type { Point } from '../../vision/IVisionProvider';
import { dmApi, getDamoo } from '../../damoo/dm-api';
import { createLogger } from '../../../logger';

const log = createLogger('damoo.input');

const winax = require('winax');

// 大漠键码:虚拟键码 VK_* 的字符串形式
const KEY_MAP: Record<KeyCode, number> = {
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  Q: 81,
  W: 87,
  E: 69,
  R: 82,
  A: 65,
  S: 83,
  D: 68,
  F: 70,
  G: 71,
  H: 72,
  Z: 90,
  X: 88,
  C: 67,
  V: 86,
  B: 66,
  Tab: 9,
  Space: 32,
  Enter: 13,
  Esc: 27,
  '0': 48,
  '1': 49,
  '2': 50,
  '3': 51,
  '4': 52,
  '5': 53,
  '6': 54,
  '7': 55,
  '8': 56,
  '9': 57,
};

export class DamooInputProvider implements IInputProvider {
  private hwnd = 0;

  bind(hwnd: number): void {
    this.hwnd = hwnd;
  }

  /** 暴露给其他模块用(已弃用,推荐 dmApi 直接) */
  get dm(): any {
    return getDamoo();
  }

  async moveMouse(to: Point, style?: MoveStyle): Promise<void> {
    const s = style ?? { kind: 'human', durationMs: 200 };

    if (s.kind === 'instant') {
      dmApi.moveTo(to.x, to.y);
      return;
    }

    // 拟人化移动:从当前位置拖到目标
    const cur = await this.getMousePos();
    const duration = s.durationMs;
    const steps = Math.max(5, Math.floor(duration / 16)); // ~60fps

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 缓动函数:easeInOutQuad
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = cur.x + (to.x - cur.x) * eased;
      const y = cur.y + (to.y - cur.y) * eased;
      // 抖动
      const jx = s.kind === 'bezier' && s.jitter ? (Math.random() - 0.5) * 1.5 : 0;
      const jy = s.kind === 'bezier' && s.jitter ? (Math.random() - 0.5) * 1.5 : 0;
      dmApi.moveTo(x + jx, y + jy);
      await new Promise((r) => setTimeout(r, Math.floor(duration / steps)));
    }
  }

  async getMousePos(): Promise<Point> {
    // GetCursorPos 需要 byref 参数(winax.Variant)
    const x = new winax.Variant(0, 'byref');
    const y = new winax.Variant(0, 'byref');
    dmApi.getCursorPos(x, y);
    return { x: Number(x) || 0, y: Number(y) || 0 };
  }

  async click(button: MouseButton, count = 1): Promise<void> {
    const fn =
      button === 'left'
        ? dmApi.leftClick
        : button === 'right'
          ? dmApi.rightClick
          : dmApi.middleClick;
    for (let i = 0; i < count; i++) {
      fn();
      if (i < count - 1) await new Promise((r) => setTimeout(r, 60));
    }
  }

  async mouseDown(button: MouseButton): Promise<void> {
    const fn =
      button === 'left' ? dmApi.leftDown : button === 'right' ? dmApi.rightDown : dmApi.middleDown;
    fn();
  }

  async mouseUp(button: MouseButton): Promise<void> {
    const fn =
      button === 'left' ? dmApi.leftUp : button === 'right' ? dmApi.rightUp : dmApi.middleUp;
    fn();
  }

  async pressKey(key: KeyCode, holdMs?: number): Promise<void> {
    const code = KEY_MAP[key];
    if (code === undefined) throw new Error(`不支持的键: ${key}`);
    if (holdMs && holdMs > 0) {
      dmApi.keyDown(code);
      await new Promise((r) => setTimeout(r, holdMs));
      dmApi.keyUp(code);
    } else {
      dmApi.keyPress(code);
    }
  }

  async keyDown(key: KeyCode): Promise<void> {
    const code = KEY_MAP[key];
    if (code === undefined) throw new Error(`不支持的键: ${key}`);
    dmApi.keyDown(code);
  }

  async keyUp(key: KeyCode): Promise<void> {
    const code = KEY_MAP[key];
    if (code === undefined) throw new Error(`不支持的键: ${key}`);
    dmApi.keyUp(code);
  }

  async delay(ms: number): Promise<void> {
    dmApi.delay(ms);
  }

  destroy(): void {
    if (this.hwnd === 0) log.debug('input provider: hwnd 未绑定');
  }
}
