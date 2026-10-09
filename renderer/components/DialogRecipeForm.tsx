// 对话配方编辑器(dialog-recipe 任务的 config 表单)
//
// 数据面:DialogRecipeConfig(见 shared/types.ts)= npcKind + steps[]
// worker 侧(resupply-runner → runDialogRecipe)按 npcKind='item-merchant' 取这份配方,
// 逐步执行 steps:点对话选项 / 点坐标 / 按键 / 等待 / 输入文字 / 条件分支 / 关闭对话
//
// 注意:if-text 的 thenId / elseId 引用同一份配方里其它步骤的 id(下拉里选,不用手填)

import { Plus, Trash2, ArrowUp, ArrowDown, MessageSquare } from '../icons';
import type { DialogRecipeConfig, DialogStep } from '../../shared/types';

/** 步骤类型下拉的可选值(顺序 = 说明文案的顺序) */
const STEP_KIND_OPTIONS: { value: DialogStep['kind']; label: string }[] = [
  { value: 'click-text', label: '点对话选项' },
  { value: 'click-at', label: '点坐标' },
  { value: 'key', label: '按键' },
  { value: 'wait', label: '等待' },
  { value: 'input-text', label: '输入文字' },
  { value: 'if-text', label: '条件分支' },
  { value: 'close-dialog', label: '关闭对话' },
];

/** 生成一条新步骤的唯一 id(沿用 TaskConfigDialog 里 waypoint/skill 的写法) */
function makeStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 造一个该类型的步骤(切换类型时用):
 * 保留两边都有的 text(点选项 / 输入文字 / 条件分支的文字最容易被误切换时丢掉),其余取该类型的默认值
 */
function makeStep(kind: DialogStep['kind'], id: string, prev?: DialogStep): DialogStep {
  const text = prev && 'text' in prev ? prev.text : '';
  switch (kind) {
    case 'click-text':
      return { id, kind, text, offsetY: 0, onMissing: 'skip' };
    case 'click-at':
      return { id, kind, x: 0, y: 0 };
    case 'key':
      return { id, kind, key: 'Enter' };
    case 'wait':
      return { id, kind, ms: 500 };
    case 'input-text':
      return { id, kind, text };
    case 'if-text':
      return { id, kind, text, thenId: undefined, elseId: undefined };
    case 'close-dialog':
      return { id, kind };
  }
}

/** 步骤在"跳转目标"下拉里的短标签 */
function stepLabel(step: DialogStep, index: number): string {
  const kindLabel = STEP_KIND_OPTIONS.find((o) => o.value === step.kind)?.label ?? step.kind;
  const text = 'text' in step && step.text ? `「${step.text.slice(0, 8)}」` : '';
  return `#${index + 1} ${kindLabel}${text}`;
}

export interface DialogRecipeFormProps {
  readOnly?: boolean;
  /** 受控值 */
  value: DialogRecipeConfig;
  /** 每次编辑回传整份配置 */
  onChange: (next: DialogRecipeConfig) => void;
}

const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

export function DialogRecipeForm(props: DialogRecipeFormProps) {
  const { readOnly = false, value, onChange } = props;
  const steps = value.steps ?? [];

  const patch = (p: Partial<DialogRecipeConfig>) => onChange({ ...value, ...p });
  const setSteps = (next: DialogStep[]) => patch({ steps: next });
  const patchStep = (id: string, p: Partial<DialogStep>) => setSteps(steps.map((s) => (s.id === id ? ({ ...s, ...p } as DialogStep) : s)));

  const addStep = () => setSteps([...steps, makeStep('click-text', makeStepId())]);
  const removeStep = (id: string) => setSteps(steps.filter((s) => s.id !== id));

  const moveStep = (id: string, dir: -1 | 1) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    const next = [...steps];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setSteps(next);
  };

  /** 跳转目标下拉(if-text 用):引用其它步骤的 id */
  const renderJumpSelect = (cur: string | undefined, onPick: (v: string | undefined) => void, selfId: string) => {
    const options = steps.map((s, i) => ({ id: s.id, label: stepLabel(s, i) })).filter((o) => o.id !== selfId);
    const known = cur === undefined || cur === '' || options.some((o) => o.id === cur);
    return (
      <select
        value={cur ?? ''}
        onChange={(e) => onPick(e.target.value || undefined)}
        disabled={readOnly}
        className={`bg-bg-card border rounded px-1.5 py-0.5 text-xs outline-none ${known ? 'border-border-base' : 'border-accent-red'} ${disabledCls}`}
        title={known ? '跳转到的步骤' : `引用的步骤 id「${cur}」不存在(可能已被删除)`}
      >
        <option value="">(不跳转,顺序往下)</option>
        {!known && <option value={cur}>{cur} (不存在)</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="space-y-5">
      {/* 顶部说明 */}
      <div className="rounded border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-[12px] text-text-secondary space-y-1">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-accent-cyan" />
          <span className="font-medium text-text-primary">对话配方</span>
          <span className="text-text-muted text-[11px]">(与某类 NPC 对话时的步骤脚本,按顺序执行)</span>
        </div>
        <div className="text-text-muted text-[11px]">
          死亡回城补给时,worker 从全部配方里取 npcKind =「item-merchant」的那份执行(修理装备 / 买药)。 对话窗口每开一次跑一遍 steps。
        </div>
      </div>

      {/* NPC 类型 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          NPC 类型 npcKind <span className="text-text-muted text-[11px]">(要和城镇档案里 NPC 的 kind 对上)</span>
        </label>
        <input
          type="text"
          value={value.npcKind ?? ''}
          onChange={(e) => patch({ npcKind: e.target.value })}
          placeholder="item-merchant"
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono ${disabledCls}`}
        />
        <div className="text-[10px] text-text-muted mt-1">道具商人填 item-merchant(当前补给流程只认它)</div>
      </div>

      {/* 步骤列表 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            步骤列表 <span className="text-text-muted text-[11px]">(按顺序执行;至少 1 步才能保存)</span>
          </label>
          {!readOnly && (
            <button onClick={addStep} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加步骤
            </button>
          )}
        </div>

        {steps.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无步骤,点"添加步骤"开始编排
          </div>
        ) : (
          <div className="space-y-1.5">
            {steps.map((step, i) => (
              <div key={step.id} className="bg-bg-input p-1.5 rounded space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                  <select
                    value={step.kind}
                    onChange={(e) => {
                      const kind = e.target.value as DialogStep['kind'];
                      setSteps(steps.map((s) => (s.id === step.id ? makeStep(kind, s.id, s) : s)));
                    }}
                    disabled={readOnly}
                    className={`w-28 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                    title="步骤类型"
                  >
                    {STEP_KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  {/* ---- 各类型自己的字段 ---- */}
                  {step.kind === 'click-text' && (
                    <>
                      <input
                        type="text"
                        value={step.text}
                        onChange={(e) => patchStep(step.id, { text: e.target.value })}
                        disabled={readOnly}
                        placeholder="要点中的选项文字(含即可)"
                        className={`w-44 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">纵向偏移</span>
                      <input
                        type="number"
                        value={step.offsetY ?? 0}
                        onChange={(e) => patchStep(step.id, { offsetY: parseInt(e.target.value) || 0 })}
                        disabled={readOnly}
                        className={`w-16 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                        title="点击位置的纵向偏移(像素;0 = 点在文字上),点不中时往下调"
                      />
                      <select
                        value={step.onMissing}
                        onChange={(e) => patchStep(step.id, { onMissing: e.target.value as 'skip' | 'fail' })}
                        disabled={readOnly}
                        className={`w-28 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                        title="选项找不到时:跳过这一步 / 判定失败"
                      >
                        <option value="skip">找不到就跳过</option>
                        <option value="fail">找不到就失败</option>
                      </select>
                    </>
                  )}

                  {step.kind === 'click-at' && (
                    <>
                      <span className="text-text-muted text-[10px]">X</span>
                      <input
                        type="number"
                        value={step.x}
                        onChange={(e) => patchStep(step.id, { x: parseInt(e.target.value) || 0 })}
                        disabled={readOnly}
                        className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">Y</span>
                      <input
                        type="number"
                        value={step.y}
                        onChange={(e) => patchStep(step.id, { y: parseInt(e.target.value) || 0 })}
                        disabled={readOnly}
                        className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                      />
                      <input
                        type="text"
                        value={step.note ?? ''}
                        onChange={(e) => patchStep(step.id, { note: e.target.value })}
                        disabled={readOnly}
                        placeholder="备注(这个坐标是什么)"
                        className={`flex-1 min-w-0 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      />
                    </>
                  )}

                  {step.kind === 'key' && (
                    <>
                      <input
                        type="text"
                        value={step.key}
                        onChange={(e) => patchStep(step.id, { key: e.target.value })}
                        disabled={readOnly}
                        placeholder="Enter / Esc / F1"
                        className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">键名,如 Enter / Esc / F1</span>
                    </>
                  )}

                  {step.kind === 'wait' && (
                    <>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={step.ms}
                        onChange={(e) => patchStep(step.id, { ms: Math.max(0, parseInt(e.target.value) || 0) })}
                        disabled={readOnly}
                        className={`w-24 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">ms(等对话/动画出现)</span>
                    </>
                  )}

                  {step.kind === 'input-text' && (
                    <>
                      <input
                        type="text"
                        value={step.text}
                        onChange={(e) => patchStep(step.id, { text: e.target.value })}
                        disabled={readOnly}
                        placeholder="要输入的文字(如购买数量)"
                        className={`w-56 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">输入前请先配一个"点坐标"选中输入框</span>
                    </>
                  )}

                  {step.kind === 'if-text' && (
                    <>
                      <input
                        type="text"
                        value={step.text}
                        onChange={(e) => patchStep(step.id, { text: e.target.value })}
                        disabled={readOnly}
                        placeholder="对话里出现的文字(含即可)"
                        className={`w-44 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                      />
                      <span className="text-text-muted text-[10px]">命中 →</span>
                      {renderJumpSelect(step.thenId, (v) => patchStep(step.id, { thenId: v }), step.id)}
                      <span className="text-text-muted text-[10px]">否则 →</span>
                      {renderJumpSelect(step.elseId, (v) => patchStep(step.id, { elseId: v }), step.id)}
                    </>
                  )}

                  {step.kind === 'close-dialog' && <span className="text-text-muted text-[10px]">关闭对话窗口(结束时记得加一个)</span>}

                  <div className="flex-1" />
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => moveStep(step.id, -1)}
                        disabled={i === 0}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                        title="上移"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveStep(step.id, 1)}
                        disabled={i === steps.length - 1}
                        className="text-text-muted hover:text-text-primary disabled:opacity-30"
                        title="下移"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => removeStep(step.id)} className="text-accent-red/70 hover:text-accent-red" title="删除该步骤">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
                <div className="text-[10px] text-text-muted pl-7">
                  id <span className="font-mono text-accent-cyan/80">{step.id}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 类型说明 */}
      <div className="text-[10px] text-text-muted space-y-0.5">
        <div>· 点对话选项:在对话窗口里找含指定文字的条目并点击(找不到按「跳过 / 失败」处理)</div>
        <div>· 点坐标:直接点窗口客户区坐标(如某个固定位置的按钮)</div>
        <div>· 条件分支:对话窗口里含指定文字就跳到「命中」的步骤,否则跳「否则」的步骤;都不选 = 顺序往下</div>
        <div>· 条件分支的跳转目标引用的是其它步骤的 id(上面下拉里按 #序号 选),删除步骤后引用会失效(下拉会标红提示)</div>
        <div>· 配方跑完 / 中途失败,worker 都会兜底关一次对话窗口</div>
      </div>
    </div>
  );
}
