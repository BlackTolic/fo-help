// NPC 对话原语:找 NPC → 开对话 → 点选项 → 关对话
//
// 移植自旧项目 ffo-auto-tool 的 Conversation 类,区域常量见 core/constant-ocr/dialog.ts。
// NPC 名字是绿色字,在全屏扫描区(NPC_SCAN_BOX)里 findStrE 命中即定位;
// 对话是否打开用关闭钮 '@X' 反查(DIALOG_CLOSE_BTN 区域找得到 = 对话已开)。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { DIALOG_CLOSE_BTN, DIALOG_OPTIONS_ROI, NPC_SCAN_BOX } from '../constant-ocr/dialog';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { parseFindColor, parseTextPos } from '../utils/parse';
import { sleep } from '../utils/sleep';

export interface NpcFindOptions {
  /**
   * 命中名字后返回坐标的偏移(默认 {x:0,y:50})。
   * 旧项目点名字下方 50px(对话选项一般出现在名字下方),点不准时改这里。
   */
  offset?: Point;
}

export class NpcDialog {
  constructor(
    private readonly client: DamooClient,
    private readonly size: WindowSizeKey,
  ) {}

  /** 在全屏扫描区找 NPC 名字,返回 名字坐标+偏移 后的点击位置;找不到返回 undefined */
  async findNpc(name: string, opts?: NpcFindOptions): Promise<Point | undefined> {
    // 找到NPC之前,先等待 1000ms,确保名字显示出来
    await sleep(1000);
    const box = NPC_SCAN_BOX[this.size];
    const found = parseTextPos(this.client.findStrE(box.x1, box.y1, box.x2, box.y2, name, box.color, box.sim));
    if (!found) return undefined;
    const offset = opts?.offset ?? { x: 30, y: 50 };
    return { x: found.x + offset.x, y: found.y + offset.y };
  }

  /** 移动并点击指定位置,等对话展开后用 '@X' 反查对话是否打开(找到 = true) */
  async openDialog(pos: Point): Promise<boolean> {
    this.client.moveTo(pos.x, pos.y);
    await sleep(200);
    this.client.leftClick();
    await sleep(1000); // 旧项目实测:对话展开约 1s
    return this.findCloseButton() !== undefined;
  }

  /** 在对话选项区找指定选项文字,返回文字坐标;找不到返回 undefined */
  findOption(text: string): Point | undefined {
    const roi = DIALOG_OPTIONS_ROI[this.size];
    const found = this.client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, text, roi.color, roi.sim);
    return parseTextPos(found) ?? undefined;
  }

  /** 找选项并点击(offsetX 默认 0、offsetY 默认 5,点文字下方一点);未找到返回 false */
  async clickOption(text: string, offsetX = 0, offsetY = 5): Promise<boolean> {
    const pos = this.findOption(text);
    if (!pos) return false;
    this.client.moveTo(pos.x + offsetX, pos.y + offsetY);
    await sleep(200);
    this.client.leftClick();
    await sleep(600);
    return true;
  }

  /**
   * 关对话:找 '@X' 点击
   * 返回是否确认处理(点到 '@X' = true;只发了 Esc 没法确认 = false)。
   */
  async closeDialog(): Promise<boolean> {
    const btn = this.findCloseButton();
    if (btn) {
      this.client.moveTo(btn.x, btn.y);
      await sleep(200);
      this.client.leftClick();
      await sleep(600);
      return true;
    }
    // this.client.keyPress(27); // Esc 兜底
    // await sleep(500);
    return false;
  }

  /** 在关闭钮区域找 '@X';找到返回其坐标(也用作"对话已打开"的标志) */
  private findCloseButton(): Point | undefined {
    const roi = DIALOG_CLOSE_BTN[this.size];
    const found = this.client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, '@X', roi.color, roi.sim);
    return parseTextPos(found) ?? undefined;
  }
}
