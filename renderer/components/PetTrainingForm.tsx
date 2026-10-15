// 宠物带练编辑器(pet-training 任务的 config 表单 —— 挂机辅助配置的一员)
//
// 数据面:PetTrainingConfig(见 shared/types.ts)
// 执行侧:electron/workers/game-worker/pet-training.ts —— 到触发点时打开宠物栏(Alt+P)、
//   读当前宠物的等级,达标(等级够 或 学会了目标技能)就换列表里的下一只继续;
//   宠物列表/宠物信息的识别区域见 core/constant-ocr/pet.ts(区域/颜色/找字字串都在那里校准)
//
// 触发点表格在 shared/farm-aux.ts(FARM_AUX_TRIGGERS):改触发点只改那一处

import { FARM_AUX_TRIGGERS } from '../../shared/farm-aux';
import type { FarmAuxTrigger, PetTrainingConfig } from '../../shared/types';

export interface PetTrainingFormProps {
  readOnly?: boolean;
  /** 受控值 */
  value: PetTrainingConfig;
  /** 每次编辑回传整份配置 */
  onChange: (next: PetTrainingConfig) => void;
}

const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

const INPUT_CLS = `w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`;

export function PetTrainingForm(props: PetTrainingFormProps) {
  const { readOnly = false, value, onChange } = props;
  const triggers = value.triggers ?? [];

  const patch = (p: Partial<PetTrainingConfig>) => onChange({ ...value, ...p });
  const toggleTrigger = (id: FarmAuxTrigger, on: boolean) => {
    patch({ triggers: on ? [...triggers, id] : triggers.filter((t) => t !== id) });
  };

  return (
    <div className="space-y-3">
      {/* 触发点:什么时候执行这份配置(可多选) */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          触发点 <span className="text-text-muted text-[11px]">(在哪些时机执行;可多选,至少要选一个)</span>
        </label>
        <div className="space-y-2 bg-bg-input/40 border border-border-base rounded p-2.5">
          {FARM_AUX_TRIGGERS.map((t) => (
            <label key={t.id} className="flex items-start gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent-cyan mt-0.5"
                disabled={readOnly}
                checked={triggers.includes(t.id)}
                onChange={(e) => toggleTrigger(t.id, e.target.checked)}
              />
              <span>
                {t.label}
                <span className="text-text-muted text-[10px] ml-1">{t.hint}</span>
              </span>
            </label>
          ))}
          <div className={`text-[10px] ${triggers.length === 0 ? 'text-accent-yellow/80' : 'text-text-muted'}`}>
            {triggers.length === 0
              ? '⚠ 一个触发点都没选 = 这份配置不会执行(保存前会被提示)'
              : '执行顺序:同一个时机勾了多份配置时,按挂机打怪里「辅助配置」的勾选顺序依次执行'}
          </div>
        </div>
      </div>

      {/* 带练数量 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          要带练的宠物数量 <span className="text-text-muted text-[11px]">(依次带练宠物栏里的前 N 只)</span>
        </label>
        <input
          type="number"
          min={1}
          step={1}
          value={value.petCount}
          onChange={(e) => patch({ petCount: Math.max(1, parseInt(e.target.value) || 1) })}
          disabled={readOnly}
          className={INPUT_CLS}
        />
        <div className="text-[10px] text-text-muted mt-1">
          宠物同一时刻最多只有 1 只出战(醒着):双击睡眠的那只会让它出战、原来出战的自动变睡眠。 所以「列表里第 k 只是醒的」= 前 k-1
          只都已经练好了;全部 N 只都达标后就不再换宠(不记住进度,靠出战的宠物自己判断)
        </div>
      </div>

      {/* 目标等级 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          目标等级 <span className="text-text-muted text-[11px]">(当前宠物达到它就换下一只;0 / 留空 = 不用这个判据)</span>
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={value.targetLevel ?? 0}
          onChange={(e) => patch({ targetLevel: parseInt(e.target.value) || 0 })}
          disabled={readOnly}
          className={INPUT_CLS}
        />
        <div className="text-[10px] text-text-muted mt-1">
          等级读的是宠物信息区域(OCR,见 core/constant-ocr/pet.ts 的 PET_INFO_ROI);读不到等级时不会误判成达标
        </div>
      </div>

      {/* 目标技能 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          目标技能 <span className="text-text-muted text-[11px]">(宠物学会这个技能就换下一只;留空 = 不用这个判据)</span>
        </label>
        <input
          type="text"
          value={value.targetSkill ?? ''}
          onChange={(e) => patch({ targetSkill: e.target.value })}
          placeholder="留空 = 只按等级判断"
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
        />
        <div className="text-[10px] text-text-muted mt-1">
          在宠物面板里识别到这个技能名就算学会。两个判据是「或」的关系(等级够 或 学会技能 就换下一只)
          <br />
          ⚠️ 宠物技能名的识别区域还没实测(core/constant-ocr/pet.ts 的 PET_SKILL_ROI 是空的),填了技能也不会生效,
          只会按等级判断(运行日志里会提示一次)
        </div>
      </div>

      {/* 说明 */}
      <div className="text-[10px] text-text-muted bg-bg-input/40 border border-border-base rounded p-2.5">
        宠物栏用游戏快捷键 Alt+P 开关(见 shared/game-hotkeys.ts 的 openPetPanel)。
        <br />
        看谁在出战:在列表区域找字 —— 醒 = 已出战,睡 = 睡眠;换宠 = 双击列表里下一只(双击睡眠的那只让它出战)。全是睡眠就先唤醒第 1 只。
        <br />
        列表识别区域 / 颜色 / 找字字串都在 core/constant-ocr/pet.ts:1280*800 是实测值,1600*900 还没实测(缺档位时运行日志会提示并跳过)
      </div>
    </div>
  );
}
