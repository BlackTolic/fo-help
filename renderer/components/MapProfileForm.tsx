// 过图路线编辑器(map-profile 任务的 config 表单)
//
// 数据面:MapProfileConfig(见 shared/types.ts)= 本图地图名 + 入口口子 + 出口口子 + 途经点(单方向)
// farm 的「地图跨越」按名字引用它,worker 用 core/navigation/MapCrossing 逐跳穿越:
//   去程 = 入口 → 出口(正向走途经点);返程 = 出口 → 入口(反向走)
// 途经点分两种:「添加途经点」= 只路过;「添加NPC」= 到这个点先和 NPC 对话(跑完配方)再走下一个点。

import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2, MapPin } from '../icons';
import type { MapProfileConfig, MapProfilePortal, MapProfileWaypoint } from '../../shared/types';
import { npcSelectOptions } from '../../shared/npc';
import { useStore } from '../store/useStore';

export interface MapProfileFormProps {
  readOnly?: boolean;
  /** 受控值 */
  value: MapProfileConfig;
  /** 每次编辑回传整份配置 */
  onChange: (next: MapProfileConfig) => void;
  /**
   * 已 bootstrap 的游戏窗口句柄:传了才显示「采集当前坐标」按钮
   * (点击后把 worker 读到的 {map,x,y} 填进"当前聚焦的坐标字段")
   */
  hwnd?: number;
  /** 可选的对话配方名(来源:历史任务里 taskType==='dialog-recipe' 的项);途经点 NPC 用它指名要执行的配方 */
  recipeNames: string[];
}

const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

/** 配方下拉选项:全部配方名;当前值不在列表里时补在末尾(旧数据 / 已删配方不静默丢掉) */
function recipeOptions(current: string | undefined, available: string[]): string[] {
  const v = (current ?? '').trim();
  return v && !available.includes(v) ? [...available, v] : [...available];
}

/** 坐标输入对(X / Y) */
interface XyFieldProps {
  x: number;
  y: number;
  readOnly: boolean;
  /** 聚焦时告诉上层"现在编辑的是这个坐标字段"(采集当前坐标的落点) */
  onFocus?: () => void;
  onX: (v: number) => void;
  onY: (v: number) => void;
}

function XyField({ x, y, readOnly, onFocus, onX, onY }: XyFieldProps) {
  return (
    <>
      <span className="text-text-muted text-[10px]">X</span>
      <input
        type="number"
        value={x}
        onFocus={onFocus}
        onChange={(e) => onX(parseInt(e.target.value) || 0)}
        disabled={readOnly}
        className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
      />
      <span className="text-text-muted text-[10px]">Y</span>
      <input
        type="number"
        value={y}
        onFocus={onFocus}
        onChange={(e) => onY(parseInt(e.target.value) || 0)}
        disabled={readOnly}
        className={`w-20 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
      />
    </>
  );
}

export function MapProfileForm(props: MapProfileFormProps) {
  const { readOnly = false, value, onChange, hwnd, recipeNames } = props;
  const readWorkerPosition = useStore((s) => s.readWorkerPosition);

  const entrance: MapProfilePortal = value.entrance ?? { position: { x: 0, y: 0 }, toMap: '' };
  const exit: MapProfilePortal = value.exit ?? { position: { x: 0, y: 0 }, toMap: '' };
  const waypoints = value.waypoints ?? [];

  /** 当前聚焦的坐标字段(采集当前坐标填这里);null = 还没点过任何坐标框 → 填入口口子 */
  const [activeXy, setActiveXy] = useState<{ key: string; label: string } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const patch = (p: Partial<MapProfileConfig>) => onChange({ ...value, ...p });

  const patchPortal = (which: 'entrance' | 'exit', p: Partial<MapProfilePortal>) => {
    const cur = which === 'entrance' ? entrance : exit;
    patch({ [which]: { ...cur, ...p } } as Partial<MapProfileConfig>);
  };

  /** 普通途经点:只路过,不带 NPC */
  const addWaypoint = () => patch({ waypoints: [...waypoints, { x: 0, y: 0 }] });
  /** NPC 途经点:到这个点先对话再继续(点「添加NPC」才加这种) */
  const addNpcWaypoint = () => patch({ waypoints: [...waypoints, { x: 0, y: 0, npc: { name: '', recipeName: '' } }] });
  const removeWaypoint = (i: number) => patch({ waypoints: waypoints.filter((_, j) => j !== i) });
  const setWaypoint = (i: number, p: Partial<MapProfileWaypoint>) =>
    patch({ waypoints: waypoints.map((w, j) => (j === i ? { ...w, ...p } : w)) });
  const moveWaypoint = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= waypoints.length) return;
    const next = [...waypoints];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ waypoints: next });
  };
  /** 设置 NPC 名字(保留已选配方);清空名字也保留 npc 字段,由校验提示补选 */
  const setWaypointNpcName = (i: number, name: string) => {
    const cur = waypoints[i]?.npc;
    setWaypoint(i, { npc: { name, recipeName: cur?.recipeName ?? '' } });
  };

  // ---- 采集当前坐标 ----
  const applyCollected = (key: string, x: number, y: number) => {
    if (key === 'entrance') {
      patchPortal('entrance', { position: { x, y } });
      return;
    }
    if (key === 'exit') {
      patchPortal('exit', { position: { x, y } });
      return;
    }
    if (key.startsWith('wp:')) {
      setWaypoint(parseInt(key.slice(3)) || 0, { x, y });
    }
  };

  const collectPosition = async () => {
    if (!hwnd || collecting) return;
    setCollecting(true);
    setCollectError(null);
    try {
      const res = await readWorkerPosition(hwnd);
      if (res.error) {
        setCollectError(res.error);
        return;
      }
      const key = activeXy?.key ?? 'entrance';
      applyCollected(key, res.x, res.y);
      // 地图名一并采集:本图地图名必须和游戏里 OCR 读到的名字一致
      if (res.map) patch({ mapName: res.map });
    } finally {
      setCollecting(false);
    }
  };

  const collectTargetLabel = activeXy ? activeXy.label : '入口口子';

  return (
    <div className="space-y-5">
      {/* 顶部说明 + 采集当前坐标 */}
      <div className="rounded border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-[12px] text-text-secondary space-y-2">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-accent-cyan" />
          <span className="font-medium text-text-primary">过图路线</span>
          <span className="text-text-muted text-[11px]">(坐标都是游戏内地图坐标;只支持"从入口到出口一条道"的图)</span>
        </div>
        <div className="text-text-muted text-[11px]">
          录好本图从「入口」到「出口」的途经点后,挂机打怪的「地图跨越」里按顺序选中它:
          去程按入口→出口走,返程(死亡回城后)按反向走。出口/入口的 toMap 要填对(穿过去会到哪张图)。 「添加NPC」加的途经点走到后先和 NPC
          对话(跑完配方),才会继续走下一个点。
        </div>
        {hwnd !== undefined && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void collectPosition()}
              disabled={readOnly || collecting}
              className="text-xs btn btn-secondary flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
              title={`读取游戏当前坐标并填入:${collectTargetLabel}(点一下要填的坐标框再点这里)`}
            >
              {collecting ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
              {collecting ? '读取中...' : `采集当前坐标 → ${collectTargetLabel}`}
            </button>
            <span className="text-text-muted text-[10px]">
              先把角色走到目标位置 → 点一下要填的坐标框(X 或 Y)→ 再点这个按钮(同时会填本图地图名)
            </span>
          </div>
        )}
        {collectError && <div className="text-[11px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">读取坐标失败:{collectError}</div>}
      </div>

      {/* 本图地图名 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          本图地图名 <span className="text-text-muted text-[11px]">(游戏内 OCR 读到的中文名,要和它完全一致)</span>
        </label>
        <input
          type="text"
          value={value.mapName ?? ''}
          onChange={(e) => patch({ mapName: e.target.value })}
          placeholder="如:芳草林"
          disabled={readOnly}
          className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
        />
      </div>

      {/* 入口 / 出口 */}
      <div className="grid grid-cols-1 gap-3">
        {(
          [
            {
              which: 'entrance' as const,
              label: '入口口子',
              hint: '从上一张图过图后落到这里;返程从这里走出去',
              portal: entrance,
              placeholder: '填上一张图名(如:龙城)',
            },
            {
              which: 'exit' as const,
              label: '出口口子',
              hint: '去下一张图时踩这里;返程从这里进入本图',
              portal: exit,
              placeholder: '填下一张图名(链尾填挂机地图名)',
            },
          ] as const
        ).map((row) => (
          <div key={row.which} className="rounded border border-border-base bg-bg-input/40 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary shrink-0 w-20">{row.label}</span>
              <input
                type="text"
                value={row.portal.toMap ?? ''}
                onChange={(e) => patchPortal(row.which, { toMap: e.target.value })}
                placeholder={row.placeholder}
                disabled={readOnly}
                title="穿过这个口子会到达的图(游戏内中文地图名)"
                className={`w-56 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
              />
              <XyField
                x={row.portal.position?.x ?? 0}
                y={row.portal.position?.y ?? 0}
                readOnly={readOnly}
                onFocus={() => setActiveXy({ key: row.which, label: row.label })}
                onX={(v) => patchPortal(row.which, { position: { x: v, y: row.portal.position?.y ?? 0 } })}
                onY={(v) => patchPortal(row.which, { position: { x: row.portal.position?.x ?? 0, y: v } })}
              />
            </div>
            <div className="text-[10px] text-text-muted pl-20">{row.hint}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-text-muted -mt-2">
        采集坐标时只能读到"当前所在图"的名字,所以 toMap(穿过去到哪张图)采不到,要手输或过图后再核对
      </div>

      {/* 途经点 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            途经点 <span className="text-text-muted text-[11px]">(入口 → 出口,按顺序)</span>
          </label>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <button onClick={addNpcWaypoint} className="text-xs btn btn-secondary flex items-center gap-1">
                <Plus size={12} />
                添加NPC
              </button>
              <button onClick={addWaypoint} className="text-xs btn btn-secondary flex items-center gap-1">
                <Plus size={12} />
                添加途经点
              </button>
            </div>
          )}
        </div>

        {waypoints.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            没有途经点 = 直接从入口走到出口(有地形/走廊挡路时再配中间点)
          </div>
        ) : (
          <div className="space-y-1.5">
            {waypoints.map((wp, i) => (
              <div key={i} className="bg-bg-input p-1.5 rounded space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                  {wp.npc && <span className="text-[10px] text-accent-cyan shrink-0">NPC</span>}
                  <XyField
                    x={wp.x}
                    y={wp.y}
                    readOnly={readOnly}
                    onFocus={() => setActiveXy({ key: `wp:${i}`, label: `途经点 ${i + 1}` })}
                    onX={(v) => setWaypoint(i, { x: v })}
                    onY={(v) => setWaypoint(i, { y: v })}
                  />
                  <div className="flex-1" />
                  {!readOnly && (
                    <>
                      <button onClick={() => moveWaypoint(i, -1)} className="text-text-muted hover:text-text-primary" title="上移">
                        <ArrowUp size={12} />
                      </button>
                      <button onClick={() => moveWaypoint(i, 1)} className="text-text-muted hover:text-text-primary" title="下移">
                        <ArrowDown size={12} />
                      </button>
                      <button onClick={() => removeWaypoint(i)} className="text-accent-red/70 hover:text-accent-red" title="删除该途经点">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>

                {/* 只有「添加NPC」加的途经点才有这一行:到这个点先对话,配方跑完才走下一个点 */}
                {wp.npc && (
                  <div className="flex items-center gap-1.5 flex-wrap pl-7">
                    <span className="text-text-muted text-[10px]">NPC</span>
                    <select
                      value={wp.npc.name ?? ''}
                      onChange={(e) => setWaypointNpcName(i, e.target.value)}
                      disabled={readOnly}
                      title="到这个点时先和这个 NPC 对话"
                      className={`w-32 bg-bg-card border rounded px-1.5 py-0.5 text-xs outline-none ${
                        (wp.npc.name ?? '').trim() ? 'border-border-base' : 'border-accent-yellow/60'
                      } ${disabledCls}`}
                    >
                      <option value="">(请选择 NPC)</option>
                      {npcSelectOptions(wp.npc.name).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="text-text-muted text-[10px]">配方</span>
                    <select
                      value={wp.npc.recipeName ?? ''}
                      onChange={(e) => setWaypoint(i, { npc: { name: wp.npc!.name, recipeName: e.target.value } })}
                      disabled={readOnly}
                      title="与这个 NPC 对话时执行哪份对话配方"
                      className={`w-44 bg-bg-card border rounded px-1.5 py-0.5 text-xs outline-none ${
                        (wp.npc.recipeName ?? '').trim() ? 'border-border-base' : 'border-accent-yellow/60'
                      } ${disabledCls}`}
                    >
                      <option value="">(选对话配方)</option>
                      {recipeOptions(wp.npc.recipeName, recipeNames).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    {!readOnly && (
                      <button
                        onClick={() => setWaypoint(i, { npc: undefined })}
                        className="text-[10px] text-text-muted hover:text-accent-red"
                        title="移除这个 NPC(变回普通途经点)"
                      >
                        移除 NPC
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          「添加途经点」= 只路过;「添加NPC」= 到这个点先开对话跑配方,成功才继续下一个点(去程与返程都会触发)
        </div>
      </div>
    </div>
  );
}
