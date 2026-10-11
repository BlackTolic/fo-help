// 地图跨越配置分组(farm 表单里的一段)
//
// 数据面:写进 FarmTaskConfig.mapCrossings(过图路线任务名,按顺序;不含出发城镇、不含挂机图)
// 启动 farm 时由 renderer 解析成 auxConfigs.mapProfiles 下发
// (见 renderer/aux-configs.ts:按顺序取档案 + 链路连通性校验)
// worker 侧见 core/navigation/MapCrossing.ts:逐跳 travelToExit 穿越,去程/返程自动判方向

import { Plus, Trash2, ArrowUp, ArrowDown } from '../icons';

export interface MapCrossingsSectionProps {
  readOnly?: boolean;
  /** 中间地图的过图路线名,按穿越顺序 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 可选的过图路线名(来源:store.taskHistory 里 taskType==='map-profile' 的项) */
  mapProfileNames: string[];
}

export function MapCrossingsSection(props: MapCrossingsSectionProps) {
  const { readOnly = false, value, onChange, mapProfileNames } = props;
  const list = value ?? [];
  const unknown = [...new Set(list.filter((n) => n && !mapProfileNames.includes(n)))];

  const add = () => onChange([...list, '']);
  const removeAt = (i: number) => onChange(list.filter((_, j) => j !== i));
  const setAt = (i: number, v: string) => onChange(list.map((x, j) => (j === i ? v : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        地图跨越 <span className="text-text-muted text-[11px]">(出发图 → 挂机图之间要依次穿越的中间地图,按顺序;不含城镇、不含挂机图)</span>
      </label>
      <div className="space-y-2 bg-bg-input/40 border border-border-base rounded p-2.5">
        <div className="text-[10px] text-text-muted">
          顺序 = 穿越顺序。城镇 → 第一张图由「城镇档案」的出口负责,挂机图内由「入图点」负责;
          中途每张图走完自动过图,最后进入挂机图。死亡回城后按同一条链路原路返回(自动反向)。
        </div>

        {list.length === 0 ? (
          <div className="text-center py-3 text-text-muted text-xs border border-dashed border-border-base rounded">
            不跨图(直接在当前图挂机;或从城镇/挂机图启动)
          </div>
        ) : (
          <div className="space-y-1.5">
            {list.map((name, i) => {
              const missing = name && !mapProfileNames.includes(name);
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                  <select
                    value={name}
                    onChange={(e) => setAt(i, e.target.value)}
                    disabled={readOnly}
                    className={`flex-1 bg-bg-card border rounded px-2 py-1 text-xs outline-none ${
                      missing ? 'border-accent-red' : 'border-border-base'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                    title={missing ? `引用的过图路线「${name}」不存在(可能已被删除)` : '选择一张过图路线'}
                  >
                    <option value="">(请选择过图路线)</option>
                    {missing && <option value={name}>{name} (不存在)</option>}
                    {mapProfileNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {!readOnly && (
                    <>
                      <button onClick={() => move(i, -1)} className="text-text-muted hover:text-text-primary" title="上移(提前穿越)">
                        <ArrowUp size={12} />
                      </button>
                      <button onClick={() => move(i, 1)} className="text-text-muted hover:text-text-primary" title="下移(推后穿越)">
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => removeAt(i)} className="text-accent-red/70 hover:text-accent-red" title="删除该跳">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!readOnly && (
          <button onClick={add} className="text-xs btn btn-secondary flex items-center gap-1">
            <Plus size={12} />
            添加一跳
          </button>
        )}

        <div className={`text-[10px] ${unknown.length > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
          {unknown.length > 0
            ? `引用的过图路线不存在:${unknown.join('、')}(可能已删除,请重新选择);启动任务前会被拦下`
            : mapProfileNames.length === 0
              ? '还没有保存过「过图路线」:先在「创建任务」里选「过图路线」配好并保存,这里才能选到'
              : '引用的过图路线会在启动前校验:出口 toMap 必须和下一张图(链尾是挂机地图)一致'}
        </div>
      </div>
    </div>
  );
}
