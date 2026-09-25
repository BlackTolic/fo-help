// 验证码大模型求解器
// 接口 + 通义千问(qwen-vl)实现 + Mock 实现(没配 API key 或联调时用)
//
// 为什么用 qwen-vl:验证码 = 问题文本截图 + 三选项截图,多模态模型一次调用即可
// 返回选项序号(I/II/III);识别失败返回 null(调用方兜底:点第一个选项)
//
// API key 来源:DASHSCOPE_API_KEY 环境变量,或 worker init.profile.interrupt.dashscopeApiKey

export type VerifyAnswer = 'I' | 'II' | 'III';

export interface CaptchaSolver {
  /**
   * @param questionImageBase64 PNG base64(不含 dataURL 前缀)
   * @param optionsImageBase64  三选项区域 PNG base64
   * @returns 选项序号;无法确定时返回 null(不要瞎猜,调用方有兜底策略)
   */
  solve(questionImageBase64: string, optionsImageBase64: string): Promise<VerifyAnswer | null>;
}

const VALID_ANSWERS: VerifyAnswer[] = ['I', 'II', 'III'];

function normalizeAnswer(text: string): VerifyAnswer | null {
  const t = text
    .trim()
    .toUpperCase()
    .replace(/[。.!！\s]/g, '');
  for (const a of VALID_ANSWERS) {
    if (t === a || t.includes(a)) return a;
  }
  // 兼容模型回复 "选项I" / "第一个" 之类
  if (t.includes('一') || t === '1') return 'I';
  if (t.includes('二') || t === '2') return 'II';
  if (t.includes('三') || t === '3') return 'III';
  return null;
}

export interface DashScopeSolverOptions {
  apiKey: string;
  /** 默认 qwen-vl-max;想省钱可换 qwen-vl-plus */
  model?: string;
  /** 单次请求超时(毫秒) */
  timeoutMs?: number;
  endpoint?: string;
}

/** 通义千问 DashScope(兼容 OpenAI 格式)验证码求解 */
export class DashScopeCaptchaSolver implements CaptchaSolver {
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private endpoint: string;

  constructor(opts: DashScopeSolverOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'qwen-vl-max';
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.endpoint =
      opts.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  }

  async solve(
    questionImageBase64: string,
    optionsImageBase64: string,
  ): Promise<VerifyAnswer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    '图1是一道算术或常识问题,图2是与问题对应的三个候选答案(从上到下依次为 I、II、III)。' +
                    '请确定哪个选项等于问题的正确答案,只回复选项序号 I、II 或 III 中的一个字母,不要输出任何其他内容。',
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${questionImageBase64}` },
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${optionsImageBase64}` },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`DashScope HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const data: any = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      if (Array.isArray(content)) {
        // 部分模型返回 content 数组
        const text = content.map((c: any) => c?.text ?? '').join('');
        return normalizeAnswer(text);
      }
      return normalizeAnswer(String(content));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 固定答案的 Mock 求解器(联调/测试用) */
export class StaticCaptchaSolver implements CaptchaSolver {
  constructor(private answer: VerifyAnswer | null = 'I') {}
  async solve(): Promise<VerifyAnswer | null> {
    return this.answer;
  }
}
