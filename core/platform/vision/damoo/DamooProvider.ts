// 大漠视觉识别 Provider
// 用 winax 调 dm.dmsoft,实现 IVisionProvider

import type {
  IVisionProvider,
  Point,
  Rect,
  FindOpts,
  OcrOpts,
  OcrResult,
} from '../IVisionProvider';
import { getDamoo } from '../../damoo/damoo-instance';

export class DamooVisionProvider implements IVisionProvider {
  private hwnd: number = 0;

  bind(hwnd: number): void {
    this.hwnd = hwnd;
  }

  /** 暴露给 TargetFinder 等模块用,内部访问 dm 不用每次 getDamoo() */
  get dm(): any {
    return getDamoo();
  }

  async captureScreen(roi?: Rect): Promise<Buffer> {
    const dm = this.dm;
    const x1 = roi?.x ?? 0;
    const y1 = roi?.y ?? 0;
    const x2 = (roi?.x ?? 0) + (roi?.w ?? 0);
    const y2 = (roi?.y ?? 0) + (roi?.h ?? 0);
    // 大漠: Capture(x1, y1, x2, y2, file) -> 0/1
    // 这里返回 base64
    const data = dm.GetScreenData(x1, y1, x2, y2);
    if (!data) throw new Error('Capture 失败');
    return Buffer.from(data, 'base64');
  }

  async findImage(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point | null> {
    const dm = this.dm;
    const sim = opts?.similarity ?? 0.8;
    const dir = opts?.direction ?? 'leftTop';
    const tplB64 = template.toString('base64');
    const ret = dm.FindPic(
      roi.x, roi.y, roi.x + roi.w, roi.y + roi.h,
      tplB64, '000000', sim, dir,
    );
    if (!ret) return null;
    // ret 格式: "x|y"
    const parts = String(ret).split('|');
    if (parts.length !== 2) return null;
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }

  async findImages(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point[]> {
    const dm = this.dm;
    const sim = opts?.similarity ?? 0.8;
    const dir = opts?.direction ?? 'leftTop';
    const tplB64 = template.toString('base64');
    const ret = dm.FindPicEx(
      roi.x, roi.y, roi.x + roi.w, roi.y + roi.h,
      tplB64, '000000', sim, dir,
    );
    if (!ret) return [];
    // FindPicEx 格式: "x1|y1|idx1,x2|y2|idx2,..."
    return String(ret).split(',')
      .filter(Boolean)
      .map((p) => {
        const parts = p.split('|');
        if (parts.length < 2) return null;
        return { x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) };
      })
      .filter((p): p is Point => p !== null && !isNaN(p.x) && !isNaN(p.y));
  }

  async findColor(roi: Rect, color: string, opts?: FindOpts): Promise<Point | null> {
    const dm = this.dm;
    const sim = opts?.similarity ?? 0.9;
    const dir = opts?.direction ?? 'leftTop';
    const ret = dm.FindColor(
      roi.x, roi.y, roi.x + roi.w, roi.y + roi.h,
      color, sim, dir,
    );
    if (!ret) return null;
    const parts = String(ret).split('|');
    if (parts.length !== 2) return null;
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }

  async ocr(roi: Rect, opts?: OcrOpts): Promise<OcrResult> {
    const dm = this.dm;
    const color = opts?.color ?? 'FFFFFF';
    const sim = opts?.similarity ?? 0.8;
    const text = dm.Ocr(roi.x, roi.y, roi.x + roi.w, roi.y + roi.h, color, sim);
    return { text: String(text || ''), confidence: 1.0 };
  }

  destroy(): void {
    // 不在这里释放 DaMo 单例(其他 provider 可能还在用)
    if (this.hwnd === 0) console.log('  (vision provider: hwnd 未绑定)');
  }
}
