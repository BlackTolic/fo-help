// 状态徽章:6 种状态

import { clsx } from 'clsx';
import type { ScriptStatus } from '../../shared/types';

const STATUS_MAP: Record<ScriptStatus, { color: string; bg: string; dot: string; text: string; label: string }> = {
  idle: {
    color: 'text-text-muted',
    bg: 'bg-text-muted/10',
    dot: 'bg-text-muted',
    text: '○',
    label: '空闲',
  },
  combat: {
    color: 'text-accent-red',
    bg: 'bg-accent-red/10',
    dot: 'bg-accent-red',
    text: '●',
    label: '战斗中',
  },
  moving: {
    color: 'text-accent-blue',
    bg: 'bg-accent-blue/10',
    dot: 'bg-accent-blue',
    text: '→',
    label: '移动中',
  },
  resupply: {
    color: 'text-accent-purple',
    bg: 'bg-accent-purple/10',
    dot: 'bg-accent-purple',
    text: '🏠',
    label: '回城中',
  },
  alert: {
    color: 'text-accent-yellow',
    bg: 'bg-accent-yellow/10',
    dot: 'bg-accent-yellow',
    text: '⚠',
    label: '异常',
  },
  paused: {
    color: 'text-text-secondary',
    bg: 'bg-text-secondary/10',
    dot: 'bg-text-secondary',
    text: '⏸',
    label: '暂停',
  },
};

export function StatusBadge({ status, animate = false }: { status: ScriptStatus; animate?: boolean }) {
  const cfg = STATUS_MAP[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium', cfg.color, cfg.bg)}>
      <span className={clsx('inline-block w-1.5 h-1.5 rounded-full', cfg.dot, animate && status === 'combat' && 'animate-pulse')} />
      {cfg.text} {cfg.label}
    </span>
  );
}
