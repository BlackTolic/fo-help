// 内置弹框处理器
//   team-invite  → 点「拒绝」关闭弹框(同步点击,毫秒级完成)
//   verify-code  → 截问题/选项图 → 大模型求解 → 点击对应选项(异步,数秒;
//                  期间任务主循环继续打怪)

import fs from 'fs';
import os from 'os';
import path from 'path';
import { dmApi } from '../platform/damoo/dm-api';
import {
  VERIFY_CODE_CAPTURE,
  VERIFY_CODE_OPTION_CLICK_OFFSET,
  INVITE_TEAM_REJECT_POS,
  type WindowSizeKey,
} from '../constant-ocr/popup';
import type { CaptchaSolver, VerifyAnswer } from '../ai/captcha-solver';
import type { PopupHandler, PopupMatch, PopupHandlerContext } from './types';

/** 点击某个绝对屏幕坐标(瞬移 + 左键) */
async function clickAt(ctx: PopupHandlerContext, x: number, y: number): Promise<void> {
  await ctx.input.moveMouse({ x, y }, { kind: 'instant' });
  await ctx.input.delay(80);
  await ctx.input.click('left');
}

/** 点击验证码选项(选项点击位置 = 锚点 + 相对偏移) */
async function clickVerifyOption(
  answer: VerifyAnswer,
  anchor: { x: number; y: number },
  ctx: PopupHandlerContext,
): Promise<void> {
  const offset = VERIFY_CODE_OPTION_CLICK_OFFSET[answer];
  await clickAt(ctx, anchor.x + offset.x, anchor.y + offset.y);
}

/**
 * 组队邀请 → 点「拒绝」关掉弹框
 * 行为与参考工程一致:不自动进队(避免被陌生人拉走)
 */
export function createTeamInviteRejectHandler(sizeKey: WindowSizeKey): PopupHandler {
  const reject = INVITE_TEAM_REJECT_POS[sizeKey];
  return {
    async handle(_match: PopupMatch, ctx: PopupHandlerContext): Promise<void> {
      ctx.log('info', `关闭组队邀请弹框(拒绝 @ ${reject.x},${reject.y})`);
      await clickAt(ctx, reject.x, reject.y);
      await ctx.input.delay(300);
    },
  };
}

/**
 * 神医验证码 → 大模型求解并点击正确选项
 * 兜底策略(与参考工程一致):模型不可用/识别失败时直接点第一个选项 I,
 * 避免弹框超时把角色踢下线
 */
export function createVerifyCodeHandler(
  sizeKey: WindowSizeKey,
  solver: CaptchaSolver,
): PopupHandler {
  return {
    async handle(match: PopupMatch, ctx: PopupHandlerContext): Promise<void> {
      const { anchor } = match;
      const tmpDir = os.tmpdir();
      const ts = Date.now();
      const questionPath = path.join(tmpDir, `fo-verify-q-${ts}.png`);
      const optionsPath = path.join(tmpDir, `fo-verify-o-${ts}.png`);

      try {
        // 1. 截取问题区 + 选项区
        const q = VERIFY_CODE_CAPTURE.question;
        const o = VERIFY_CODE_CAPTURE.options;
        const rq = dmApi.capturePng(
          anchor.x + q.dx1,
          anchor.y + q.dy1,
          anchor.x + q.dx2,
          anchor.y + q.dy2,
          questionPath,
        );
        const ro = dmApi.capturePng(
          anchor.x + o.dx1,
          anchor.y + o.dy1,
          anchor.x + o.dx2,
          anchor.y + o.dy2,
          optionsPath,
        );
        if (rq !== 1 || ro !== 1) {
          ctx.log('warn', `验证码截图失败(q=${rq}, o=${ro}),直接兜底点第一个选项`);
          await clickVerifyOption('I', anchor, ctx);
          return;
        }

        // 2. 大模型求解
        const questionB64 = fs.readFileSync(questionPath).toString('base64');
        const optionsB64 = fs.readFileSync(optionsPath).toString('base64');
        let answer: VerifyAnswer | null = null;
        try {
          answer = await solver.solve(questionB64, optionsB64);
        } catch (e: any) {
          ctx.log('warn', `大模型求解失败: ${e?.message || e}`);
        }
        if (!answer) {
          ctx.log('warn', '未识别出答案,兜底点第一个选项');
          answer = 'I';
        }

        // 3. 点击对应选项
        ctx.log('info', `选择答案选项 ${answer}`);
        await clickVerifyOption(answer, anchor, ctx);
      } finally {
        // 截图是临时调试用,用完即删;排查时可先注释这里
        for (const p of [questionPath, optionsPath]) {
          try {
            fs.unlinkSync(p);
          } catch {
            /* noop */
          }
        }
      }
    },
  };
}
