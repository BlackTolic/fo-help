// 挂机辅助配置勾选段(farm 表单里的一段)
//
// 数据面:写进 FarmTaskConfig.auxConfigNames(辅助配置的任务名,勾选顺序 = 执行顺序)
// 启动 farm 时由 renderer 解析成 auxConfigs.auxList 下发(见 renderer/aux-configs.ts)
// worker 侧见 electron/workers/game-worker/farm-aux.ts:按每份配置自己的触发点在挂机流程里执行
//
// 与「地图跨越」的区别:那边是有序的走图链路,这边是"勾哪些辅助配置",所以用勾选框而不是下拉+上下移

export interface FarmAuxOption {
  /** 辅助配置的任务名(引用键) */
  name: string;
  /** 这个配置做什么(一行摘要,显示在勾选框后面) */
  desc: string;
}

export interface FarmAuxSectionProps {
  readOnly?: boolean;
  /** 勾选的辅助配置任务名(顺序 = 执行顺序) */
  value: string[];
  onChange: (next: string[]) => void;
  /** 可勾选的辅助配置(来源:store.taskHistory 里的辅助配置型任务) */
  options: FarmAuxOption[];
}

export function FarmAuxSection(props: FarmAuxSectionProps) {
  const { readOnly = false, value, onChange, options } = props;
  const list = value ?? [];
  const known = options.map((o) => o.name);
  const unknown = [...new Set(list.filter((n) => n && !known.includes(n)))];

  const toggle = (name: string, on: boolean) => onChange(on ? [...list, name] : list.filter((n) => n !== name));

  return (
    <div>
      <label className="text-sm text-text-secondary mb-1.5 block">
        辅助配置 <span className="text-text-muted text-[11px]">(勾选要启用的;可多选,按勾选顺序执行)</span>
      </label>
      <div className="space-y-2 bg-bg-input/40 border border-border-base rounded p-2.5">
        <div className="text-[10px] text-text-muted">
          每份辅助配置自己挑触发点(回城后重新进入 / 进入挂机地图 / 进入第一个挂机点 / 每轮打怪结束), 到那些时机由 worker
          依次执行(如「宠物带练」)。
        </div>

        {options.length === 0 ? (
          <div className="text-center py-3 text-text-muted text-xs border border-dashed border-border-base rounded">
            还没有辅助配置:先在「创建任务」里配一份(如「宠物带练」)并保存,这里才能勾选
          </div>
        ) : (
          <div className="space-y-1.5">
            {options.map((o) => {
              const checked = list.includes(o.name);
              return (
                <label key={o.name} className="flex items-start gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent-cyan mt-0.5"
                    disabled={readOnly}
                    checked={checked}
                    onChange={(e) => toggle(o.name, e.target.checked)}
                  />
                  <span>
                    {o.name}
                    {o.desc && <span className="text-text-muted text-[10px] ml-1">{o.desc}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className={`text-[10px] ${unknown.length > 0 ? 'text-accent-red' : 'text-text-muted'}`}>
          {unknown.length > 0
            ? `勾选的辅助配置不存在:${unknown.join('、')}(可能已删除,请重新勾选);启动任务前会被拦下`
            : list.length === 0
              ? '一份都不勾 = 不执行任何辅助配置(行为与旧配置一致)'
              : `已勾选 ${list.length} 份,按上面的勾选顺序执行`}
        </div>
      </div>
    </div>
  );
}
