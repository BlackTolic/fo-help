// 大漠视觉识别 Provider
// 用 dm-api.ts 统一封装,实现 IVisionProvider

import type {
  IVisionProvider,
  Point,
  Rect,
  FindOpts,
  OcrOpts,
  OcrResult,
} from '../IVisionProvider';
import { dmApi, getDamoo } from '../../damoo/dm-api';
import { createLogger } from '../../../logger';

const log = createLogger('damoo.vision');

export class DamooVisionProvider implements IVisionProvider {
  private hwnd = 0;

  bind(hwnd: number): void {
    this.hwnd = hwnd;
  }

  /** 暴露给 TargetFinder 等模块用(已弃用,推荐用 dmApi 直接) */
  get dm(): any {
    return getDamoo();
  }

  async captureScreen(roi?: Rect): Promise<Buffer> {
    const x1 = roi?.x ?? 0;
    const y1 = roi?.y ?? 0;
    const x2 = (roi?.x ?? 0) + (roi?.w ?? 0);
    const y2 = (roi?.y ?? 0) + (roi?.h ?? 0);
    // 大漠: GetScreenData(x1, y1, x2, y2) -> base64 字符串
    const data = dmApi.getScreenData(x1, y1, x2, y2);
    if (!data) throw new Error('Capture 失败');
    return Buffer.from(data, 'base64');
  }

  async findImage(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point | null> {
    const sim = opts?.similarity ?? 0.8;
    const dir = opts?.direction ?? 'leftTop';
    const tplB64 = template.toString('base64');
    const ret = dmApi.findPic(roi.x, roi.y, roi.w, roi.h, tplB64, '000000', sim, dir);
    if (!ret) return null;
    const parts = ret.split('|');
    if (parts.length !== 2) return null;
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }

  async findImages(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point[]> {
    const sim = opts?.similarity ?? 0.8;
    const dir = opts?.direction ?? 'leftTop';
    const tplB64 = template.toString('base64');
    const ret = dmApi.findPicEx(roi.x, roi.y, roi.w, roi.h, tplB64, '000000', sim, dir);
    if (!ret) return [];
    return ret
      .split(',')
      .filter(Boolean)
      .map((p) => {
        const parts = p.split('|');
        if (parts.length < 2) return null;
        return { x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) };
      })
      .filter((p): p is Point => p !== null && !isNaN(p.x) && !isNaN(p.y));
  }

  async findColor(roi: Rect, color: string, opts?: FindOpts): Promise<Point | null> {
    const sim = opts?.similarity ?? 0.9;
    const dir = opts?.direction ?? 'leftTop';
    const ret = dmApi.findColor(roi.x, roi.y, roi.w, roi.h, color, sim, dir);
    if (!ret) return null;
    const parts = ret.split('|');
    if (parts.length !== 2) return null;
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }

  async ocr(roi: Rect, opts?: OcrOpts): Promise<OcrResult> {
    const color = opts?.color ?? 'FFFFFF';
    const sim = opts?.similarity ?? 0.8;
    const text = dmApi.ocr(roi.x, roi.y, roi.x + roi.w, roi.y + roi.h, color, sim);
    return { text, confidence: 1.0 };
  }

  destroy(): void {
    if (this.hwnd === 0) log.debug('vision provider: hwnd 未绑定');
  }
}
