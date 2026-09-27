// 图鉴(ttshitu)验证码作答实现
//   接口参考 ffo-auto-tool/src/AI/tu-jian.ts:
//     POST {username, password, typeid, image(base64)} → {success, message?, data:{id, result}}
//   typeid 7 = 无感学习(需在图鉴后台给该账号开通);
//   image 传问题区截图 PNG 的 base64(不含 dataURL 前缀)。
//
// 作答 = 识别问题字符 + 与三个选项字符逐位比对:
//   第 1、2、3 个字符分别相同各得 1 分(满分 3 分),取得分最高的选项;
//   并列时取靠前的 I > II > III;三个选项全 0 分则返回 null,交给调用方兜底。

import {
  VERIFY_ANSWERS,
  type CaptchaSolver,
  type VerifyAnswer,
  type VerifyOptionTexts,
} from './captcha-solver';

const DEFAULT_API_URL = 'http://api.ttshitu.com/predict';
/** 7 = 无感学习 */
const DEFAULT_TYPEID = '7';

/** 参与逐位比对的字符个数:问题与选项都是 3 个字符 */
const COMPARE_LEN = 3;

export interface TuJianSolverOptions {
  account: string;
  password: string;
  /** 图鉴识别类型,默认 7(无感学习) */
  typeid?: string;
  apiUrl?: string;
  /** 单次请求超时(毫秒) */
  timeoutMs?: number;
  /** 日志回调(识别结果 / 匹配得分),不传则不输出 */
  log?: (level: 'info' | 'warn', msg: string) => void;
}

/** 图鉴打码平台:识别问题截图 → 与三个选项字符逐位比对 → 取最高分 */
export class TuJianSolver implements CaptchaSolver {
  constructor(private opts: TuJianSolverOptions) {}

  async solve(
    questionImageBase64: string,
    options: VerifyOptionTexts,
  ): Promise<VerifyAnswer | null> {
    const recognized = await this.recognize(questionImageBase64);
    if (!recognized) {
      this.opts.log?.('warn', '图鉴未识别出问题字符');
      return null;
    }
    this.opts.log?.('info', `图鉴识别结果「${recognized}」`);

    const { answer, scores } = pickBestOption(recognized, options);
    this.opts.log?.(
      'info',
      `逐位匹配得分 I=${scores.I} II=${scores.II} III=${scores.III} → ${answer ?? '无匹配'}`,
    );
    return answer;
  }

  /** 调图鉴接口识别问题截图的字符;失败抛错(调用方记日志后走兜底) */
  private async recognize(imageBase64: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const resp = await fetch(this.opts.apiUrl ?? DEFAULT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.opts.account,
          password: this.opts.password,
          typeid: this.opts.typeid ?? DEFAULT_TYPEID,
          image: imageBase64,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`图鉴 HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const data: any = await resp.json();
      if (!data?.success) {
        throw new Error(`图鉴识别失败: ${data?.message || '未知错误'}`);
      }
      // 图鉴返回值大小写不稳(选项可能是字母),统一大写后再比对
      const result = String(data?.data?.result ?? '')
        .trim()
        .toUpperCase();
      return result || null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 归一化:去掉空白(OCR 结果常夹空格)并转大写 */
const normalize = (text: string): string => String(text || '').replace(/\s+/g, '').toUpperCase();

export interface OptionMatchResult {
  /** 得分最高的选项;三个选项全 0 分时返回 null */
  answer: VerifyAnswer | null;
  /** 各选项得分(0~3),用于日志排查 */
  scores: Record<VerifyAnswer, number>;
}

/**
 * 图鉴识别出的字符 与 三个选项的字符 逐个位置比对
 * @param recognized 图鉴识别出的问题字符
 * @param options    大漠 OCR 出来的三个选项字符
 */
export function pickBestOption(
  recognized: string,
  options: VerifyOptionTexts,
): OptionMatchResult {
  const target = normalize(recognized);
  const texts: Record<VerifyAnswer, string> = {
    I: normalize(options.optionI),
    II: normalize(options.optionII),
    III: normalize(options.optionIII),
  };
  const scores: Record<VerifyAnswer, number> = { I: 0, II: 0, III: 0 };

  for (const key of VERIFY_ANSWERS) {
    const text = texts[key];
    for (let i = 0; i < COMPARE_LEN; i++) {
      // 有一边缺这个位置的字符(识别不全)就不算这一位
      if (target[i] && text[i] && target[i] === text[i]) scores[key]++;
    }
  }

  let answer: VerifyAnswer | null = null;
  for (const key of VERIFY_ANSWERS) {
    if (scores[key] === 0) continue;
    if (!answer || scores[key] > scores[answer]) answer = key;
  }
  return { answer, scores };
}
