// 统一日志抽象
// Node 端用 pino,浏览器端用 console 包装(API 兼容)

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
// 用 typeof 检查环境,避免 SSR/Worker 出错
const isRenderer =
  typeof (globalThis as any).window !== 'undefined' &&
  typeof (globalThis as any).document !== 'undefined';

interface Logger {
  debug: (msg: string, ...args: any[]) => void;
  info: (msg: string, ...args: any[]) => void;
  warn: (msg: string, ...args: any[]) => void;
  error: (msg: string | Error, ...args: any[]) => void;
  child: (bindings: Record<string, any>) => Logger;
}

let _pino: any = null;
function getPino() {
  if (_pino) return _pino;

  // 仅 dev + 主进程 + 真 TTY 才开 pino-pretty transport
  // utilityProcess 把 stdio 设成 pipe 时,worker thread transport 拿不到 destination
  //   → 报 "unable to determine transport target"
  // 用 sync: true 跑在主线程里,顺手 destination: 1 (stdout) 显式指定
  const useTransport =
    isDev && process.stdout?.isTTY === true && typeof process.send !== 'function';

  _pino = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    ...(useTransport
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
              destination: 1,
              sync: true,
            },
          },
        }
      : {}),
  });
  return _pino;
}

type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';

function browserLogger(prefix: string): Logger {
  const fn = (level: ConsoleLevel, args: any[]) => {
    const allArgs = args.length > 0 ? [args[0], ...args.slice(1)] : args;
    const tag = `[${prefix}]`;
    if (level === 'debug') console.log(tag, ...allArgs);
    else if (level === 'info') console.info(tag, ...allArgs);
    else if (level === 'warn') console.warn(tag, ...allArgs);
    else {
      if (allArgs[0] instanceof Error) {
        console.error(tag, allArgs[0].message, allArgs[0].stack);
      } else {
        console.error(tag, ...allArgs);
      }
    }
  };
  return {
    debug: (msg, ...args) => fn('debug', [msg, ...args]),
    info: (msg, ...args) => fn('info', [msg, ...args]),
    warn: (msg, ...args) => fn('warn', [msg, ...args]),
    error: (msg, ...args) => fn('error', [msg, ...args]),
    child: (bindings) =>
      browserLogger(`${prefix}.${bindings.component || bindings.module || 'child'}`),
  };
}

function callPino(level: ConsoleLevel, p: any, msg: string | Error, args: any[]): void {
  // 把首参当消息,后面当结构化数据(简单粗暴版本)
  const ctx = args.length > 0 ? args : undefined;
  if (msg instanceof Error) {
    p[level]({ err: msg, ...(ctx || {}) }, msg.message);
  } else if (ctx) {
    p[level](ctx, msg);
  } else {
    p[level](msg);
  }
}

export function createLogger(component: string): Logger {
  if (isRenderer) return browserLogger(component);
  const p = getPino().child({ component });
  return {
    debug: (msg, ...args) => callPino('debug', p, msg, args),
    info: (msg, ...args) => callPino('info', p, msg, args),
    warn: (msg, ...args) => callPino('warn', p, msg, args),
    error: (msg, ...args) => callPino('error', p, msg, args),
    child: (bindings) => {
      const sub = p.child(bindings);
      return {
        debug: (msg, ...args) => callPino('debug', sub, msg, args),
        info: (msg, ...args) => callPino('info', sub, msg, args),
        warn: (msg, ...args) => callPino('warn', sub, msg, args),
        error: (msg, ...args) => callPino('error', sub, msg, args),
        child: () => sub as any,
      };
    },
  };
}

export const logger = createLogger('app');
