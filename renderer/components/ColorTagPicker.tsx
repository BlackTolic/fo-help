// 颜色多选控件(tag 标签 + 自定义色值),怪名颜色 / 拾取颜色 / 清怪颜色共用

import { useState } from 'react';
import { X, Plus } from '../icons';

export interface ColorTagPickerProps {
  /** 预设颜色标签 */
  options: { value: string; label: string }[];
  /** 已选颜色(大漠颜色描述符) */
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
}

/**
 * 颜色多选(tag 标签 + 自定义色值)
 * 值是「主色-偏色」格式的大漠颜色描述符(见 core/constant-ocr/color.ts);
 * 不在预设里的值(旧配置 / 自定义)也渲染成标签,可以单独删掉。
 * 怪名颜色与物品拾取颜色共用这一个控件,只是传入的预设列表不同。
 */
export function ColorTagPicker({ options, value, onChange, readOnly = false }: ColorTagPickerProps) {
  const [custom, setCustom] = useState('');

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const addCustom = () => {
    const v = custom.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setCustom('');
  };
  const extras = value.filter((v) => !options.some((o) => o.value === v));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              title={o.value}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                checked
                  ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                  : 'border-border-base text-text-secondary hover:border-border-active cursor-pointer'
              } ${readOnly ? 'cursor-default' : ''}`}
            >
              <input
                type="checkbox"
                className="accent-accent-cyan"
                disabled={readOnly}
                checked={checked}
                onChange={() => toggle(o.value)}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
        {extras.map((v) => (
          <span
            key={v}
            title={v}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan text-[11px] font-mono"
          >
            {v}
            {!readOnly && (
              <button onClick={() => onChange(value.filter((x) => x !== v))} title="移除" className="hover:text-accent-red">
                <X size={10} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCustom();
            }}
            placeholder="自定义色值(主色-偏色,如 e85048-111111)"
            className="w-64 bg-bg-input border border-border-base rounded px-2 py-1 text-xs outline-none focus:border-accent-cyan font-mono"
          />
          <button onClick={addCustom} className="text-xs btn btn-secondary flex items-center gap-1">
            <Plus size={12} />
            添加
          </button>
        </div>
      )}
    </div>
  );
}
