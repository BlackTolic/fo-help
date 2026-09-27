// 验证码作答接口:handler 只依赖这个接口,具体识别服务在实现里(当前是图鉴,见 ./tu-jian.ts)
//
// 作答流程(见 core/interrupt/handlers.ts):
//   截问题区图 + 大漠 OCR 三个选项的字符 → solve() → 返回该点哪个选项

/** 三个选项的序号,顺序 = 弹框里从上到下 */
export type VerifyAnswer = 'I' | 'II' | 'III';

/** 三个选项的遍历顺序(也是并列时的优先级:靠前者优先) */
export const VERIFY_ANSWERS: VerifyAnswer[] = ['I', 'II', 'III'];

/** 大漠 OCR 出来的三个选项字符 */
export interface VerifyOptionTexts {
  optionI: string;
  optionII: string;
  optionIII: string;
}

export interface CaptchaSolver {
  /**
   * @param questionImageBase64 问题区截图 PNG base64(不含 dataURL 前缀)
   * @param options 大漠 OCR 出来的三个选项字符
   * @returns 要点击的选项序号;无法确定时返回 null(不要瞎猜,调用方有兜底策略)
   */
  solve(questionImageBase64: string, options: VerifyOptionTexts): Promise<VerifyAnswer | null>;
}

/**
 * 固定答案的兜底/联调实现
 * 没配识别账号时用它:直接点第一个选项,避免弹框超时把角色踢下线
 */
export class StaticCaptchaSolver implements CaptchaSolver {
  constructor(private answer: VerifyAnswer | null = 'I') {}

  async solve(): Promise<VerifyAnswer | null> {
    return this.answer;
  }
}
