// 大漠插件 API 统一封装
// 用途:业务层不直接调 dm.*,全部走这里,方便以后换识图插件时改这一个文件
//
// 替换步骤:
//  1. 复制本文件为 dm-api-mock.ts (或别的实现,如 dm-api-screeps.ts 等)
//  2. 改所有 import { dmApi } from '.../dm-api' 为新文件
//  3. 实现同样的 dmApi 接口(版本/绑定/截图/找字/找图/找色/OCR/鼠标/键盘)
//  4. 删掉本文件(winax + dm.dmsoft 相关代码全在新文件里)
//
// 注意:替换时 com 单例管理(getRaw/releaseRaw)也要移植

// eslint-disable-next-line @typescript-eslint/no-var-requires
const winax = require('winax');
import { createLogger } from '../../logger';

const log = createLogger('dm-api');

// 大漠注册码(替换插件时换掉 / 删掉)
const DAMOO_REGISTER_CODE = 'mh84909b3bf80d45c618136887775ccc90d27d7';
const DAMOO_ATTACH_CODE = 'mt0plzvti09xyhw7';

// ===== 类型 =====
export type DisplayMode = 'normal' | 'gdi' | 'gdi2' | 'dx' | 'dx2' | 'dx3' | 'dx.graphic.2d';
export type MouseMode = 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2' | 'dx.mouse.position.lock.api|dx.mouse.position.lock.message';
export type KeypadMode = 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2' | 'dx.keypad.state.api|dx.keypad.api';
export type BindMode = number;
export interface DamooConfig {
  display: DisplayMode;
  mouse: MouseMode;
  keypad: KeypadMode;
  mode: BindMode;
  api?:string;
}
export const DEFAULT_DAMOO_CONFIG: DamooConfig = {
  // display: 'gdi',
  // mouse: 'windows',
  // keypad: 'windows',
  // mode: 0,
    display: 'dx.graphic.2d',
    mouse: 'dx.mouse.position.lock.api|dx.mouse.position.lock.message',
    keypad: 'dx.keypad.state.api|dx.keypad.api',
    api: '',
    mode: 0,
};

// ===== COM 单例(替换插件时移植) =====
let _dm: any = null;
let _initialized = false;

function getRaw(): any {
  if (!_dm) {
    if (!_initialized) {
      log.info('创建 COM 对象 dm.dmsoft...');
      _initialized = true;
    }
    try {
      _dm = new winax.Object('dm.dmsoft');
      log.info(`COM 加载成功,版本 ${_dm.Ver()}`);
      // 注册大漠(必须,否则 BindWindowEx 等高级 API 不能用)
      try {
        const regResult = _dm.Reg(DAMOO_REGISTER_CODE, DAMOO_ATTACH_CODE);
        if (regResult === 1) {
          log.info('大漠注册成功');
        } else {
          log.warn(`大漠注册返回非 1: ${regResult} (BindWindowEx 等高级 API 可能不可用)`);
        }
      } catch (e: any) {
        log.warn(`大漠注册异常: ${e.message}`);
      }
    } catch (e: any) {
      _dm = null;
      throw new Error(`大漠 DLL 未注册或加载失败: ${e.message}\n` +
        `请确认 dm.dll 位于 assets/dll/ 目录,并以管理员身份运行 regsvr32 注册。`);
    }
  }
  return _dm;
}

function releaseRaw(): void {
  if (_dm) {
    try { _dm.UnBindWindow(); } catch { /* noop */ }
    _dm = null;
    _initialized = false;
    log.info('COM 实例已释放');
  }
}

// ===== 业务 API(替换插件时,实现同样的接口) =====

/**
 * dmApi 是项目唯一对外的"大漠调用入口"
 * 所有 .ts 文件都不应该直接调 winax 或 dm.*,全部走这里
 */
export const dmApi = {
  // ---- 元信息 ----
  version: () => getRaw().Ver(),
  getLastError: () => getRaw().GetLastError?.() ?? 0,

  // ---- 注册(默认用硬编码注册码,也可外部传) ----
  reg: (registerCode = DAMOO_REGISTER_CODE, attachCode = DAMOO_ATTACH_CODE) =>
    getRaw().Reg(registerCode, attachCode),

  // ---- 窗口绑定 ----
  /** BindWindow 5 参:(hwnd, display, mouse, keypad, mode) */
  bindWindow: (hwnd: number, display: string, mouse: string, keypad: string, mode: number): number =>
    getRaw().BindWindow(hwnd, display, mouse, keypad, mode),
  /**
   * BindWindowEx 6 参:(hwnd, display, mouse, keypad, api, mode)
   * ⚠️ 注意:第 5 参是 api 字符串(不是 mode!),第 6 参才是 mode 数字
   *   ffo-auto-script 用 api='' + mode=0 验证 alt+q 能成功绑定
   */
  bindWindowEx: (
    hwnd: number,
    display: string,
    mouse: string,
    keypad: string,
    api: string,
    mode: number,
  ): number => getRaw().BindWindowEx(hwnd, display, mouse, keypad, api, mode),
  unbindWindow: (): number => getRaw().UnBindWindow(),

  // ---- 截图 ----
  /** 截图到本地文件 */
  capture: (x1: number, y1: number, x2: number, y2: number, filePath: string): number =>
    getRaw().Capture(x1, y1, x2, y2, filePath),
  /** 截取屏幕数据(返回 base64) */
  getScreenData: (x1: number, y1: number, x2: number, y2: number): string =>
    getRaw().GetScreenData(x1, y1, x2, y2),
  /** 截取全屏数据(返回 base64) */
  getFullScreenData: (filePath: string): string =>{  
    const width =  getRaw().GetScreenWidth();
    const height = getRaw().GetScreenHeight();
    console.log(`全屏截图,宽度 ${width},高度 ${height}`);
    return getRaw().capturePng(0, 0, width, height, filePath);
  },

  // ---- 字库 ----
  setDict: (index: number, filePath: string): number => getRaw().SetDict(index, filePath),
  useDict: (index: number): number => getRaw().UseDict(index),

  // ---- 找字 ----
  /** 找字,返回 "x|y" 字符串,失败空 */
  findStr: (
    x1: number, y1: number, x2: number, y2: number,
    str: string, color: string, sim: number, dir?: number,
  ): string => String(getRaw().FindStr(x1, y1, x2, y2, str, color, sim, dir) || ''),
  /** 找字带坐标 ref,找到返回 1,失败 0;xRef/yRef 会被填充坐标 */
  findStrE: (
    x1: number, y1: number, x2: number, y2: number,
    str: string, color: string, sim: number,
    xRef: any, yRef: any, dir?: number,
  ): number => Number(getRaw().FindStrE(x1, y1, x2, y2, str, color, sim, xRef, yRef, dir) || 0),

  // ---- 找图 ----
  /** 找图,返回 "x|y" 字符串(单结果),失败空 */
  findPic: (
    x1: number, y1: number, x2: number, y2: number,
    tplBase64: string, color: string, sim: number, dir: string,
  ): string => String(getRaw().FindPic(x1, y1, x2, y2, tplBase64, color, sim, dir) || ''),
  /** 找图多结果,返回 "x1|y1|x2|y2|..." 字符串 */
  findPicEx: (
    x1: number, y1: number, x2: number, y2: number,
    tplBase64: string, color: string, sim: number, dir: string,
  ): string => String(getRaw().FindPicEx(x1, y1, x2, y2, tplBase64, color, sim, dir) || ''),

  // ---- 找色 ----
  findColor: (
    x1: number, y1: number, x2: number, y2: number,
    color: string, sim: number, dir: string,
  ): string => String(getRaw().FindColor(x1, y1, x2, y2, color, sim, dir) || ''),

  // ---- OCR ----
  /** OCR 区域文字,返回字符串 */
  ocr: (x1: number, y1: number, x2: number, y2: number, color: string, sim: number): string =>
    String(getRaw().Ocr(x1, y1, x2, y2, color, sim) || ''),

  // ---- 鼠标 ----
  moveTo: (x: number, y: number): number => getRaw().MoveTo(x, y),
  /** GetCursorPos 需要 byref 参数(用 winax.Variant) */
  getCursorPos: (xRef: any, yRef: any): number => getRaw().GetCursorPos(xRef, yRef),
  leftClick: (): number => getRaw().LeftClick(),
  rightClick: (): number => getRaw().RightClick(),
  middleClick: (): number => getRaw().MiddleClick(),

  // ---- 键盘 ----
  keyDown: (vkCode: number): number => getRaw().KeyDown(vkCode),
  keyUp: (vkCode: number): number => getRaw().KeyUp(vkCode),
  keyPress: (vkCode: number): number => getRaw().KeyPress(vkCode),
};

// ===== 旧 API 兼容(让原 damoo-instance 的调用方不用大改) =====

/**
 * 绑窗口(BindWindowEx 优先,失败降级 BindWindow)
 * 替代原 damoo-instance.ts 的 bindWindow
 */
export function bindWindow(hwnd: number, cfg: DamooConfig = DEFAULT_DAMOO_CONFIG): boolean {
  // ⚠️ BindWindowEx 第 5 参是 api 字符串(不是 mode),第 6 参才是 mode 数字
  //   之前传错位置导致大漠报 -28 "模式不支持"
  try {
    const ret = dmApi.bindWindowEx(hwnd, cfg.display, cfg.mouse, cfg.keypad, '', cfg.mode);
    if (ret === 1) {
      log.info(`绑定窗口成功 hwnd=${hwnd} display=${cfg.display} mouse=${cfg.mouse} mode=${cfg.mode}`);
      return true;
    }
    log.error(`BindWindowEx 失败 hwnd=${hwnd} 返回值=${ret},错误码=${dmApi.getLastError()}`);
    return false;
  } catch (e: any) {
    log.warn(`BindWindowEx 6参异常,降级到 BindWindow 5参: ${e.message}`);
    try {
      const ret = dmApi.bindWindow(hwnd, cfg.display, cfg.mouse, cfg.keypad, cfg.mode);
      if (ret === 1) {
        log.info(`绑定窗口成功(BindWindow 5参) hwnd=${hwnd}`);
        return true;
      }
      log.error(`BindWindow 5参也失败 hwnd=${hwnd} 返回值=${ret},错误码=${dmApi.getLastError()}`);
      return false;
    } catch (e2: any) {
      log.error(`BindWindow 完全失败 hwnd=${hwnd}: ${e2.message}`);
      return false;
    }
  }
}

export function unbindWindow(): void {
  try {
    dmApi.unbindWindow();
    log.info('已解绑窗口');
  } catch (e: any) {
    log.warn(`解绑失败: ${e.message}`);
  }
}

export function releaseDamoo(): void {
  releaseRaw();
}

export { getRaw as getDamoo };
