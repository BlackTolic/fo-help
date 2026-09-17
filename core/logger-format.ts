// 自定义 pino transport(在 worker_thread 跑,不阻塞主线程)
// 完全自管格式化 + 颜色,不走 pino-pretty
//
// ⚠️ 关键:pino transport 给 Writable.write() 传的是 **字符串**(JSON line)
//   不是对象。需要从 JSON.parse 出来再格式化。
//
// 输出格式:`HH:MM:ss.SSS [LEVEL] [component] msg [key=value ...]`
//   - LEVEL:按级别颜色 + 加粗
//   - component:暗色 + 方括号
//   - 时间 + extra:暗色
//   - msg:正常颜色
//
// 非 TTY 时(管道/重定向)自动剥除 ANSI 颜色码,方便日志文件解析

import { Writable } from 'stream';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

const LEVEL_COLORS: Record<string, string> = {
  trace: ANSI.gray,
  debug: ANSI.cyan,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
  fatal: ANSI.magenta,
};

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const SKIP_KEYS = new Set(['time', 'level', 'component', 'msg', 'pid', 'hostname', 'v']);

function formatLog(log: any): string {
  // log.level 是数字(pino 标准),转成字符串 label
  const numLevel = log.level as number;
  const label = LEVEL_LABELS[numLevel] || (typeof log.level === 'string' ? log.level : 'info');
  const ts = log.time
    ? new Date(log.time).toISOString().slice(11, 23) // HH:MM:ss.SSS
    : '--:--:--.---';
  const paddedLabel = label.toUpperCase().padEnd(5);
  const lvlColor = LEVEL_COLORS[label] || '';
  const component = log.component || '';
  const msg = typeof log.msg === 'string' ? log.msg : String(log.msg ?? '');

  // 其他字段拼到末尾:key=value 或 key={...}
  // 跳过 SKIP_KEYS
  // 数字 key(如 `'0'`)是 pino 的 ctx(用户传给 logger.xxx 的第二个参数对象),
  //   展开成 key=value 形式
  const extras: string[] = [];
  for (const k of Object.keys(log)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = (log as any)[k];
    if (/^\d+$/.test(k)) {
      // 数字 key 的 ctx 对象:展开子字段
      if (v && typeof v === 'object' && !(v instanceof Error)) {
        for (const [ck, cv] of Object.entries(v)) {
          extras.push(`${ck}=${typeof cv === 'string' ? cv : JSON.stringify(cv)}`);
        }
      } else if (v instanceof Error) {
        extras.push(`err=${v.message}`);
      } else if (v !== undefined) {
        extras.push(`=${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    } else if (v instanceof Error) {
      extras.push(`${k}=${v.message}`);
    } else if (v !== undefined) {
      extras.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  const extrasStr = extras.join(' ');

  let line =
    `${ANSI.dim}${ts}${ANSI.reset} ` +
    `${lvlColor}${ANSI.bold}${paddedLabel}${ANSI.reset} ` +
    `${ANSI.dim}[${component}]${ANSI.reset} ` +
    `${msg}`;
  if (extrasStr) line += ` ${ANSI.dim}${extrasStr}${ANSI.reset}`;
  return line + '\n';
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI 转义序列安全场景
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * pino transport factory
 * worker_thread 跑这个函数,返回的 Writable 接收 JSON line 字符串
 */
export default function createLoggerTransport(_opts: any) {
  // 决定是否输出颜色:
  //   - 强制开关:FORCE_COLOR=1(强制)/ FORCE_COLOR=0(强制关)
  //   - TTY(isTTY):正常情况
  //   - 默认:开发模式开,生产模式关(生产环境通常是日志文件/管道,不需要颜色)
  const useColor = (() => {
    const force = process.env.FORCE_COLOR;
    if (force === '1') return true;
    if (force === '0') return false;
    return process.stdout.isTTY === true;
  })();
  return new Writable({
    // ⚠️ 不设 objectMode — pino transport 默认传字符串(每行一个 JSON 对象)
    write(chunk: any, _enc: any, callback: any) {
      try {
        const line = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        // 每行一个 JSON 对象(可能多行,用 \n 分割)
        for (const oneLine of line.split('\n')) {
          const trimmed = oneLine.trim();
          if (!trimmed) continue;
          let log: any;
          try {
            log = JSON.parse(trimmed);
          } catch {
            // 不是 JSON,原样输出(可能是 pino 的某些错误日志)
            process.stdout.write(trimmed + '\n');
            continue;
          }
          const formatted = formatLog(log);
          process.stdout.write(useColor ? formatted : stripAnsi(formatted));
        }
      } catch {
        // 容错:即使格式化失败也不影响 worker 继续
      }
      callback();
    },
  });
}
