// 死亡回城补给配置分组(farm 表单里的一段)
//
// 数据面:写进 FarmTaskConfig.resupply;启动 farm 时由 renderer 解析成 auxConfigs 下发
// (见 renderer/aux-configs.ts:城镇档案整份下发 + 全部对话配方 + 挂机地图中文名)
//
// 两个触发器(同一段流程,见 worker 的 resupply-runner):
//   死亡       = enabled 开启就生效(死亡后复活 → 补给 → 回野外)
//   任务启动   = runOnStart 勾上才生效(不复活,直接补给 → 前往挂机地图;已在挂机图则跳过)
//
// worker 侧约定(见 electron/workers/game-worker/resupply/):
//   - 城镇档案里要有 kind='item-merchant' 的 NPC
//   - auxConfigs.recipes 里要有 npcKind='item-merchant' 的对话配方
//   两者缺一个,补给流程跑到商人那一步就会失败(这里只提示,不硬拦保存)

import type { FarmResupplyConfig, FarmReviveMode } from '../../shared/types';

/** 新建 farm 任务时的默认值(与 worker 的兜底默认保持一致:立即复活 / 180s / 查耐久 / 不跑开工补给) */
export const DEFAULT_RESUPPLY: FarmResupplyConfig = {
  enabled: false,
  townProfileName: '',
  reviveMode: 'immediate',
  reviveTimeoutMs: 180_000,
  checkDurability: true,
  runOnStart: false,
};

/**
 * 复活方式迁移:只认三种新值,其余(含旧配置的 'auto' / 'manual' 与未配)一律回退 immediate。
 * 与 worker 的 resupply-runner.normalizeReviveMode 保持同一套规则。
 */
function normalizeReviveMode(raw: unknown): FarmReviveMode {
  return raw === 'huihun' || raw === 'tishen' || raw === 'immediate' ? raw : 'immediate';
}

/** 回填:旧配置没有 resupply 字段 → 用默认值;字段缺失按默认值补齐(与 worker 的 resolveResupplyConfig 对齐) */
export function normalizeResupply(raw?: FarmResupplyConfig | null): FarmResupplyConfig {
  return {
    enabled: raw?.enabled === true,
    townProfileName: String(raw?.townProfileName ?? ''),
    reviveMode: normalizeReviveMode(raw?.reviveMode),
    reviveTimeoutMs: typeof raw?.reviveTimeoutMs === 'number' && raw.reviveTimeoutMs >= 1000 ? Math.round(raw.reviveTimeoutMs) : 180_000,
    checkDurability: raw?.checkDurability !== false,
    potionThreshold: typeof raw?.potionThreshold === 'number' && raw.potionThreshold > 0 ? Math.round(raw.potionThreshold) : undefined,
    // 旧配置没有这个字段 = 不开工补给(保持升级前的行为)
    runOnStart: raw?.runOnStart === true,
  };
}

export interface FarmResupplySectionProps {
  readOnly?: boolean;
  value: FarmResupplyConfig;
  onChange: (next: FarmResupplyConfig) => void;
  /** 可选的城镇档案名(来源:store.taskHistory 里 taskType==='town-profile' 的项,按 name 显示/取值) */
  townProfileNames: string[];
  /** 是否已存在 npcKind='item-merchant' 的对话配方(没有时给黄色提示) */
  hasMerchantRecipe: boolean;
}

export function FarmResupplySection(props: FarmResupplySectionProps) {
  const { readOnly = false, value, onChange, townProfileNames, hasMerchantRecipe } = props;
  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

  const patch = (p: Partial<FarmResupplyConfig>) => onChange({ ...value, ...p });
  const enabled = value.enabled === true;
  const missingProfile = enabled && !String(value.townProfileName ?? '').trim();

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        死亡回城补给{' '}
        <span className="text-text-muted text-[11px]">(死亡后自动复活 / 开工前先跑一遍 → 检查耐久/药水 → 回城找商人 → 返回野外)</span>
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
          <span>开启死亡回城补给</span>
          <span className="text-text-muted text-[10px]">关掉 = 死亡后按原逻辑直接结束任务</span>
        </label>

        {enabled && (
          <>
            {/* 城镇档案:从已保存的 town-profile 里按名字选 */}
            <div>
              <div className="text-xs text-text-secondary mb-1">
                城镇档案 <span className="text-text-muted text-[10px]">(城镇地图名 / 复活点 / 商人 / 出城口 + 路线)</span>
              </div>
              {townProfileNames.length === 0 ? (
                <div className="text-[11px] text-accent-yellow/80">
                  还没有保存过城镇档案:先在「创建任务」里选「城镇档案」配好并保存,这里才能选到
                </div>
              ) : (
                <select
                  value={value.townProfileName ?? ''}
                  onChange={(e) => patch({ townProfileName: e.target.value })}
                  disabled={readOnly}
                  className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
                >
                  <option value="">(请选择城镇档案)</option>
                  {townProfileNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              {missingProfile && <div className="text-[10px] text-accent-yellow/80 mt-1">开启补给必须选一份城镇档案,否则无法启动</div>}
            </div>

            {/* 第二个触发器:任务启动时也跑一遍同一条补给流程(见 worker 的 runStartupResupply) */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent-cyan"
                  disabled={readOnly}
                  checked={value.runOnStart === true}
                  onChange={(e) => patch({ runOnStart: e.target.checked })}
                />
                <span>开工前先补给一次(买药/修装备)再前往挂机点</span>
              </label>
              <div className="text-[10px] text-text-muted pl-5">
                勾上后:每次启动任务先进这段流程,到达挂机地图才开始循环打怪(死亡回城照旧)。
                起点按城镇档案里的「复活点」理解;若启动时角色已经在挂机地图,整段自动跳过
              </div>
            </div>

            {/* 复活方式(死亡弹框上的三个按钮;点击坐标见 core/constant-ocr/death.ts 的 REVIVE_BUTTON_POS) */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-text-secondary">复活方式</span>
              {(
                [
                  { value: 'immediate', label: '立即复活' },
                  { value: 'huihun', label: '回魂娃娃' },
                  { value: 'tishen', label: '替身娃娃' },
                ] as { value: FarmResupplyConfig['reviveMode']; label: string }[]
              ).map((o) => (
                <label key={o.value} className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                  <input
                    type="radio"
                    name="farm-revive-mode"
                    className="accent-accent-cyan"
                    disabled={readOnly}
                    checked={(value.reviveMode ?? 'immediate') === o.value}
                    onChange={() => patch({ reviveMode: o.value })}
                  />
                  <span className={(value.reviveMode ?? 'immediate') === o.value ? 'text-text-primary' : 'text-text-secondary'}>
                    {o.label}
                  </span>
                </label>
              ))}
            </div>

            {/* 复活超时 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary shrink-0">复活超时</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={value.reviveTimeoutMs ?? 180_000}
                onChange={(e) => patch({ reviveTimeoutMs: parseInt(e.target.value) || 180_000 })}
                disabled={readOnly}
                className={`w-24 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                title="等复活的超时时间(毫秒);超时按异常处理"
              />
              <span className="text-text-muted text-[10px]">ms(超时按异常处理)</span>
            </div>

            {/* 检查项 */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent-cyan"
                  disabled={readOnly}
                  checked={value.checkDurability === true}
                  onChange={(e) => patch({ checkDurability: e.target.checked })}
                />
                <span>检查装备耐久</span>
                <span className="text-text-muted text-[10px]">开角色面板看装备耐久,见底才去商人修理</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary shrink-0">红药购买阈值</span>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={value.potionThreshold ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    patch({ potionThreshold: v === '' ? undefined : Math.max(0, parseInt(v) || 0) });
                  }}
                  disabled={readOnly}
                  placeholder="留空 = 不检查"
                  className={`w-28 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                  title="红药数量少于该值就去买;留空 = 不检查药水"
                />
                <span className="text-text-muted text-[10px]">个(留空 = 不检查药水)</span>
              </div>
            </div>

            {/* 依赖提示:worker 只认道具商人的 NPC 与配方 */}
            <div className={`text-[10px] ${hasMerchantRecipe ? 'text-text-muted' : 'text-accent-yellow/80'}`}>
              {hasMerchantRecipe ? '' : '⚠ 还没有 npcKind=「item-merchant」的对话配方,补给到商人那一步会失败;'}
              需要城镇档案里存在 kind=「item-merchant」的 NPC,且历史任务里存在 npcKind=「item-merchant」的对话配方
              <br />
              耐久与药水都没问题时会跳过商人直接返程;两份配置缺一样都会在补给途中报错并结束任务
              <br />
              开工补给失败(如启动时角色既不在城镇也不在挂机地图)同样会结束任务,不会带着错误的起点继续挂机
            </div>
          </>
        )}
      </div>
    </div>
  );
}
