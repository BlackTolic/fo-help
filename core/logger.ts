// 统一日志抽象
// Node 端用 pino + 自定义 transport(在 worker_thread 跑,格式化 + 写文件不阻塞主线程)
// 浏览器端用 console 包装(API 兼容)
//
// 输出格式: HH:MM:ss.SSS [LEVEL] [component] msg [key=value ...]
//   - 时间:ISO 字符串切片 11-23 位,毫秒精度
//   - LEVEL:5 字符宽度,加粗,按级别颜色
//     trace=gray, debug=cyan, info=green, warn=yellow, error=red, fatal=magenta
//   - component:暗色,方括号包裹
//   - msg:正常颜色
//   - 结构化字段(extra):key=value 拼在 msg 后
//
// 非 TTY 时(管道/重定向/子进程 stdout)自动剥除 ANSI 颜色码,方便日志聚合

import pino from 'pino';
import path from 'path';

// 自定义 transport(单独文件):pino transport 在 worker_thread 跑,函数不能
// postMessage 序列化。target 必须是模块路径。
const TRANSPORT_PATH = path.join(__dirname, 'logger-format.js');

const isDev = process.env.NODE_ENV !== 'production';
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

  // dev 用自定义 transport(logger-format.js 提供 ANSI 颜色 + 自定义格式)
  // production 用默认 JSON(便于日志聚合)
  const useTransport = isDev;

  _pino = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    ...(useTransport
      ? {
          transport: {
            target: TRANSPORT_PATH,
            options: {},
          },
        }
      : {}),
  });
  return _pino;
}

type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';

function browserLogger(prefix: string): Logger {
  // 浏览器端:用 console + 内置级别颜色(浏览器 DevTools 自动着色)
  const fn = (level: ConsoleLevel, args: any[]) => {
    const tag = `[${prefix}]`;
    if (level === 'debug') console.log(tag, ...args);
    else if (level === 'info') console.info(tag, ...args);
    else if (level === 'warn') console.warn(tag, ...args);
    else {
      if (args[0] instanceof Error) {
        console.error(tag, args[0].message, args[0].stack);
      } else {
        console.error(tag, ...args);
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
  // pino .child({ component }) 把 component 绑定到日志输出,transport 用 {component} 引用
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
