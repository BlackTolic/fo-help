// 与一个 NPC 对话并跑完它引用的对话配方(过图路线途经点 / 城镇补给共用同一套原语)
//
// 复用 core/perception/NpcDialog(找名字 → 开对话 → 关对话)与 dialog-recipe.runDialogRecipe,
// 只负责"对话"这一段;走路到 NPC 附近由调用方负责(补给用城镇路线,过图路线用途经点坐标)。

import { NpcDialog } from '../../../../core/perception/NpcDialog';
import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import { sleep } from '../../../../core/utils/sleep';
import type { WorkerContext } from '../context';
import { runDialogRecipe } from './dialog-recipe';

/** 找 NPC 的重试参数(找字失败多半是还没走近/名字被 UI 挡住) */
const NPC_TALK = {
  findAttempts: 3,
  findRetryMs: 800,
};

export interface TalkNpcOptions {
  ctx: WorkerContext;
  client: DamooClient;
  size: WindowSizeKey;
  /** 日志前缀(与 farm 的 label 一致) */
  label: string;
  /** NPC 绿字名(游戏内找字用) */
  npcName: string;
  /** 引用的对话配方名(= dialog-recipe 的任务名) */
  recipeName: string;
}

/**
 * 在当前位置找 NPC → 开对话 → 执行配方 → 兜底关窗。
 * 找不到 NPC / 打不开对话 / 配方不存在都返回 ok=false(带原因),配方失败也关窗后再返回。
 */
export async function talkToNpc(opts: TalkNpcOptions): Promise<{ ok: boolean; detail?: string }> {
  const { ctx, client, size, label, npcName, recipeName } = opts;

  const recipes = ctx.init.auxConfigs?.recipes ?? [];
  const recipe = recipes.find((r) => r.name === recipeName);
  if (!recipe) {
    const available = recipes.map((r) => r.name);
    return {
      ok: false,
      detail:
        `NPC「${npcName}」引用的对话配方「${recipeName}」不存在(可能已被删除或改名)。` +
        (available.length > 0 ? `当前可用配方:${available.join('、')}` : '当前没有任何对话配方'),
    };
  }

  const dialog = new NpcDialog(client, size);
  // 找字精确定位:调用方只负责"走近",最终点击以找字为准,找不到重试几次
  let pos = await dialog.findNpc(npcName);
  for (let i = 1; !pos && i < NPC_TALK.findAttempts; i++) {
    ctx.sendLog('warn', `[${label}] 没找到 NPC「${npcName}」,重试 ${i + 1}/${NPC_TALK.findAttempts}`);
    await sleep(NPC_TALK.findRetryMs);
    pos = await dialog.findNpc(npcName);
  }
  if (!pos) {
    return { ok: false, detail: `找不到 NPC「${npcName}」(核对 NPC 名字与绿色字扫描区 NPC_SCAN_BOX)` };
  }
  ctx.sendLog('info', `[${label}] 找到 NPC「${npcName}」@(${pos.x},${pos.y}),打开对话`);

  if (!(await dialog.openDialog(pos))) {
    return {
      ok: false,
      detail: `打开「${npcName}」的对话失败(没读到 '@X' 关闭钮:对话框没弹出,或 DIALOG_CLOSE_BTN 的区域/颜色没配对)`,
    };
  }

  const result = await runDialogRecipe({ ctx, client, dialog, label }, recipe);
  // 兜底关窗:配方跑完或中途失败都别把对话框留在屏幕上(否则后续移动点击都会先点到对话)
  await dialog.closeDialog();
  return result.ok ? { ok: true } : { ok: false, detail: result.detail };
}
