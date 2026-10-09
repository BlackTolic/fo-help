// 对话配方解释器:把 DialogRecipeConfig.steps(数据)跑成 dm 操作序列
//
// 为什么单独一个文件:farm 只管挂机打怪,「对话选项 → 按键 → 判断分支」这套配置驱动的
// 交互逻辑跟打怪无关;resupply-runner 只在"打开商人对话"之后调它。
//
// 跳转(thenId/elseId)用「步骤 id → 下标」映射实现,pc 指向下一步:
//   命中/未命中的跳转目标没配(id 不存在)= 顺序继续下一步(与 shared/types.ts 的约定一致)
// 防死循环 = 执行步数上限:配置写成 A→B→A 这样的环时,到上限直接 fail(而不是把任务卡死)
//
// 每个步骤的失败语义:
//   click-text 按 onMissing 决定(skip = 记警告继续 / fail = 终止整条配方)
//   key 不认识 → fail(静默跳过会让后续步骤点错东西,不如停下来报清楚)
//   wait 超过上限 → 按上限等待并记警告(配置写错一个 0 不至于把任务挂住)

import { parseKeyCombo } from '../../../../shared/key-combo';
import type { DialogRecipeConfig, DialogStep } from '../../../../shared/types';
import type { DamooClient } from '../../../../core/platform/damoo/dm-api';
import type { NpcDialog } from '../../../../core/perception/NpcDialog';
import { sleep } from '../../../../core/utils/sleep';
import type { WorkerContext } from '../context';

/** 配方执行的防呆参数(不是业务配置) */
const RECIPE = {
  /** 最多执行几步:跳转写错成环时靠它退出 */
  maxSteps: 200,
  /** wait 步骤的等待上限(ms) */
  maxWaitMs: 60_000,
  /** 点击/按键/输入后的稳定等待(ms,给游戏处理时间) */
  afterActionMs: 300,
};

/** 按键步骤里认识的特殊键名(大小写不敏感;字母/数字走单字符分支) */
const NAMED_KEYS: Record<string, number> = {
  ESC: 27,
  ESCAPE: 27,
  ENTER: 13,
  RETURN: 13,
  SPACE: 32,
  TAB: 9,
  BACKSPACE: 8,
  DELETE: 46,
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
};

/** 单步执行结果:继续下一步 / 跳到某下标 / 终止整条配方 */
type StepOutcome = { kind: 'next' } | { kind: 'jump'; index: number } | { kind: 'fail'; detail: string };

/** 解释器的运行依赖 */
export interface DialogRecipeDeps {
  ctx: WorkerContext;
  /** 大漠入口(点击/按键/输入文字) */
  client: DamooClient;
  /** 已打开对话的 NPC 对话原语(找选项/点选项/关对话) */
  dialog: NpcDialog;
  /** 日志前缀(与 farm 的 label 一致) */
  label: string;
}

/**
 * 顺序执行一条对话配方,直到步骤跑完 / 某步 fail / 执行步数超上限。
 * 返回值只描述配方本身的结果,关窗由调用方兜底(见 resupply-runner 的 visitMerchant)。
 */
export async function runDialogRecipe(deps: DialogRecipeDeps, recipe: DialogRecipeConfig): Promise<{ ok: boolean; detail?: string }> {
  const { ctx, label } = deps;
  const steps = recipe.steps ?? [];
  if (steps.length === 0) {
    ctx.sendLog('warn', `[${label}] 对话配方(npcKind=${recipe.npcKind})没有任何步骤,跳过`);
    return { ok: true };
  }

  const indexOf = new Map<string, number>();
  steps.forEach((s, i) => {
    // id 重复时保留第一条:跳转落到第一条比"落到最后一条"可预期
    if (!indexOf.has(s.id)) indexOf.set(s.id, i);
  });

  ctx.sendLog('info', `[${label}] 执行对话配方(npcKind=${recipe.npcKind},${steps.length} 步)`);

  let pc = 0;
  let executed = 0;
  while (pc >= 0 && pc < steps.length) {
    if (!ctx.moveAttack.running) return { ok: false, detail: '任务已停止,中断对话配方' };
    if (executed >= RECIPE.maxSteps) {
      return { ok: false, detail: `对话配方执行超过 ${RECIPE.maxSteps} 步(跳转疑似成环),已中断` };
    }
    executed++;

    const step = steps[pc];
    ctx.sendLog('info', `[${label}] 对话步骤 ${pc + 1}/${steps.length} ${stepLabel(step)}`);
    const out = await runStep(deps, step, indexOf, pc);
    if (out.kind === 'fail') return { ok: false, detail: out.detail };
    pc = out.kind === 'jump' ? out.index : pc + 1;
  }

  ctx.sendLog('info', `[${label}] 对话配方跑完(共执行 ${executed} 步)`);
  return { ok: true };
}

// 执行单步对话配方
async function runStep(deps: DialogRecipeDeps, step: DialogStep, indexOf: Map<string, number>, pc: number): Promise<StepOutcome> {
  const { ctx, client, dialog, label } = deps;

  switch (step.kind) {
    // 点击选项
    case 'click-text': {
      const clicked = await dialog.clickOption(step.text, step.offsetX, step.offsetY);
      if (clicked) return { kind: 'next' };
      if (step.onMissing === 'fail') {
        return { kind: 'fail', detail: `第 ${pc + 1} 步:对话选项「${step.text}」没找到(onMissing=fail)` };
      }
      ctx.sendLog('warn', `[${label}] 第 ${pc + 1} 步:对话选项「${step.text}」没找到,按 onMissing=skip 继续下一步`);
      return { kind: 'next' };
    }
    // 点击指定坐标
    case 'click-at': {
      client.moveTo(step.x, step.y);
      await sleep(RECIPE.afterActionMs);
      client.leftClick();
      await sleep(RECIPE.afterActionMs);
      return { kind: 'next' };
    }

    case 'key': {
      const vk = vkOf(step.key);
      if (!vk) {
        return {
          kind: 'fail',
          detail: `第 ${pc + 1} 步:按键「${step.key}」不认识(支持 F1-F12 / Alt+F1 / Shift+F1 / 字母数字 / Esc/Enter/Space/Tab/方向键)`,
        };
      }
      // 修饰键按下 → 主键 → 修饰键反序抬起(与 shared/key-combo.ts 的约定一致)
      for (const m of vk.modifiers) client.keyDown(m);
      client.keyPress(vk.code);
      for (const m of [...vk.modifiers].reverse()) client.keyUp(m);
      await sleep(RECIPE.afterActionMs);
      return { kind: 'next' };
    }

    case 'wait': {
      const ms = Math.max(0, Math.round(step.ms) || 0);
      const wait = Math.min(ms, RECIPE.maxWaitMs);
      if (wait !== ms) {
        ctx.sendLog('warn', `[${label}] 第 ${pc + 1} 步 wait ${ms}ms 超过上限,按 ${RECIPE.maxWaitMs}ms 执行`);
      }
      await sleep(wait);
      return { kind: 'next' };
    }

    case 'input-text': {
      client.sendString(step.text);
      await sleep(RECIPE.afterActionMs);
      return { kind: 'next' };
    }

    case 'if-text': {
      // 只判断"选项区能不能找到这串字",不做 OCR 全文比对:与 click-text 共用同一套区域/颜色
      const hit = dialog.findOption(step.text) !== undefined;
      ctx.sendLog('info', `[${label}] 第 ${pc + 1} 步:条件「${step.text}」${hit ? '命中' : '未命中'}`);
      const targetId = hit ? step.thenId : step.elseId;
      if (!targetId) return { kind: 'next' };
      const index = indexOf.get(targetId);
      if (index === undefined) {
        ctx.sendLog('warn', `[${label}] 第 ${pc + 1} 步:跳转目标 ${targetId} 不存在,顺序继续下一步`);
        return { kind: 'next' };
      }
      return { kind: 'jump', index };
    }

    case 'close-dialog': {
      await dialog.closeDialog();
      return { kind: 'next' };
    }
  }
}

/**
 * 按键字符串 → 虚拟键码:先按 shared/key-combo 解析(F1-F12 / Alt+F1 / Shift+F1),
 * 再认特殊键名,最后单字符(字母/数字;大漠 KeyPress 吃大写 ASCII 码)。认不出来返回 null。
 */
function vkOf(key: string): { code: number; modifiers: number[] } | null {
  const raw = String(key ?? '').trim();
  if (!raw) return null;

  const combo = parseKeyCombo(raw);
  if (combo) return { code: combo.mainVk, modifiers: combo.modifiers };

  const named = NAMED_KEYS[raw.toUpperCase()];
  if (named !== undefined) return { code: named, modifiers: [] };

  if (raw.length === 1) {
    const up = raw.toUpperCase();
    if ((up >= 'A' && up <= 'Z') || (up >= '0' && up <= '9')) return { code: up.charCodeAt(0), modifiers: [] };
  }
  return null;
}

/** 步骤在日志里的写法 */
function stepLabel(step: DialogStep): string {
  switch (step.kind) {
    case 'click-text':
      return `click-text「${step.text}」`;
    case 'click-at':
      return `click-at (${step.x},${step.y})`;
    case 'key':
      return `key ${step.key}`;
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'input-text':
      return `input-text「${step.text}」`;
    case 'if-text':
      return `if-text「${step.text}」`;
    case 'close-dialog':
      return 'close-dialog';
  }
}
