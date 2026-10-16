// 宠物带练(挂机辅助配置的一员):到触发点时打开宠物栏 → 看当前出战宠物的等级 → 达标就换下一只继续
//
// 触发点由辅助配置自己挑(见 shared/types.ts 的 PetTrainingConfig.triggers、shared/farm-aux.ts),
// 调用方是 farm-aux.ts(挂机主循环在各个时机调它)。
//
// 宠物出战的规则(实测确认,整个流程都建立在这上面):
//   - 同一时刻最多只有 1 只宠物是「醒」(已出战)
//   - 双击睡眠的那只 = 让它出战(原来出战的那只自动变睡眠);双击出战的那只 = 让它睡眠
//   - 所以「第 k 只是醒的」= 前 k-1 只都已经练好了;出战序号本身就是进度,不用另外存
//
// 一次执行:
//   1. 确保宠物栏是打开的(Alt+P,见 shared/game-hotkeys.ts 的 openPetPanel;列表区域找不到宠物就再按一次)
//   2. OCR 读一遍宠物列表区域:数出「睡」「醒」各几次 = 有几只、几只睡眠几只出战,以及按阅读顺序出战的是第几只
//   3. 找字定位每只宠物名字的坐标(OCR 不给坐标,双击落点只能靠找字),按 y 再 x 排序 = 列表第 1、2、3… 只;
//      两边数量对不上 / OCR 顺序与坐标顺序推出的「出战序号」不一致时都打 warn 提示校准
//   4. 全是睡眠 → 双击第 1 只把它唤醒(相当于从头开始带)
//   5. OCR 读当前出战那只的等级/饥渴/信赖(区域同样在 pet.ts)
//   6. 达标(等级 >= targetLevel 或 学会了 targetSkill)→ 双击列表里下一只睡眠的,换它出战;
//      不达标 → 这一只继续带(什么都不做)
//   7. 出战序号 > 设定的宠物数量 = 全部带练完,收工
//   8. 关掉宠物栏(Alt+P)
//
// ⚠️ 待校准(实测后改 core/constant-ocr/pet.ts 即可):
//   - 宠物列表区域/颜色/找字字串:1280*800 是实测值,1600*900 未实测(缺档位就提示一次并跳过)
//   - 「换宠物」的落点:按「找字命中的名字位置 + PET_LIST_CLICK_OFFSET」双击;要点头像就补偏移

import type { WindowSizeKey } from '../../../core/constant-ocr/popup';
import {
  PET_INFO_ROI,
  PET_LIST_ASLEEP,
  PET_LIST_AWAKE,
  PET_LIST_CLICK_OFFSET,
  PET_LIST_ROI,
  PET_LIST_SIM,
  PET_SKILL_ROI,
  PET_TRAINING_TIMING,
} from '../../../core/constant-ocr/pet';
import type { Point } from '../../../core/platform/vision/IVisionProvider';
import { sleep } from '../../../core/utils/sleep';
import { pressGameHotkey } from '../../../shared/game-hotkeys';
import type { PetTrainingConfig, ResupplyAuxConfig } from '../../../shared/types';
import type { WorkerContext } from './context';
import { parkMouseTopLeft } from './park-mouse';
import type { PetRideDeps } from './pet-ride';

/** 宠物列表里的一只宠物:找字命中的位置 + 它当前是醒(已出战)还是睡(睡眠) */
interface PetListEntry {
  pos: Point;
  awake: boolean;
}

/**
 * 读一次宠物列表的结果:OCR 数只数 + 找字给坐标(两边交叉校验)。
 *   OCR 负责「有几只、几只睡、几只醒」;找字负责「每只在哪个坐标」(双击落点)。
 * 大漠的 Ocr 只返回文字、不给坐标;一次拿到「文字 + 坐标」的接口是 OcrEx,本工程还没包(返回格式没实测过)。
 */
interface PetListRead {
  /** OCR 读到的整块文字(空 = 一个字都没认出来) */
  text: string;
  /** OCR 文字里「睡」「醒」各出现几次 = 睡眠 / 出战的宠物数 */
  states: { asleep: number; awake: number };
  /** 找字定位到的每一只,按列表顺序(y 再 x);双击落点用它 */
  entries: PetListEntry[];
  /** OCR 文字里出战那只的序号(第一个「醒」前面有几只睡 + 1,按 OCR 阅读顺序);-1 = 文字里没有「醒」 */
  awakeOrdinal: number;
}

/** 一只宠物的信息(等级/饥渴/信赖;读不到为 null) */
interface PetInfo {
  level: number | null;
  petType: '肉' | '草' | null; // 新增属性:宠物食性(肉/草)
  thirst: number | null;
  trust: number | null;
}

/** 宠物列表区域的矩形(与 PET_LIST_ROI 的档位字段一致) */
interface PetListRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 状态字:两条找字串的最后一个字(睡 / 醒);OCR 文字按它出现几次来数只数 */
const SLEEP_CHAR = PET_LIST_ASLEEP.text.slice(-1);
const AWAKE_CHAR = PET_LIST_AWAKE.text.slice(-1);

/** 文字里某个字出现了几次(状态字为空时返回 0) */
function countChar(text: string, ch: string): number {
  return ch ? text.split(ch).length - 1 : 0;
}

/**
 * 解析大漠 findStrEx 的返回 "序号,x,y|序号,x,y|…" → 逐个命中点(空/格式不对的段丢掉)
 * (坐标在第 2、3 个数上,与 utils/parse 的 parseTextPos 同口径,只是这里要全部命中)
 */
function parseFindStrEx(text: string): Point[] {
  const out: Point[] = [];
  for (const seg of String(text ?? '').split('|')) {
    const parts = seg.split(',');
    if (parts.length < 3) continue;
    const x = Math.round(Number(parts[1]) || 0);
    const y = Math.round(Number(parts[2]) || 0);
    if (x <= 0 || y <= 0) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * 识别前把鼠标挪到左上角(公共实现见 park-mouse.ts):
 * 鼠标停在识别区域上会挡住字(指针本身就画在画面上),OCR/找字会读错或读不到。
 */
async function parkMouseAwayFrom(deps: PetRideDeps): Promise<void> {
  await parkMouseTopLeft(deps.input);
}

/**
 * 读宠物列表:
 *   1. 先 OCR 整块区域(两种颜色一起读)→ 数出「睡」「醒」各几次 = 几只睡眠 / 几只出战,
 *      以及按 OCR 阅读顺序出战的是第几只(第一个「醒」前面有几只睡 + 1);
 *   2. 再用找字拿每只宠物名字的坐标(OCR 不给坐标),按 y 再 x 排序 = 列表从上到下 / 从左到右 ——
 *      双击落点用它。列表里一只都没定位到时 entries 是空数组(面板没开 / 区域或颜色对不上)。
 * 读之前先把鼠标挪到左上角(见 parkMouseAwayFrom),否则鼠标箭头会挡住字。
 */
async function readPetList(deps: PetRideDeps, roi: PetListRoi): Promise<PetListRead> {
  const { client } = deps;
  await parkMouseAwayFrom(deps);

  // 1) OCR:数只数与状态(文字里「睡」「醒」各出现几次)
  const text = client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, `${PET_LIST_ASLEEP.color}|${PET_LIST_AWAKE.color}`, PET_LIST_SIM);
  const states = { asleep: countChar(text, SLEEP_CHAR), awake: countChar(text, AWAKE_CHAR) };
  // 按 OCR 阅读顺序出战的是第几只(第一个「醒」前面有几只睡 + 1)
  const awakeAt = text.indexOf(AWAKE_CHAR);
  // 没有「醒」时返回 -1
  const awakeOrdinal = awakeAt < 0 ? -1 : countChar(text.slice(0, awakeAt), SLEEP_CHAR) + 1;

  // 2) 找字:每只宠物名字的坐标(OCR 不给坐标,双击落点只能用找字的)
  const find = (str: string, color: string): Point[] =>
    parseFindStrEx(client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, str, color, PET_LIST_SIM));
  const entries: PetListEntry[] = [
    ...find(PET_LIST_AWAKE.text, PET_LIST_AWAKE.color).map((pos) => ({ pos, awake: true })),
    ...find(PET_LIST_ASLEEP.text, PET_LIST_ASLEEP.color).map((pos) => ({ pos, awake: false })),
  ];
  return { text, states, entries: entries.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x), awakeOrdinal };
}

/**
 * 读宠物信息(等级/饥渴/信赖):OCR 整块区域的文字后按「字母/汉字 + 数字」取前三个数
 * (与参考工程 ffo-auto-tool 的 checkPetInfo 同一套;读不到返回 null)。
 * 同样先把鼠标挪到左上角(鼠标压在字上会读错)。
 */
async function readPetInfo(deps: PetRideDeps, size: WindowSizeKey): Promise<PetInfo | null> {
  const roi = PET_INFO_ROI[size];
  if (!roi) return null;
  await parkMouseAwayFrom(deps);
  const petInfoText = deps.client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim);
  if (!petInfoText) return null;
  // 1. 匹配 字母/汉字 + 数字 + 汉字
  const regex = /(?<=[a-zA-Z\u4e00-\u9fa5])(\d+)/g;
  return {
    level: Number(petInfoText?.match?.(regex)?.[0] || '') ?? null, // 等级
    petType: petInfoText.indexOf('肉') !== -1 ? '肉' : '草', // 宠物食性
    thirst: Number(petInfoText?.match?.(regex)?.[1] || '') ?? null, // 饥渴
    trust: Number(petInfoText?.match?.(regex)?.[2] || '') ?? null, // 信赖
  };
}

/** 读宠物技能名字区域(判「学会目标技能」用);没配区域档位返回 null。同样先挪开鼠标 */
async function readPetSkillText(deps: PetRideDeps, size: WindowSizeKey): Promise<string | null> {
  const roi = PET_SKILL_ROI[size];
  if (!roi) return null;
  await parkMouseAwayFrom(deps);
  return deps.client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.sim);
}

/**
 * 确保宠物栏是打开的:按 Alt+P 后在列表区域找宠物,找不到再按一次(面板本来就开着时第一次按是"关")。
 * @returns true = 列表区域已经能识别到宠物
 */
async function ensurePanelOpen(ctx: WorkerContext, deps: PetRideDeps, roi: PetListRoi, label: string): Promise<boolean> {
  // 面板可能本来就开着:先直接看一眼,省一次开合
  if ((await readPetList(deps, roi)).entries.length > 0) return true;
  for (let i = 0; i < 2; i++) {
    await pressGameHotkey(deps.client, 'openPetPanel');
    await sleep(PET_TRAINING_TIMING.panelSettleMs);
    if ((await readPetList(deps, roi)).entries.length > 0) return true;
    ctx.sendLog('warn', `[${label}] 宠物带练:按 Alt+P 后没在列表区域识别到宠物(第 ${i + 1} 次),再按一次`);
  }
  return false;
}

/**
 * 换第 k 只宠物出战:双击它的位置(双击一只睡眠的 = 让它出战,原来出战的那只自动变睡眠),
 * 隔一会儿再读列表确认真的换过去了。
 * 调用方保证第 k 只此时是睡眠的(见 runPetTraining:总是往出战后一只换)。
 * @returns true = 现在出战的确实是第 k 只
 */
async function switchToPet(
  ctx: WorkerContext,
  deps: PetRideDeps,
  roi: PetListRoi,
  entries: PetListEntry[],
  k: number,
  label: string,
): Promise<boolean> {
  const target = entries[k - 1];
  if (!target) {
    ctx.sendLog('warn', `[${label}] 宠物带练:列表里只有 ${entries.length} 只,没有第 ${k} 只可切,收工`);
    return false;
  }
  const offset = PET_LIST_CLICK_OFFSET[deps.size] ?? { x: 0, y: 0 };
  const point = { x: target.pos.x + offset.x, y: target.pos.y + offset.y };
  ctx.sendLog(
    'info',
    `[${label}] 宠物带练:换第 ${k} 只出战(双击 ${point.x},${point.y}${offset.x || offset.y ? `,偏移 ${offset.x},${offset.y}` : ''})`,
  );
  await deps.input.moveMouse(point, { kind: 'instant' });
  await deps.input.delay(PET_TRAINING_TIMING.pollMs);
  await deps.input.click('left', 2);
  // 双击完马上把鼠标挪到左上角:别让它停在宠物上(悬停会弹 tooltip / 高亮,可能盖住名字),
  // 也把 switchSettleMs 整段时间留给这些效果收干净 —— 等都等完了再挪,就只剩 parkSettleMs 那么点时间了
  await parkMouseAwayFrom(deps);
  await deps.input.delay(PET_TRAINING_TIMING.switchSettleMs);

  // 再读一次确认换过去了(是醒还是睡眠):readPetList 里还会再挪一次,保证读的那一刻鼠标一定不在区域里
  const awakeNow = (await readPetList(deps, roi)).entries.findIndex((e) => e.awake) + 1;
  if (awakeNow === k) {
    ctx.sendLog('info', `[${label}] 宠物带练:第 ${k} 只已出战`);
    return true;
  }
  ctx.sendLog(
    'warn',
    `[${label}] 宠物带练:双击后读到的出战宠物是第 ${awakeNow || '?'} 只(期望第 ${k} 只)` +
      `,落点可能要校准(core/constant-ocr/pet.ts 的 PET_LIST_CLICK_OFFSET)`,
  );
  return false;
}

/**
 * 执行一次宠物带练(到触发点时由 farm-aux 调用)。
 * 全部失败路径都只记日志、不抛:辅助配置出问题不能打断挂机(见 AGENTS.md 的错误处理约定)。
 */
export async function runPetTraining(
  ctx: WorkerContext,
  deps: PetRideDeps,
  conf: PetTrainingConfig | ResupplyAuxConfig,
  label: string,
): Promise<void> {
  const { size, client } = deps;
  const name = 'name' in conf ? conf.name : '宠物带练';
  const roi = PET_LIST_ROI[size];
  if (!roi) {
    ctx.sendLog('warn', `[${label}] 宠物带练「${name}」:分辨率 ${size} 还没有实测的宠物列表区域(core/constant-ocr/pet.ts),本次跳过`);
    return;
  }
  if (!(conf.petCount > 0)) {
    ctx.sendLog('warn', `[${label}] 宠物带练「${name}」:没填要带练的宠物数量,本次跳过`);
    return;
  }

  // 面板开好了才需要收尾关闭;ensurePanelOpen 里读不到宠物 = 面板状态未知,收尾时不要乱按(按了反而是"开")
  let panelOpen = false;
  try {
    panelOpen = await ensurePanelOpen(ctx, deps, roi, label);
    if (!panelOpen) {
      ctx.sendLog('warn', `[${label}] 宠物带练「${name}」:打不开宠物栏(列表区域识别不到宠物,区域/颜色/字库可能要校准),本次跳过`);
      return;
    }

    let list = await readPetList(deps, roi);
    let entries = list.entries;
    const ocrTotal = list.states.asleep + list.states.awake;
    // OCR 先读一遍:有几只、几只睡几只醒、按阅读顺序出战的是第几只(找字只负责给双击落点)
    ctx.sendLog(
      'info',
      `[${label}] 宠物带练「${name}」:列表 OCR「${list.text || '(没认出一个字)'}」→ 共 ${ocrTotal} 只` +
        `(睡眠 ${list.states.asleep} / 出战 ${list.states.awake})` +
        `${list.awakeOrdinal > 0 ? `,按 OCR 顺序出战的是第 ${list.awakeOrdinal} 只` : ''}` +
        `;找字定位到 ${entries.length} 个名字的坐标`,
    );
    if (entries.length > 0 && ocrTotal !== entries.length) {
      ctx.sendLog(
        'warn',
        `[${label}] 宠物带练「${name}」:OCR 读到 ${ocrTotal} 只、找字只定位到 ${entries.length} 个 —— ` +
          `区域/颜色/字库可能要校准(双击落点只能用找字的结果)`,
      );
    }

    // 1) 谁在出战:醒 的那只就是当前要带的(它前面的都已经练好了,见文件头部的规则)
    let awakeIdx = entries.findIndex((e) => e.awake);
    if (awakeIdx < 0) {
      // 全是睡眠:先把第 1 只唤醒(相当于从头开始带),然后照样往下看它的等级 —— 不白跑这一趟
      ctx.sendLog(
        'info',
        `[${label}] 宠物带练「${name}」:没有出战的宠物(OCR 读到 ${list.states.awake} 只出战 / 找字没定位到「${PET_LIST_AWAKE.text}」),先唤醒第 1 只`,
      );
      await switchToPet(ctx, deps, roi, entries, 1, label);
      list = await readPetList(deps, roi);
      entries = list.entries;
      awakeIdx = entries.findIndex((e) => e.awake);
      if (awakeIdx < 0) {
        ctx.sendLog('warn', `[${label}] 宠物带练「${name}」:双击后仍然没有醒着的宠物,本次跳过(落点/区域/字库可能要校准)`);
        return;
      }
    }
    const current = awakeIdx + 1;
    const awakeCount = entries.filter((e) => e.awake).length;
    if (awakeCount > 1 || list.states.awake > 1) {
      // 正常最多只有 1 只醒着(双击会互相顶掉):读到多只说明区域/字库对不上,先按第一只处理并提示校准
      ctx.sendLog(
        'warn',
        `[${label}] 宠物带练「${name}」:读到多只醒着的宠物(找字 ${awakeCount} / OCR ${list.states.awake},正常最多 1 只),` +
          `按第 ${current} 只处理;区域/字库可能要校准`,
      );
    }
    // OCR 的阅读顺序推出一个「第几只在出战」,与找字坐标排序的结果对不上就提示 —— 排序错了会导致换错宠物
    if (list.awakeOrdinal > 0 && list.awakeOrdinal !== current) {
      ctx.sendLog(
        'warn',
        `[${label}] 宠物带练「${name}」:OCR 顺序推出出战的是第 ${list.awakeOrdinal} 只、按找字坐标排序是第 ${current} 只 —— ` +
          `列表顺序可能要校准(按找字坐标为准,它决定双击落点)`,
      );
    }

    // 2) 出战的已经是第 N+1 只 = 前 N 只都带完了,收工(只要带练这么多只)
    if (current > conf.petCount) {
      ctx.sendLog('info', `[${label}] 宠物带练「${name}」:出战的已是第 ${current} 只,超过设定的 ${conf.petCount} 只,已带完收工`);
      return;
    }

    // 3) 读当前这只的等级,判要不要换下一只
    const info = await readPetInfo(deps, size);
    const levelDone = !!conf.targetLevel && conf.targetLevel > 0 && info?.level != null && info.level >= conf.targetLevel;
    // 目标技能:宠物面板里能识别到这个名字就算学会(没配技能区域档位时只提示一次,不当成"没学会")
    let skillDone = false;
    if (conf.targetSkill) {
      const skillText = await readPetSkillText(deps, size);
      if (skillText === null) {
        ctx.sendLog(
          'warn',
          `[${label}] 宠物带练「${name}」:配了「目标技能」但分辨率 ${size} 没有宠物技能识别区域(pet.ts 的 PET_SKILL_ROI),本次只按等级判断`,
        );
      } else {
        skillDone = !!skillText && skillText.includes(conf.targetSkill);
      }
    }

    ctx.sendLog(
      'info',
      `[${label}] 宠物带练「${name}」:第 ${current}/${conf.petCount} 只 等级=${info?.level ?? '未识别'}` +
        `${info ? ` 饥渴=${info.thirst ?? '?'} 信赖=${info.trust ?? '?'}` : ''}` +
        (conf.targetLevel ? ` 目标等级=${conf.targetLevel}` : '') +
        (conf.targetSkill ? ` 目标技能=${conf.targetSkill}(${skillDone ? '已学会' : '未识别到'})` : ''),
    );

    if (!levelDone && !skillDone) return; // 还没达标:继续带这一只

    // 4) 达标 → 换下一只(下一只超过要带的数量 = 全部带完)
    const next = current + 1;
    if (next > conf.petCount) {
      ctx.sendLog(
        'info',
        `[${label}] 宠物带练「${name}」:第 ${current} 只已达标(${levelDone ? '等级够' : ''}${levelDone && skillDone ? ' 且 ' : ''}${skillDone ? '学会目标技能' : ''}),已带完 ${conf.petCount} 只,收工`,
      );
      return;
    }
    ctx.sendLog(
      'info',
      `[${label}] 宠物带练「${name}」:第 ${current} 只已达标(${levelDone ? '等级够' : ''}${levelDone && skillDone ? ' 且 ' : ''}${skillDone ? '学会目标技能' : ''}),换第 ${next} 只`,
    );
    await switchToPet(ctx, deps, roi, entries, next, label);
  } catch (e: unknown) {
    ctx.sendLog('warn', `[${label}] 宠物带练「${name}」执行出错:${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // 5) 收尾:关掉宠物栏(与打开是同一个快捷键);面板没开起来时不要按(按了反而是"开")
    if (panelOpen) {
      await pressGameHotkey(client, 'openPetPanel');
      await deps.input.delay(PET_TRAINING_TIMING.pollMs);
    }
  }
}
