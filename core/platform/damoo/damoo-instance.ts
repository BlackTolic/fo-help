// DaMo COM 实例管理(每个 worker 一个)
// 通过 winax 加载 dm.dmsoft,单例 + BindWindow 模式

// eslint-disable-next-line @typescript-eslint/no-var-requires
const winax = require('winax');

export type DisplayMode = 'normal' | 'gdi' | 'gdi2' | 'dx' | 'dx2' | 'dx3';
export type MouseMode = 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
export type KeypadMode = 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
export type BindMode = number; // 0-101

export interface DamooConfig {
  display: DisplayMode;
  mouse: MouseMode;
  keypad: KeypadMode;
  mode: BindMode;
}

export const DEFAULT_DAMOO_CONFIG: DamooConfig = {
  display: 'gdi',     // 老游戏最稳
  mouse: 'windows',
  keypad: 'windows',
  mode: 0,
};

let _dm: any = null;
let _initialized = false;

export function getDamoo(): any {
  if (!_dm) {
    if (!_initialized) {
      console.log('[DaMo] 正在创建 COM 对象 dm.dmsoft...');
      _initialized = true;
    }
    try {
      _dm = new winax.Object('dm.dmsoft');
      console.log(`[DaMo] COM 加载成功,版本 ${_dm.Ver()}`);
    } catch (e: any) {
      _dm = null;
      throw new Error(`大漠 DLL 未注册或加载失败: ${e.message}\n` +
        `请确认 dm.dll 位于 assets/dll/ 目录,并以管理员身份运行 regsvr32 注册。`);
    }
  }
  return _dm;
}

export function bindWindow(hwnd: number, cfg: DamooConfig = DEFAULT_DAMOO_CONFIG): boolean {
  const dm = getDamoo();
  // BindWindowEx 实际签名是 6 个参数,最后一个是 timeout(毫秒)
  // 大部分文档和示例没提这个,导致直接传 5 个会报"无效的参数数目"
  let ret: any;
  try {
    ret = dm.BindWindowEx(hwnd, cfg.display, cfg.mouse, cfg.keypad, cfg.mode, 5000);
  } catch (e: any) {
    // 某些版本 BindWindowEx 是 5 参,捕获异常后退回 BindWindow
    console.warn(`[DaMo] BindWindowEx 6参失败,降级到 BindWindow 5参: ${e.message}`);
    ret = dm.BindWindow(hwnd, cfg.display, cfg.mouse, cfg.keypad, cfg.mode);
  }
  if (ret === 1) {
    console.log(`[DaMo] 绑定窗口成功 hwnd=${hwnd} display=${cfg.display} mouse=${cfg.mouse} mode=${cfg.mode}`);
  } else {
    console.error(`[DaMo] 绑定窗口失败 hwnd=${hwnd} 返回值=${ret},错误码=${dm.GetLastError()}`);
  }
  return ret === 1;
}

export function unbindWindow(): void {
  if (!_dm) return;
  try {
    _dm.UnBindWindow();
    console.log('[DaMo] 已解绑窗口');
  } catch (e: any) {
    console.warn('[DaMo] 解绑失败:', e.message);
  }
}

export function releaseDamoo(): void {
  if (_dm) {
    try {
      _dm.UnBindWindow();
    } catch {}
    _dm = null;
    _initialized = false;
    console.log('[DaMo] COM 实例已释放');
  }
}
