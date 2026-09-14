// 缩略图缓存(只是 store,实际截图由 worker 用大漠完成)
// 主进程不主动截图,所有截图都走 worker 的 dm.Capture

export class ThumbnailService {
  private cache = new Map<number, string>();  // hwnd -> base64

  /** worker 推过来的截图(直接缓存 + 准备广播) */
  set(hwnd: number, dataUrl: string | null): void {
    if (dataUrl) this.cache.set(hwnd, dataUrl);
    else this.cache.delete(hwnd);
  }

  getCached(hwnd: number): string | undefined {
    return this.cache.get(hwnd);
  }

  clear(hwnd: number): void {
    this.cache.delete(hwnd);
  }

  clearAll(): void {
    this.cache.clear();
  }
}
