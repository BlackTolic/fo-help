// 回城检查项「创建队伍」:回城后按 Alt+Q 看交友面板,未组队就建队,最后把面板关掉
//
// 需求(用户原话):勾了「创建队伍」后,每次回城都要检查是不是组队状态,不是就创建队伍:
//   按 Alt+Q(shared/game-hotkeys.ts 的 openFriendPanel)打开交友面板 → 等面板展开 →
//   在 TEAM_PANEL_ROI 里检测(core/perception/TeamPanelDetector.ts):
//     「组队」= 未组队 → 点这两个字(用找字坐标;拿不到就点区域中心)→ 点 TEAM_CREATE_POS 完成组队 → 关面板;
//     「解散」= 已在队伍 → 不用建队,直接关面板;
//     两个都没命中 → 记一条 warn(带区域 / 期望文案 / OCR 原文),仍然按 Alt+Q 把面板关掉
//       (别把面板留在屏幕上挡住后续的走路点击)。
//
// 不阻断补给流程:整段 try/catch,失败只记日志;每一步之间检查 isStopped()
// (stop 命令把 ctx.moveAttack.running 置 false),停止就尽快退出。
// 区域/颜色/相似度/等待时间常量见 core/constant-ocr/team.ts
// (1600*900 的区域与建队坐标是按 1280*800 推算的,⚠️ 未实测)。

import type { WindowSizeKey } from '../../../../core/constant-ocr/popup';
import { TEAM_CREATE_POS, TEAM_DISBAND_TEXT, TEAM_JOIN_TEXT, TEAM_PANEL_ROI, TEAM_PANEL_TIMING } from '../../../../core/constant-ocr/team';
import { detectTeamPanelState } from '../../../../core/perception/TeamPanelDetector';
import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import { sleep } from '../../../../core/utils/sleep';
import { pressGameHotkey } from '../../../../shared/game-hotkeys';
import type { WorkerContext } from '../context';

/** 检查/创建队伍的运行依赖(farm 侧注入,与补给流程共用同一份 client/size) */
export interface TeamCheckOptions {
  ctx: WorkerContext;
  client: DamooClient;
  size: WindowSizeKey;
  /** 日志前缀(与 farm 的 label 一致) */
  label: string;
  /** 外部停止标志(与补给流程共用:ctx.moveAttack.running 取反) */
  isStopped: () => boolean;
}

/** 按 Alt+Q 关掉交友面板(与打开是同一个开关);关不掉只记日志,不抛 */
async function closeTeamPanel(opts: TeamCheckOptions): Promise<void> {
  const { ctx, client, label } = opts;
  try {
    await pressGameHotkey(client, 'openFriendPanel');
    await sleep(TEAM_PANEL_TIMING.closeMs);
    ctx.sendLog('info', `[${label}] 已按 Alt+Q 关闭交友面板`);
  } catch (e: any) {
    // 关不掉也没别的办法:面板会挡住后续点击,让日志留痕便于排查
    ctx.sendLog('warn', `[${label}] 关闭交友面板失败(面板可能还留在屏幕上):${e?.message ?? e}`);
  }
}

/**
 * 检查队伍状态,未组队则创建。
 * 只在城镇档案勾了「创建队伍」时由补给流程调用;返回 void —— 成功/失败都在日志里说明,
 * 任何失败都不阻断补给(用户明确要求:队伍只是附带检查项)。
 */
export async function ensureTeamCreated(opts: TeamCheckOptions): Promise<void> {
  const { ctx, client, size, label, isStopped } = opts;
  const roi = TEAM_PANEL_ROI[size];
  /** 面板是否已经被我们打开了(异常路径据此决定要不要按 Alt+Q 关 —— 没开过就不能按,那会把它打开) */
  let opened = false;

  try {
    // 卡片状态:让界面能看出这一步在做什么
    ctx.setStatus('resupply', `${label}:检查队伍`);

    // 没有该分辨率的区域常量:检测不可能生效,提示一次就退出(不阻断补给)
    if (!roi) {
      ctx.sendLog('warn', `[${label}] 当前分辨率 ${size} 没有交友面板检测区域常量(见 core/constant-ocr/team.ts),跳过创建队伍检查`);
      return;
    }

    // 1) 打开交友面板:Alt+Q(键位走语义化快捷键表,不在这里散写键码)
    await pressGameHotkey(client, 'openFriendPanel');
    opened = true;
    await sleep(TEAM_PANEL_TIMING.openMs);
    if (isStopped()) return;

    // 2) 检测面板状态
    const detect = detectTeamPanelState(client, size);

    if (detect.state === 'join') {
      // 未组队:点「组队」那两个字(找字坐标;拿不到就退化成点区域中心)
      const target = detect.pos ?? { x: Math.round((roi.x1 + roi.x2) / 2), y: Math.round((roi.y1 + roi.y2) / 2) };
      ctx.sendLog('info', `[${label}] 交友面板显示「${TEAM_JOIN_TEXT}」= 未组队,点它建队 @(${target.x},${target.y})`);
      client.moveTo(target.x, target.y);
      await sleep(TEAM_PANEL_TIMING.clickMs);
      client.leftClick();
      await sleep(TEAM_PANEL_TIMING.clickMs);
      if (isStopped()) return;

      // 3) 再点建队确认坐标,完成组队
      const createPos = TEAM_CREATE_POS[size];
      if (!createPos) {
        ctx.sendLog(
          'warn',
          `[${label}] 当前分辨率 ${size} 没有建队确认坐标(见 core/constant-ocr/team.ts 的 TEAM_CREATE_POS),` +
            `本次只点了「${TEAM_JOIN_TEXT}」,没能完成建队`,
        );
      } else {
        ctx.sendLog('info', `[${label}] 点建队确认 @(${createPos.x},${createPos.y})`);
        client.moveTo(createPos.x, createPos.y);
        await sleep(TEAM_PANEL_TIMING.clickMs);
        client.leftClick();
        await sleep(TEAM_PANEL_TIMING.clickMs);
        ctx.sendLog('info', `[${label}] 创建队伍:完成`);
      }
    } else if (detect.state === 'disband') {
      ctx.sendLog('info', `[${label}] 交友面板显示「${TEAM_DISBAND_TEXT}」= 已在队伍,无需创建队伍`);
    } else {
      // 两个文案都没看清:大概率是区域/颜色/字库不对,让日志留痕(下一次回城还会再试)
      ctx.sendLog(
        'warn',
        `[${label}] 交友面板区域 (${roi.x1},${roi.y1})-(${roi.x2},${roi.y2}) 既没找到「${TEAM_JOIN_TEXT}」也没找到` +
          `「${TEAM_DISBAND_TEXT}」(颜色 ${roi.color},sim ${roi.findSim}),OCR 原文:「${detect.text ?? ''}」,跳过创建队伍检查`,
      );
    }

    // 4) 关面板:三种结果都要关 —— 面板留着会挡住后面的走路点击
    await closeTeamPanel(opts);
  } catch (e: any) {
    ctx.sendLog('warn', `[${label}] 检查/创建队伍异常,已跳过:${e?.message ?? e}`);
    // 面板是我们开的就尽力关掉(没开过不能按 Alt+Q,那反而会把它打开)
    if (opened) await closeTeamPanel(opts);
  }
}
