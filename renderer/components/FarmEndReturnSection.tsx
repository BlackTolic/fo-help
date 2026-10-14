// 条件回城配置分组(farm 表单里的一段),界面叫「结束自动打怪并回城」
//
// 数据面:写进 FarmTaskConfig.endReturn;两种回城方式(回城卷轴 / 小退)worker 侧都已实现。
//
// 语义:满足条件(「完成 N 圈」/「背包已满」,任一命中即可)后结束本轮打怪 → 回城 →
//   按落点走城市逻辑(城镇档案:检查/按需访问商人/出城)或跨境逻辑(过图链路逐跳) →
//   回到挂机图继续下一轮打怪(不结束整个任务),圈数计数每轮回城后归零重新计。
//
// 回城卷轴方式复用「回城卷轴」里配的物品技能(见 FarmReturnScrollConfig.skillId):
//   会被攻击打断,所以按一次后只观察地图名是否变化,没变就重按,次数与间隔由这里配。
// 小退方式:先清掉周围的怪(被攻击时小退不会成功),再 Alt+O → 点「选择角色」→ 再上线。
//   清怪默认用本任务的找怪识别参数(「定点识别」那份),也可以在界面上单独配一份(relogin.mobFilter):
//   只写用户改过的项,留空的项沿用「定点识别」的对应项(worker 侧同语义,见 relogin.ts)。

import type {
  FarmEndReturnConfig,
  FarmEndReturnMethod,
  FarmEndReturnReloginConfig,
  FarmEndReturnScrollConfig,
  FarmTaskConfig,
  ScreenRect,
} from '../../shared/types';
import { ColorTagPicker } from './ColorTagPicker';

/** 新建 farm 任务时的默认值(关闭;与 shared/types.ts 里的兜底默认一致) */
export const DEFAULT_END_RETURN: FarmEndReturnConfig = {
  enabled: false,
  loops: 1,
  method: 'scroll',
  scroll: { maxAttempts: 5, pressIntervalMs: 4000 },
};

/**
 * 小退回城的默认参数:界面上没存过时显示这些。
 * worker 侧同一份默认值见 electron/workers/game-worker/relogin.ts 的 resolveReloginConfig
 * (clearMobs 只有显式 false 才关闭,清怪总超时 120s,最多尝试 3 次)。
 */
const DEFAULT_RELOGIN = { clearMobs: true, clearTimeoutMs: 120_000, maxAttempts: 3 };

/** 回城方式迁移:只认两种值,其余(含未配)一律回退 scroll */
function normalizeMethod(raw: unknown): FarmEndReturnMethod {
  return raw === 'relogin' ? 'relogin' : 'scroll';
}

/** 数字字段取值:非数字用兜底值,再四舍五入取整并夹到 [min, max] */
function normalizeInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 界面管的三项(其余字段界面不写,有值就整份留着,别把手写的配置抹掉) */
const CLEAR_MOB_FILTER_KEYS = ['ocrRange', 'nameColors', 'nameKeywords'];

/**
 * 清怪识别参数是不是「全留空」:界面管的三项(范围 / 颜色 / 名字)都没配 = 留空
 * = 沿用本任务「定点识别」的该项(worker 侧同语义),不值当写进配置。
 */
function isClearMobFilterEmpty(mf: Partial<FarmTaskConfig['mobFilter']>): boolean {
  const r = mf.ocrRange;
  const rangeEmpty = !r || [r.x, r.y, r.w, r.h].every((v) => (v | 0) === 0);
  const keywords = (mf.nameKeywords ?? []).map((s) => s.trim()).filter(Boolean);
  if (!rangeEmpty || (mf.nameColors ?? []).length > 0 || keywords.length > 0) return false;
  return Object.entries(mf).every(([k, v]) => v === undefined || CLEAR_MOB_FILTER_KEYS.includes(k));
}

/**
 * 落盘前清洗清怪识别参数:关键字去掉空段(空关键字在 worker 侧会命中任意怪名),
 * 三项都留空就整份不写。
 * ⚠️ 只在保存时滤空段:界面按逗号串编辑,写回 state 时留着空段才能继续往后打第二个名字。
 */
function normalizeClearMobFilter(raw?: Partial<FarmTaskConfig['mobFilter']>): Partial<FarmTaskConfig['mobFilter']> | undefined {
  if (!raw) return undefined;
  const next: Partial<FarmTaskConfig['mobFilter']> = { ...raw };
  const keywords = (next.nameKeywords ?? []).map((s) => s.trim()).filter(Boolean);
  if (keywords.length > 0) next.nameKeywords = keywords;
  else delete next.nameKeywords;
  if (next.nameColors && next.nameColors.length === 0) delete next.nameColors;
  const r = next.ocrRange;
  if (r && [r.x, r.y, r.w, r.h].every((v) => (v | 0) === 0)) delete next.ocrRange;
  return isClearMobFilterEmpty(next) ? undefined : next;
}

/**
 * 回填:旧配置没有 endReturn 字段 → 用默认值;字段缺失/非法按上面的规则补齐与夹取。
 * overloaded 与 relogin 都原样留着(relogin 里的字段只写用户改过的,缺的由 worker/界面各自的默认值兜底),
 * 免得把用户已存的值抹掉;只有清怪识别参数里的空段要滤掉。
 */
export function normalizeEndReturn(raw?: FarmEndReturnConfig | null): FarmEndReturnConfig {
  return {
    enabled: raw?.enabled === true,
    loops: normalizeInt(raw?.loops, 1, Number.MAX_SAFE_INTEGER, 1),
    overloaded: raw?.overloaded === true ? true : undefined,
    method: normalizeMethod(raw?.method),
    scroll: {
      maxAttempts: normalizeInt(raw?.scroll?.maxAttempts, 1, 20, 5),
      pressIntervalMs: normalizeInt(raw?.scroll?.pressIntervalMs, 1000, 60000, 4000),
    },
    relogin: raw?.relogin ? { ...raw.relogin, mobFilter: normalizeClearMobFilter(raw.relogin.mobFilter) } : undefined,
  };
}

interface Props {
  readOnly?: boolean;
  value: FarmEndReturnConfig;
  onChange: (next: FarmEndReturnConfig) => void;
  /** 「回城卷轴」里没配有效物品技能时的问题;空 = 没问题。只提示,保存时另有一条硬校验 */
  returnScrollIssue?: string | null;
  /** 颜色预设(来自 TaskConfigDialog 的 MONSTER_COLOR_OPTIONS) */
  colorOptions: { value: string; label: string }[];
  /** 本任务「定点识别」的当前值(给"按当前定点识别填一份"按钮与留空提示用) */
  farmMobFilter: { ocrRange: ScreenRect; nameColors: string[]; nameKeywords: string };
}

export function FarmEndReturnSection(props: Props) {
  const { readOnly = false, value, onChange, returnScrollIssue = null, colorOptions, farmMobFilter } = props;
  const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';
  const enabled = value.enabled === true;
  const method = value.method ?? 'scroll';
  const patch = (p: Partial<FarmEndReturnConfig>) => onChange({ ...value, ...p });
  const patchScroll = (p: Partial<FarmEndReturnScrollConfig>) =>
    onChange({ ...value, scroll: { ...DEFAULT_END_RETURN.scroll, ...value.scroll, ...p } });
  // 小退参数:存过的字段优先,没存过的用默认值显示;只写用户改过的那几项
  const patchRelogin = (p: Partial<FarmEndReturnReloginConfig>) =>
    onChange({ ...value, relogin: { ...DEFAULT_RELOGIN, ...value.relogin, ...p } });
  const relogin = { ...DEFAULT_RELOGIN, ...value.relogin };
  // 清怪识别参数:没配的项用界面上「空」的样子显示(全 0 的范围 / 不选颜色 / 空关键字)
  const clearMobFilter = value.relogin?.mobFilter ?? {};
  const clearRange = clearMobFilter.ocrRange ?? { x: 0, y: 0, w: 0, h: 0 };
  const clearColors = clearMobFilter.nameColors ?? [];
  const clearKeywords = (clearMobFilter.nameKeywords ?? []).join(',');
  /** 改清怪识别参数:三项全留空就不写 mobFilter(留空 = 沿用「定点识别」的对应项) */
  const patchClearMobFilter = (p: Partial<FarmTaskConfig['mobFilter']>) => {
    const merged: Partial<FarmTaskConfig['mobFilter']> = { ...clearMobFilter, ...p };
    patchRelogin({ mobFilter: isClearMobFilterEmpty(merged) ? undefined : merged });
  };

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        结束自动打怪并回城{' '}
        <span className="text-text-muted text-[11px]">
          (达到条件后结束本轮打怪 → 回城按落点走城镇/过图逻辑 → 回到挂机图继续下一轮打怪,整个任务不结束)
        </span>
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
          <span>达到条件后停止打怪并回城</span>
          <span className="text-text-muted text-[10px]">不勾 = 一直挂在挂机图打怪</span>
        </label>

        {enabled && (
          <>
            {/* 触发条件:两个条件各勾各的,任一命中就回城 */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary shrink-0">完成</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={value.loops ?? 1}
                  onChange={(e) => patch({ loops: Math.max(1, Math.round(parseInt(e.target.value) || 1)) })}
                  disabled={readOnly}
                  className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                  title="打完多少圈后回城一次"
                />
                <span className="text-xs text-text-secondary shrink-0">圈后回城</span>
              </div>
              <div className="text-[10px] text-text-muted">1 = 每打完一圈就回城一次</div>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent-cyan"
                  disabled={readOnly}
                  checked={value.overloaded === true}
                  onChange={(e) => patch({ overloaded: e.target.checked ? true : undefined })}
                />
                <span>背包已满(放不下东西)时回城</span>
                <span className="text-text-muted text-[10px]">聊天框出现「背包里放不下这件物品 / 背包里装备已装满」即触发</span>
              </label>
            </div>

            {/* 回城方式(二选一) */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-text-secondary">回城方式</span>
              <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                <input
                  type="radio"
                  name="farm-end-return-method"
                  className="accent-accent-cyan"
                  disabled={readOnly}
                  checked={method === 'scroll'}
                  onChange={() => patch({ method: 'scroll' })}
                />
                <span className={method === 'scroll' ? 'text-text-primary' : 'text-text-secondary'}>使用回城卷轴</span>
              </label>
              <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                <input
                  type="radio"
                  name="farm-end-return-method"
                  className="accent-accent-cyan"
                  disabled={readOnly}
                  checked={method === 'relogin'}
                  onChange={() => patch({ method: 'relogin' })}
                />
                <span className={method === 'relogin' ? 'text-text-primary' : 'text-text-secondary'}>小退回城</span>
                <span className="text-text-muted text-[10px]">Alt+O → 选择角色 → 再上线</span>
              </label>
            </div>

            {method === 'relogin' && (
              <>
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent-cyan"
                    disabled={readOnly}
                    checked={relogin.clearMobs !== false}
                    onChange={(e) => patchRelogin({ clearMobs: e.target.checked })}
                  />
                  <span>小退前先清掉周围的怪</span>
                  <span className="text-text-muted text-[10px]">被攻击时小退不会成功(识别参数见下方,可单独配)</span>
                </label>

                {relogin.clearMobs !== false && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary shrink-0">清怪最多</span>
                      <input
                        type="number"
                        min={10}
                        max={600}
                        step={10}
                        value={Math.round(relogin.clearTimeoutMs / 1000)}
                        onChange={(e) => patchRelogin({ clearTimeoutMs: Math.max(10, parseInt(e.target.value) || 120) * 1000 })}
                        disabled={readOnly}
                        className={`w-16 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                        title="清怪的总超时(秒):怪会刷新,清不完就按失败处理"
                      />
                      <span className="text-xs text-text-secondary shrink-0">秒(超时按失败处理)</span>
                    </div>

                    {/* 清怪识别参数:三项都可以留空,留空 = 沿用本任务「定点识别」的该项(worker 侧同语义) */}
                    <div className="space-y-2 bg-bg-input/40 border border-border-base rounded p-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-text-secondary">清怪识别参数</span>
                        <span className="text-text-muted text-[10px]">
                          (独立设置,不与「定点识别」共享;留空的项 = 沿用「定点识别」的该项)
                        </span>
                        <button
                          onClick={() =>
                            patchClearMobFilter({
                              ocrRange: { ...farmMobFilter.ocrRange },
                              nameColors: [...farmMobFilter.nameColors],
                              nameKeywords: farmMobFilter.nameKeywords
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          disabled={readOnly}
                          className={`text-[11px] btn btn-secondary ${disabledCls}`}
                          title="把本任务「定点识别」的范围/颜色/名字复制进来,再在这基础上改"
                        >
                          按当前「定点识别」填一份
                        </button>
                      </div>

                      <div>
                        <div className="text-[11px] text-text-secondary mb-1">
                          识别范围{' '}
                          <span className="text-text-muted text-[10px]">
                            (窗口客户区坐标 x / y / 宽 / 高;宽高留 0 = 沿用「定点识别」的范围)
                          </span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {(
                            [
                              ['x', 'X'],
                              ['y', 'Y'],
                              ['w', '宽 W'],
                              ['h', '高 H'],
                            ] as [keyof ScreenRect, string][]
                          ).map(([key, label]) => (
                            <div key={key} className="flex items-center gap-1">
                              <span className="text-text-muted text-[10px] shrink-0">{label}</span>
                              <input
                                type="number"
                                min={0}
                                value={clearRange[key]}
                                onChange={(e) =>
                                  patchClearMobFilter({ ocrRange: { ...clearRange, [key]: Math.max(0, parseInt(e.target.value) || 0) } })
                                }
                                disabled={readOnly}
                                className={`w-20 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] text-text-secondary mb-1">
                          怪物颜色 <span className="text-text-muted text-[10px]">(可多选;不选 = 沿用「定点识别」的颜色)</span>
                        </div>
                        <ColorTagPicker
                          options={colorOptions}
                          value={clearColors}
                          onChange={(v) => patchClearMobFilter({ nameColors: v })}
                          readOnly={readOnly}
                        />
                      </div>

                      <div>
                        <div className="text-[11px] text-text-secondary mb-1">
                          怪物名称 <span className="text-text-muted text-[10px]">(可选,逗号分隔;留空 = 沿用「定点识别」的关键字)</span>
                        </div>
                        {/* 空段先留在 state 里(见 normalizeClearMobFilter),保存时才滤掉 —— 否则逗号打不出第二个名字 */}
                        <input
                          type="text"
                          value={clearKeywords}
                          onChange={(e) =>
                            patchClearMobFilter({
                              nameKeywords: e.target.value.split(',').map((s) => s.trim()),
                            })
                          }
                          placeholder="留空 = 沿用「定点识别」的找怪关键字"
                          disabled={readOnly}
                          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
                        />
                      </div>

                      <div className="text-[10px] text-text-muted">
                        三项都留空 = 清怪直接用「定点识别」那份参数;范围越小识别越快,名字/颜色填得越具体越不容易打错怪
                      </div>
                    </div>
                  </>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0">小退最多尝试</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={relogin.maxAttempts}
                    onChange={(e) => patchRelogin({ maxAttempts: Math.min(10, Math.max(1, parseInt(e.target.value) || 3)) })}
                    disabled={readOnly}
                    className={`w-16 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                    title="小退失败后重试几次;全失败就结束任务并弹提醒"
                  />
                  <span className="text-xs text-text-secondary shrink-0">次</span>
                </div>

                <div className="text-[10px] text-text-muted">
                  小退 = Alt+O 打开系统菜单 → 点「选择角色」→ 等进入选择角色界面 → 停留 3 秒 → 按 Enter 重新上线
                  <br />
                  上线后落在哪张图由「回城补给」的城镇逻辑接管(回挂机图与小退前一致);检测区域只有实测过的那几档分辨率
                </div>
              </>
            )}

            {method === 'scroll' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0">每次按下后等待</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={Math.round((value.scroll?.pressIntervalMs ?? 4000) / 1000)}
                    onChange={(e) => patchScroll({ pressIntervalMs: Math.max(1, parseInt(e.target.value) || 4) * 1000 })}
                    disabled={readOnly}
                    className={`w-16 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                    title="按下后观察地图名是否变化的窗口(秒);没变就再按一次"
                  />
                  <span className="text-xs text-text-secondary shrink-0">秒观察是否回城</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary shrink-0">最多尝试</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    value={value.scroll?.maxAttempts ?? 5}
                    onChange={(e) => patchScroll({ maxAttempts: Math.max(1, parseInt(e.target.value) || 5) })}
                    disabled={readOnly}
                    className={`w-16 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none font-mono ${disabledCls}`}
                    title="最多按几次;次数用完还没回城就按异常处理"
                  />
                  <span className="text-xs text-text-secondary shrink-0">次</span>
                </div>

                <div className={`text-[10px] ${returnScrollIssue ? 'text-accent-yellow/80' : 'text-text-muted'}`}>
                  {returnScrollIssue ? `⚠ ${returnScrollIssue};` : ''}
                  用「回城卷轴」里配的物品技能回城:被攻击时卷轴可能不生效,所以会等一小会儿再自动重按
                  <br />
                  回城后落在哪张地图要读地图名判断:出发城镇/链路 → 直接继续;其它主城 → 按城镇档案的「其它主城中转」走
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
