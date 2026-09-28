// 内置弹框处理器
//   team-invite  → 点「拒绝」关闭弹框(同步点击,毫秒级完成)
//   verify-code  → 截问题区图 → 图鉴识别问题字符 + 大漠 OCR 三选项字符 → 逐位匹配取最高分
//                  → 点击该选项(异步:含一次网络请求,期间任务主循环继续打怪)

import fs from 'fs';
import os from 'os';
import path from 'path';
import { dmApi } from '../platform/damoo/dm-api';
import {
  VERIFY_CODE_CAPTURE,
  VERIFY_CODE_OPTION_CLICK_OFFSET,
  INVITE_TEAM_REJECT_POS,
  type WindowSizeKey,
  VERIFY_CODE_OPTION_ROI_II,
  VERIFY_CODE_OPTION_ROI_I,
  VERIFY_CODE_OPTION_ROI_III,
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
async function clickVerifyOption(answer: VerifyAnswer, anchor: { x: number; y: number }, ctx: PopupHandlerContext): Promise<void> {
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
 * 神医验证码 → 识别问题 + 三个选项字符,匹配出最像的选项并点击
 *
 * 流程:
 *   1. 截问题区(喂图鉴识别)与三个选项区(仅留档排查)
 *   2. 大漠 OCR 三个选项的字符
 *   3. solver.solve():图鉴识别问题字符,再与三个选项逐位比对取最高分(见 core/ai/tu-jian.ts)
 *   4. 点击该选项
 * 兜底策略(与参考工程一致):识别失败 / 三个选项都没匹配上时直接点第一个选项 I,
 * 避免弹框超时把角色踢下线
 *
 * 截图落在 captureDir(主进程下发:dev = 项目根/logs/verify-codes,
 * packaged = userData/logs/verify-codes),保留到应用退出时由主进程统一清理,方便事后核对识别结果;
 * 未下发时退回系统临时目录,保证 handler 可独立使用。
 * 文件名带 pid:多开时每个窗口一个 worker 进程,同毫秒截图不会互相覆盖。121, 576 ///////236.614 350.630 => 325.630 350.650 => 325.650 350.670
 * +115,+38/+230,55 => +205,+55/+230,75 => +205,+75/+230,95
 */
export function createVerifyCodeHandler(sizeKey: WindowSizeKey, solver: CaptchaSolver, captureDir?: string): PopupHandler {
  const dir = captureDir || path.join(os.tmpdir(), 'fo-help-verify-codes');
  const pid = process.pid;
  return {
    async handle(match: PopupMatch, ctx: PopupHandlerContext): Promise<void> {
      const { anchor } = match;
      // const ts = Date.now();
      const questionPath = path.join(dir, `fo-verify-q-${pid}.png`);
      // const optionsPath = path.join(dir, `fo-verify-o-${pid}-${ts}.png`);
      // const optionsPath1 = path.join(dir, `fo-verify-o1-${pid}-${ts}.png`);
      // const optionsPath2 = path.join(dir, `fo-verify-o2-${pid}-${ts}.png`);
      // const optionsPath3 = path.join(dir, `fo-verify-o3-${pid}-${ts}.png`);
      const oI = VERIFY_CODE_OPTION_ROI_I[sizeKey];
      const oII = VERIFY_CODE_OPTION_ROI_II[sizeKey];
      const oIII = VERIFY_CODE_OPTION_ROI_III[sizeKey];

      // 截图保留在本轮运行期间供排查,应用退出时由主进程统一清理
      fs.mkdirSync(dir, { recursive: true });

      // 1. 截取问题区 + 选项区
      const q = VERIFY_CODE_CAPTURE.question;
      // const o = VERIFY_CODE_CAPTURE.options;
      // const o1 = VERIFY_CODE_CAPTURE.optionI;
      // const o2 = VERIFY_CODE_CAPTURE.optionII;
      // const o3 = VERIFY_CODE_CAPTURE.optionIII;

      const rq = dmApi.capturePng(anchor.x + q.dx1, anchor.y + q.dy1, anchor.x + q.dx2, anchor.y + q.dy2, questionPath);
      // const ro = dmApi.capturePng(anchor.x + o.dx1, anchor.y + o.dy1, anchor.x + o.dx2, anchor.y + o.dy2, optionsPath);
      // const ro1 = dmApi.capturePng(anchor.x + o1.dx1, anchor.y + o1.dy1, anchor.x + o1.dx2, anchor.y + o1.dy2, optionsPath1);
      // const ro2 = dmApi.capturePng(anchor.x + o2.dx1, anchor.y + o2.dy1, anchor.x + o2.dx2, anchor.y + o2.dy2, optionsPath2);
      // const ro3 = dmApi.capturePng(anchor.x + o3.dx1, anchor.y + o3.dy1, anchor.x + o3.dx2, anchor.y + o3.dy2, optionsPath3);

      const optionI = dmApi.ocr(anchor.x + oI.x1, anchor.y + oI.y1, anchor.x + oI.x2, anchor.y + oI.y2, oI.color, oI.sim);
      const optionII = dmApi.ocr(anchor.x + oII.x1, anchor.y + oII.y1, anchor.x + oII.x2, anchor.y + oII.y2, oII.color, oII.sim);
      const optionIII = dmApi.ocr(anchor.x + oIII.x1, anchor.y + oIII.y1, anchor.x + oIII.x2, anchor.y + oIII.y2, oIII.color, oIII.sim);

      ctx.log('info', `选项 OCR 结果 I=${optionI} II=${optionII} III=${optionIII}`);

      if (rq !== 1) {
        ctx.log('warn', `验证码截图失败(q=${rq}),直接兜底点第一个选项`);
        await clickVerifyOption('I', anchor, ctx);
        return;
      }
      ctx.log('info', `验证码截图已保存 → ${dir}`);

      // 2. 图鉴识别问题字符 + 与三个选项逐位匹配(识别结果与得分由 solver 记日志)
      const questionB64 = fs.readFileSync(questionPath).toString('base64');
      let answer: VerifyAnswer | null = null;
      try {
        answer = await solver.solve(questionB64, { optionI, optionII, optionIII });
      } catch (e: any) {
        ctx.log('warn', `验证码识别失败: ${e?.message || e}`);
      }
      if (!answer) {
        ctx.log('warn', '未匹配到选项,兜底点第一个选项');
        answer = 'I';
      }

      // 3. 点击对应选项
      // ⚠️ 调试中:暂时不点击,只看识别结果与匹配得分(选项 OCR / [图鉴] 日志)
      ctx.log('info', `选择选项 ${answer}(锚点 ${anchor.x},${anchor.y})`);
      await clickVerifyOption(answer, anchor, ctx);
    },
  };
}
