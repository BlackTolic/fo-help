// 宠物技能配置分组(farm 表单里的一段)
//
// 数据面:写进 FarmTaskConfig.petRide;worker 侧见 electron/workers/game-worker/pet-ride.ts
//   宠物骑乘:回城补给回到城里 → 检查宠物激活 → 释放「上骑」(最多 3 次、间隔 1s,检测骑乘提示字样)
//             挂机主循环到达挂机点 → 释放一次「下骑」后才开始打怪
//   打怪前开启宠物技能:到达挂机点先释放一次这个宠物技能再打怪(与骑乘开关无关;刚下骑则隔 1s 再放)。
//     它是状态技能,开一次就一直有,所以每圈只在第一个到达的挂机点放一次。
//
// 三者都从「技能设置」里 method='pet'(宠物技能)的条目里选,可以是同一个按键;
// 骑乘依赖回城补给/开工补给回到城里的时机,没开补给时不会触发上骑。

import type { FarmPetRideConfig } from '../../shared/types';

/** 新建 farm 任务时的宠物技能默认值(均关闭) */
export const DEFAULT_PET_RIDE: FarmPetRideConfig = { enabled: false, preFarmSkillEnabled: false };

/** 回填:旧配置没有 petRide 字段 → 默认关闭 */
export function normalizePetRide(raw?: FarmPetRideConfig | null): FarmPetRideConfig {
  return {
    enabled: raw?.enabled === true,
    mountSkillId: raw?.mountSkillId || undefined,
    dismountSkillId: raw?.dismountSkillId || undefined,
    preFarmSkillEnabled: raw?.preFarmSkillEnabled === true,
    preFarmSkillId: raw?.preFarmSkillId || undefined,
  };
}

/** 可选的宠物技能(来自「技能设置」里 method='pet' 且启用的条目) */
export interface PetSkillOption {
  id: string;
  key: string;
  name?: string;
}

export interface FarmPetRideSectionProps {
  readOnly?: boolean;
  value: FarmPetRideConfig;
  onChange: (next: FarmPetRideConfig) => void;
  /** 可选的宠物技能(供上骑 / 下骑 / 打怪前开启宠物技能选择) */
  petSkills: PetSkillOption[];
}

export function FarmPetRideSection(props: FarmPetRideSectionProps) {
  const { readOnly = false, value, onChange, petSkills } = props;
  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';
  const enabled = value.enabled === true;
  const preFarmEnabled = value.preFarmSkillEnabled === true;
  const patch = (p: Partial<FarmPetRideConfig>) => onChange({ ...value, ...p });

  const skillLabel = (s: PetSkillOption): string => `${s.key}${s.name ? `·${s.name}` : ''}`;

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        宠物技能{' '}
        <span className="text-text-muted text-[11px]">(宠物骑乘:回城后上骑、到挂机点下骑;打怪前开启宠物技能:到达挂机点先放一次)</span>
      </label>
      <div className="space-y-2.5 bg-bg-input/40 border border-border-base rounded p-2.5">
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent-cyan"
            disabled={readOnly}
            checked={enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>开启宠物骑乘</span>
          <span className="text-text-muted text-[10px]">回到城里自动上骑(骑着回挂机图),到挂机点自动下骑再打怪</span>
        </label>

        {enabled && (
          <>
            {petSkills.length === 0 ? (
              <div className="text-[11px] text-accent-yellow/80">
                还没有「宠物技能」:先在上方「技能设置」里添加技能,把施法方式改成「宠物技能」,再回来选上骑/下骑
              </div>
            ) : (
              <div className="space-y-2">
                {/* 上骑:回城后释放 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0 w-10">上骑</span>
                  <select
                    value={value.mountSkillId ?? ''}
                    onChange={(e) => patch({ mountSkillId: e.target.value || undefined })}
                    disabled={readOnly}
                    className={`w-48 bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan ${disabledCls}`}
                    title="回到城里要释放的宠物技能"
                  >
                    <option value="">(请选择宠物技能)</option>
                    {petSkills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {skillLabel(s)}
                      </option>
                    ))}
                  </select>
                  <span className="text-text-muted text-[10px]">回到城里检查宠物激活后释放(最多 3 次,间隔 1s,检测骑乘提示)</span>
                </div>

                {/* 下骑:到挂机点释放;可与上骑同键 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0 w-10">下骑</span>
                  <select
                    value={value.dismountSkillId ?? ''}
                    onChange={(e) => patch({ dismountSkillId: e.target.value || undefined })}
                    disabled={readOnly}
                    className={`w-48 bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan ${disabledCls}`}
                    title="到达挂机点要释放的宠物技能"
                  >
                    <option value="">(请选择宠物技能)</option>
                    {petSkills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {skillLabel(s)}
                      </option>
                    ))}
                  </select>
                  <span className="text-text-muted text-[10px]">到达挂机点立即释放一次,然后再开始打怪(可与上骑同一按键)</span>
                </div>
              </div>
            )}

            {(!value.mountSkillId || !value.dismountSkillId) && petSkills.length > 0 && (
              <div className="text-[10px] text-accent-yellow/80">上骑、下骑都要选,否则无法保存</div>
            )}
            <div className="text-[10px] text-text-muted">
              上骑 3 次后仍未出现骑乘提示(飞毛腿来啦 / 骑驴看唱板儿)= 当前宠物不可骑乘或已睡眠,只记日志不中断任务; 没开「城市事件 /
              开工前处理」时角色不会回城,骑乘不会触发
            </div>
          </>
        )}

        {/* 打怪前开启宠物技能:每到挂机点先释放一次(与上面的骑乘开关互不影响) */}
        <div className="pt-2.5 border-t border-border-base space-y-2">
          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={preFarmEnabled}
              onChange={(e) => patch({ preFarmSkillEnabled: e.target.checked })}
            />
            <span>打怪前开启宠物技能</span>
            <span className="text-text-muted text-[10px]">
              到达挂机点先释放一次再打怪(状态技能,开一次就一直有,每圈只放一次;与「宠物骑乘」互不影响,先下骑则隔 1S 再放)
            </span>
          </label>

          {preFarmEnabled &&
            (petSkills.length === 0 ? (
              <div className="text-[11px] text-accent-yellow/80">
                还没有「宠物技能」:先在上方「技能设置」里添加技能,把施法方式改成「宠物技能」,再回来选
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary shrink-0 w-10">技能</span>
                <select
                  value={value.preFarmSkillId ?? ''}
                  onChange={(e) => patch({ preFarmSkillId: e.target.value || undefined })}
                  disabled={readOnly}
                  className={`w-48 bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan ${disabledCls}`}
                  title="到达挂机点、开始打怪前要释放的宠物技能"
                >
                  <option value="">(请选择宠物技能)</option>
                  {petSkills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {skillLabel(s)}
                    </option>
                  ))}
                </select>
                <span className="text-text-muted text-[10px]">每圈只在第一个挂机点释放一次;没选技能无法保存</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
