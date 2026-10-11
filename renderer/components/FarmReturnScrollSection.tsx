// 回城卷轴配置分组(farm 表单里的一段)
//
// 数据面:写进 FarmTaskConfig.returnScroll;worker 侧见
//   electron/workers/game-worker/resupply/town-departure.ts 的 returnViaScroll
//   + tasks/farm.ts 的 crossMapsOnStartup(起点不认识时才按)
//
// 触发时机:任务启动时角色既不在挂机图、也不在过图链路上、也不在出发城镇 →
//   按一次回城卷轴(物品栏快捷栏位)→ 回到某个主城 → 再坐飞空艇中转/去挂机图。
// 正常起点(已在挂机图/链路/出发城镇)不会消耗卷轴。

import type { FarmReturnScrollConfig } from '../../shared/types';

/** 新建 farm 任务时的默认值(关闭) */
export const DEFAULT_RETURN_SCROLL: FarmReturnScrollConfig = { enabled: false };

/** 回填:旧配置没有 returnScroll 字段 → 默认关闭 */
export function normalizeReturnScroll(raw?: FarmReturnScrollConfig | null): FarmReturnScrollConfig {
  return {
    enabled: raw?.enabled === true,
    skillId: raw?.skillId || undefined,
    timeoutMs: typeof raw?.timeoutMs === 'number' && raw.timeoutMs >= 1000 ? Math.round(raw.timeoutMs) : undefined,
  };
}

/** 可选的物品技能(来自「技能设置」里 method='item' 且启用的条目) */
export interface ItemSkillOption {
  id: string;
  key: string;
  name?: string;
}

export interface FarmReturnScrollSectionProps {
  readOnly?: boolean;
  value: FarmReturnScrollConfig;
  onChange: (next: FarmReturnScrollConfig) => void;
  /** 可选的物品技能(物品栏快捷栏位) */
  itemSkills: ItemSkillOption[];
}

export function FarmReturnScrollSection(props: FarmReturnScrollSectionProps) {
  const { readOnly = false, value, onChange, itemSkills } = props;
  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';
  const enabled = value.enabled === true;
  const patch = (p: Partial<FarmReturnScrollConfig>) => onChange({ ...value, ...p });
  const skillLabel = (s: ItemSkillOption): string => `${s.key}${s.name ? `·${s.name}` : ''}`;

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        回城卷轴 <span className="text-text-muted text-[11px]">(起点在野外/任意地图时,先按卷轴回主城再前往挂机图)</span>
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
          <span>开启回城卷轴</span>
          <span className="text-text-muted text-[10px]">只在起点既不认识、也不是出发城镇时按一次(正常起点不消耗)</span>
        </label>

        {enabled && (
          <>
            {itemSkills.length === 0 ? (
              <div className="text-[11px] text-accent-yellow/80">
                还没有「物品技能」:先在上方「技能设置」里添加技能,把施法方式改成「物品」,再回来选回城卷轴
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary shrink-0 w-16">卷轴键位</span>
                <select
                  value={value.skillId ?? ''}
                  onChange={(e) => patch({ skillId: e.target.value || undefined })}
                  disabled={readOnly}
                  className={`w-48 bg-bg-card border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan ${disabledCls}`}
                  title="物品栏里回城卷轴所在的快捷栏位"
                >
                  <option value="">(请选择物品技能)</option>
                  {itemSkills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {skillLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary shrink-0 w-16">回城超时</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={value.timeoutMs ?? 60000}
                onChange={(e) => patch({ timeoutMs: parseInt(e.target.value) || 60000 })}
                disabled={readOnly}
                className={`w-24 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                title="按下卷轴后等切图的超时(毫秒)"
              />
              <span className="text-text-muted text-[10px]">ms(回城加载较慢时可调大)</span>
            </div>

            {itemSkills.length > 0 && !value.skillId && (
              <div className="text-[10px] text-accent-yellow/80">开启回城卷轴必须选一个物品技能,否则无法保存</div>
            )}
            <div className="text-[10px] text-text-muted">
              回城后落在哪张主城要读地图名判断:落点正是出发城镇 → 直接按城镇出口/NPC 传送前进; 落在别的主城 →
              需要在「城镇档案」里配一条「其它主城中转」(该主城飞空艇 → 出发城镇)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
