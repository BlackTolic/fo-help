// 宠物技能:回到城里「上骑」,到达挂机点后「下骑」、并按需「打怪前开启宠物技能」
//
// 需求:
//   回到城里 → 检查宠物是否激活(OCR,见 core/perception/PetRideDetector);
//     未激活 → 打开宠物面板(Alt+P) → 双击宠物头像 → 关闭面板(Alt+P),先把宠物激活;
//     激活后 → 释放「上骑」技能,再检测骑乘提示字样是否出现;没出现就隔 1s 再按一次,最多 3 次;
//     3 次都没出现 = 当前宠物不可骑乘或已睡眠(记日志,不阻断任务);
//     已经出现(含按之前就已经骑上)就不再按。每次执行的实际间隔控制在 1s。
//   角色到挂机点 → 释放一次「下骑」技能后才开始打怪(farm 主循环调用)。
//   角色到挂机点 → 「打怪前开启宠物技能」也跟着放一次(与骑乘开关无关;状态技能开一次就一直有,
//     所以每圈只在第一个到达的挂机点放;若那一步刚执行了下骑,则隔 1s 再放)。
//
// 上骑/下骑/打怪前技能都从「宠物技能」(method='pet')的条目里选,可以是同一个按键;
// 由 farm 的 resolveConfig 解析成 ResolvedPetRide 后注入(补给流程与主循环共用同一份)。

import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import { PET_ACTIVATE_POS, PET_INACTIVE_TEXT } from '../../../core/constant-ocr/pet';
import { isPetActive, isPetMounted } from '../../../core/perception/PetRideDetector';
import type { DamooClient } from '../../../core/platform/damoo/dm-api';
import type { IInputProvider } from '../../../core/platform/input/IInputProvider';
import { pressSkillKey } from '../../../core/platform/input/skill-key';
import type { SkillKey } from '../../../core/platform/input/skill-key';
import { sleep } from '../../../core/utils/sleep';
import { pressGameHotkey } from '../../../shared/game-hotkeys';
import type { WorkerContext } from './context';

/** 骑乘动作的可调参数 */
const PET_RIDE = {
  /** 上骑最多执行次数 */
  maxMountAttempts: 3,
  /** 上骑每按一次后等待再检测的时间(ms);也就是两次执行的间隔 */
  retryIntervalMs: 1000,
  /** 下骑后的稳定等待(ms):等技能动作结束再进入打怪循环(后面紧跟「打怪前开启宠物技能」时改由那一步的等待接管) */
  dismountSettleMs: 500,
  /** 「打怪前开启宠物技能」紧跟在下骑之后时的等待(ms):即「下骑之后隔 1S 执行」 */
  preFarmAfterDismountMs: 1000,
  /** 点击(移动鼠标后 / 点完)的稳定等待(ms) */
  clickSettleMs: 300,
  /** 打开宠物面板后等面板渲染出来的时间(ms) */
  panelOpenWaitMs: 500,
};

/** 上骑/下骑引用的宠物技能(已在 farm 侧按 method='pet' + 合法键位校验) */
export interface PetRideSkill {
  id: string;
  key: SkillKey;
  name?: string;
}

/** 解析后的宠物骑乘配置(farm 的 resolveConfig 组装,补给流程与主循环共用) */
export interface ResolvedPetRide {
  enabled: boolean;
  mount: PetRideSkill | null;
  dismount: PetRideSkill | null;
  /** 打怪前开启的宠物技能(与 enabled 相互独立;状态技能,每圈在第一个挂机点释放一次) */
  preFarm: { enabled: boolean; skill: PetRideSkill | null };
}

/** 骑乘动作的运行依赖(farm 侧注入,与补给流程共用 client/size/input) */
export interface PetRideDeps {
  client: DamooClient;
  input: IInputProvider;
  size: WindowSizeKey;
}

const skillLabel = (s: PetRideSkill): string => `${s.key}${s.name ? `·${s.name}` : ''}`;

/**
 * 激活宠物:打开宠物面板 → 双击宠物头像 → 关闭宠物面板
 * (面板开关用快捷键 Alt+P,见 shared/game-hotkeys.ts 的 openPetPanel;双击坐标见 core/constant-ocr/pet.ts)。
 * 只在 OCR 读到「暂时没有宠物」时调用;面板操作失败只记日志,不抛。
 */
async function activatePet(ctx: WorkerContext, deps: PetRideDeps, label: string): Promise<void> {
  const activate = PET_ACTIVATE_POS[deps.size];

  // 打开宠物面板:快捷键 Alt+P(与关闭是同一个开关,按一次即开)
  await pressGameHotkey(deps.client, 'openPetPanel');
  await deps.input.delay(PET_RIDE.panelOpenWaitMs);

  // 双击宠物头像激活(count=2 走大漠原生双击 LeftDoubleClick)
  await deps.input.moveMouse(activate, { kind: 'instant' });
  await deps.input.delay(PET_RIDE.clickSettleMs);
  await deps.input.click('left', 2);
  await deps.input.delay(PET_RIDE.clickSettleMs);

  // 关闭宠物面板:同一个快捷键再按一次
  await pressGameHotkey(deps.client, 'openPetPanel');
  await deps.input.delay(PET_RIDE.clickSettleMs);

  ctx.sendLog('info', `[${label}] 宠物激活:打开面板(Alt+P) → 双击(${activate.x},${activate.y}) → 关闭面板(Alt+P)`);
}

/**
 * 上骑:宠物未激活先激活(打开宠物面板 → 双击 → 关闭),再释放「上骑」,
 * 并按骑乘提示字样判断是否真的骑上。
 * 每次按之前先看提示是否已经出现(已经骑上/上一次生效了就不再按),
 * 最多按 maxMountAttempts 次,每次间隔 retryIntervalMs。
 * @returns true = 已骑上(调用方据此记「到挂机点要下骑」);false = 没骑上(未开启 / 不可骑乘)
 */
export async function mountPet(ctx: WorkerContext, deps: PetRideDeps, petRide: ResolvedPetRide, label: string): Promise<boolean> {
  if (!petRide.enabled || !petRide.mount) return false;

  if (!isPetActive(deps.client, deps.size)) {
    ctx.sendLog('warn', `[${label}] 宠物未激活(读到「${PET_INACTIVE_TEXT}」),执行激活操作`);
    await activatePet(ctx, deps, label);
    if (!ctx.moveAttack.running) return false;
    // 激活后确认一次;仍读到未激活也继续尝试上骑(上骑提示才是最终判据)
    if (!isPetActive(deps.client, deps.size)) {
      ctx.sendLog('warn', `[${label}] 激活后仍读到「${PET_INACTIVE_TEXT}」,继续尝试上骑`);
    }
  }

  for (let i = 0; i < PET_RIDE.maxMountAttempts; i++) {
    if (!ctx.moveAttack.running) return isPetMounted(deps.client);
    // 已经骑上就不再按:可能是本来就在坐骑上,也可能是上一次按的已经生效
    if (isPetMounted(deps.client)) {
      if (i > 0) ctx.sendLog('info', `[${label}] 上骑成功(${skillLabel(petRide.mount)})`);
      else ctx.sendLog('info', `[${label}] 宠物已骑上,无需上骑`);
      return true;
    }
    await pressSkillKey(deps.input, petRide.mount.key);
    ctx.sendLog('info', `[${label}] 上骑:释放 ${skillLabel(petRide.mount)}(第 ${i + 1}/${PET_RIDE.maxMountAttempts} 次)`);
    await sleep(PET_RIDE.retryIntervalMs);
  }

  if (isPetMounted(deps.client)) {
    ctx.sendLog('info', `[${label}] 上骑成功(${skillLabel(petRide.mount)})`);
    return true;
  }
  ctx.sendLog('warn', `[${label}] 上骑 ${PET_RIDE.maxMountAttempts} 次后仍未出现骑乘提示,当前宠物不可骑乘或已睡眠`);
  return false;
}

/**
 * 下骑:到挂机点后释放一次「下骑」技能。
 * opts.skipSettle:后面还紧跟「打怪前开启宠物技能」时置 true —— 收尾等待交给那一步
 * (它会在下骑后隔 1s 才按),这里就不再单独等一次,免得两段加起来超过 1s。
 */
export async function dismountPet(
  ctx: WorkerContext,
  deps: PetRideDeps,
  petRide: ResolvedPetRide,
  label: string,
  opts?: { skipSettle?: boolean },
): Promise<void> {
  if (!petRide.enabled || !petRide.dismount) return;
  await pressSkillKey(deps.input, petRide.dismount.key);
  ctx.sendLog('info', `[${label}] 下骑:释放 ${skillLabel(petRide.dismount)}`);
  if (!opts?.skipSettle && PET_RIDE.dismountSettleMs > 0) await sleep(PET_RIDE.dismountSettleMs);
}

/**
 * 打怪前开启宠物技能:到达挂机点、开始打怪之前释放一次(与「宠物骑乘」开关无关)。
 * 它是状态技能,开一次就一直有 —— 调用方保证每圈只调一次(见 walkWaypoints 的 preFarmSkillDone)。
 * 若这一处刚执行过下骑(opts.afterDismount),先隔 1s 再按,避开下骑动作。
 */
export async function enablePreFarmPetSkill(
  ctx: WorkerContext,
  deps: PetRideDeps,
  petRide: ResolvedPetRide,
  label: string,
  opts?: { afterDismount?: boolean },
): Promise<void> {
  const skill = petRide.preFarm.skill;
  if (!petRide.preFarm.enabled || !skill) return;
  if (opts?.afterDismount) await sleep(PET_RIDE.preFarmAfterDismountMs);
  await pressSkillKey(deps.input, skill.key);
  ctx.sendLog('info', `[${label}] 打怪前开启宠物技能:释放 ${skillLabel(skill)}`);
}
