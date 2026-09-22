// 输入模拟接口(所有实现都必须满足)

import type { Point } from '../vision/IVisionProvider';

export type MouseButton = 'left' | 'right' | 'middle';

export type KeyCode =
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'Q'
  | 'W'
  | 'E'
  | 'R'
  | 'A'
  | 'S'
  | 'D'
  | 'F'
  | 'G'
  | 'H'
  | 'Z'
  | 'X'
  | 'C'
  | 'V'
  | 'B'
  | 'Tab'
  | 'Space'
  | 'Enter'
  | 'Esc'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9';

export type MoveStyle =
  | { kind: 'instant' } // 瞬移
  | { kind: 'human'; durationMs: number } // 拟人化(指定时长)
  | { kind: 'bezier'; durationMs: number; jitter: boolean }; // 贝塞尔曲线

export interface IInputProvider {
  /** 移动鼠标到屏幕坐标 */
  moveMouse(to: Point, style?: MoveStyle): Promise<void>;

  /** 获取当前鼠标位置 */
  getMousePos(): Promise<Point>;

  /** 鼠标点击 */
  click(button: MouseButton, count?: number): Promise<void>;

  /** 鼠标按下不抬(配合 mouseUp 实现按住拖拽/持续移动) */
  mouseDown(button: MouseButton): Promise<void>;

  /** 鼠标抬起 */
  mouseUp(button: MouseButton): Promise<void>;

  /** 按键(按下 + 抬起) */
  pressKey(key: KeyCode, holdMs?: number): Promise<void>;

  /** 按下不抬 */
  keyDown(key: KeyCode): Promise<void>;

  /** 抬起 */
  keyUp(key: KeyCode): Promise<void>;

  /** 绑定到具体窗口 hwnd(把窗口提到前台) */
  bind(hwnd: number): void;

  /** 延时 */
  delay(ms: number): Promise<void>;

  /** 释放资源 */
  destroy(): void;
}
