// 城镇档案编辑器(town-profile 任务的 config 表单)
//
// 数据面:TownProfileConfig(见 shared/types.ts)= 城镇地图名 + 复活点 + NPC 列表 + 锚点间路线 + 出城口 + 其它主城中转
// 这份配置由 farm 的「回城补给」/「地图跨越」整份下发(auxConfigs.townProfile),worker 用它:
//   复活点确认城镇 → 按路线走到道具商人 → 按路线走到出口(走过去 / 与传送 NPC 对话)→ 切回挂机图
//   回城卷轴落在别的主城时,再用「其它主城中转」里的飞空艇 NPC 传送回本城镇
//
// 锚点 id 约定(worker 侧 resolveRoute 用):'revive' = 复活点、各 npc.id、各 exit.id

import { useState } from 'react';
import { Plus, Trash2, Loader2, MapPin } from '../icons';
import type { TownProfileConfig, TownProfileExit, TownProfileNpc, TownProfileRoute, TownTransitCity } from '../../shared/types';
import { NPC, normalizeNpcName, npcSelectOptions } from '../../shared/npc';
import { useStore } from '../store/useStore';

/** 复活点锚点 id(与 electron/workers/game-worker/resupply/resupply-runner.ts 的 REVIVE_ANCHOR 一致) */
const REVIVE_ANCHOR = 'revive';

/** 采集当前坐标时,未聚焦任何坐标字段的兜底目标 = 复活点 */
const REVIVE_XY_KEY = 'revive';

export interface TownProfileFormProps {
  readOnly?: boolean;
  /** 受控值 */
  value: TownProfileConfig;
  /** 每次编辑回传整份配置 */
  onChange: (next: TownProfileConfig) => void;
  /**
   * 已 bootstrap 的游戏窗口句柄:传了才显示「采集当前坐标」按钮
   * (点击后把 worker 读到的 {map,x,y} 填进"当前聚焦的坐标字段")
   */
  hwnd?: number;
  /** 可选的对话配方名(来源:历史任务里 taskType==='dialog-recipe' 的项);NPC 用它指名要执行的配方 */
  recipeNames: string[];
}

const disabledCls = 'disabled:opacity-60 disabled:cursor-not-allowed';

/** 生成一条新记录的唯一 id(沿用 TaskConfigDialog 里 waypoint/skill 的写法) */
function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 配方下拉选项:全部配方名;当前值不在列表里时补在末尾(旧数据 / 已删配方不静默丢掉) */
function npcRecipeOptions(current: string | undefined, available: string[]): string[] {
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

export function TownProfileForm(props: TownProfileFormProps) {
  const { readOnly = false, value, onChange, hwnd, recipeNames } = props;
  const readWorkerPosition = useStore((s) => s.readWorkerPosition);

  const npcs = value.npcs ?? [];
  const routes = value.routes ?? [];
  const exits = value.exits ?? [];
  const transitFrom = value.transitFrom ?? [];
  const revivePoint = value.revivePoint ?? { x: 0, y: 0 };

  /** 当前聚焦的坐标字段(采集当前坐标填这里);null = 还没点过任何坐标框 → 填复活点 */
  const [activeXy, setActiveXy] = useState<{ key: string; label: string } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const patch = (p: Partial<TownProfileConfig>) => onChange({ ...value, ...p });

  // ---- NPC ----
  const addNpc = () =>
    patch({
      npcs: [...npcs, { id: makeId('npc'), name: NPC.ITEM_MERCHANT, position: { x: 0, y: 0 } } satisfies TownProfileNpc],
    });
  const removeNpc = (id: string) => patch({ npcs: npcs.filter((n) => n.id !== id) });
  const patchNpc = (id: string, p: Partial<TownProfileNpc>) => patch({ npcs: npcs.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  /** 改 id 时把"当前聚焦的坐标字段"一起改名,否则采集当前坐标会往一个不存在的 id 上写(静默失效) */
  const renameNpcId = (oldId: string, newId: string) => {
    setActiveXy((cur) => (cur?.key === `npc:${oldId}` ? { key: `npc:${newId}`, label: cur.label } : cur));
    patchNpc(oldId, { id: newId });
  };

  // ---- 出城口 ----
  const addExit = () => patch({ exits: [...exits, { id: makeId('exit'), toMap: '', position: { x: 0, y: 0 } } satisfies TownProfileExit] });
  const removeExit = (id: string) => patch({ exits: exits.filter((e) => e.id !== id) });
  const patchExit = (id: string, p: Partial<TownProfileExit>) => patch({ exits: exits.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const renameExitId = (oldId: string, newId: string) => {
    setActiveXy((cur) => (cur?.key === `exit:${oldId}` ? { key: `exit:${newId}`, label: cur.label } : cur));
    patchExit(oldId, { id: newId });
  };

  // ---- 其它主城中转(回城卷轴落在别的主城时,在该主城坐飞空艇回本城镇) ----
  const addTransit = () =>
    patch({
      transitFrom: [
        ...transitFrom,
        {
          id: makeId('transit'),
          mapName: '',
          npcName: NPC.AIRSHIP_FAIRY,
          position: { x: 0, y: 0 },
          recipeName: '',
          waypoints: [],
        } satisfies TownTransitCity,
      ],
    });
  const removeTransit = (id: string) => patch({ transitFrom: transitFrom.filter((t) => t.id !== id) });
  const patchTransit = (id: string, p: Partial<TownTransitCity>) =>
    patch({ transitFrom: transitFrom.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  /** 改 id 时把"当前聚焦的坐标字段"一起改名,否则采集当前坐标会往一个不存在的 id 上写(静默失效) */
  const renameTransitId = (oldId: string, newId: string) => {
    setActiveXy((cur) => (cur?.key === `transit:${oldId}` ? { key: `transit:${newId}`, label: cur.label } : cur));
    patchTransit(oldId, { id: newId });
  };

  // ---- 路线 ----
  const addRoute = () => patch({ routes: [...routes, { id: makeId('route'), from: REVIVE_ANCHOR, to: '', waypoints: [] }] });
  const removeRoute = (id: string) => patch({ routes: routes.filter((r) => r.id !== id) });
  const patchRoute = (id: string, p: Partial<TownProfileRoute>) => patch({ routes: routes.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRouteWaypoint = (id: string) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    patchRoute(id, { waypoints: [...(route.waypoints ?? []), { x: 0, y: 0 }] });
  };
  const removeRouteWaypoint = (id: string, idx: number) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    patchRoute(id, { waypoints: (route.waypoints ?? []).filter((_, i) => i !== idx) });
  };
  const setRouteWaypoint = (id: string, idx: number, p: { x?: number; y?: number }) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    patchRoute(id, { waypoints: (route.waypoints ?? []).map((w, i) => (i === idx ? { ...w, ...p } : w)) });
  };

  /** 锚点下拉的可选值:'revive' + 各 NPC + 各出口 */
  const anchorOptions: { value: string; label: string }[] = [
    { value: REVIVE_ANCHOR, label: '复活点' },
    ...npcs.map((n) => ({ value: n.id, label: `NPC ${n.name || n.id}` })),
    ...exits.map((e) => ({ value: e.id, label: `出口 ${e.toMap || e.id}` })),
  ];

  /** 锚点下拉:当前值不在选项里(手改过 id / 引用已删的锚点)时补一条,避免静默变成第一项 */
  const renderAnchorSelect = (cur: string, onPick: (v: string) => void) => {
    const known = anchorOptions.some((o) => o.value === cur);
    return (
      <select
        value={cur}
        onChange={(e) => onPick(e.target.value)}
        disabled={readOnly}
        className={`w-32 bg-bg-card border rounded px-1.5 py-0.5 text-xs outline-none ${
          known ? 'border-border-base' : 'border-accent-red'
        } ${disabledCls}`}
        title={known ? '锚点' : `锚点「${cur}」不存在(可能引用已被删除的 NPC/出口)`}
      >
        {!known && <option value={cur}>{cur} (不存在)</option>}
        {anchorOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  // ---- 采集当前坐标 ----
  const applyCollected = (key: string, x: number, y: number) => {
    if (key === REVIVE_XY_KEY) {
      patch({ revivePoint: { x, y } });
      return;
    }
    if (key.startsWith('npc:')) {
      patchNpc(key.slice(4), { position: { x, y } });
      return;
    }
    if (key.startsWith('exit:')) {
      patchExit(key.slice(5), { position: { x, y } });
      return;
    }
    if (key.startsWith('transit:')) {
      patchTransit(key.slice(8), { position: { x, y } });
      return;
    }
    if (key.startsWith('route:')) {
      // route:<routeId>:<waypointIndex>
      const rest = key.slice(6);
      const sep = rest.lastIndexOf(':');
      setRouteWaypoint(rest.slice(0, sep), parseInt(rest.slice(sep + 1)) || 0, { x, y });
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
      const key = activeXy?.key ?? REVIVE_XY_KEY;
      applyCollected(key, res.x, res.y);
      // 地图名一并采集:城镇档案的 mapName 必须和游戏里 OCR 读到的名字一致
      if (res.map) patch({ mapName: res.map });
    } finally {
      setCollecting(false);
    }
  };

  const collectTargetLabel = activeXy ? activeXy.label : '复活点';

  return (
    <div className="space-y-5">
      {/* 顶部说明 + 采集当前坐标 */}
      <div className="rounded border border-accent-cyan/30 bg-accent-cyan/5 p-3 text-[12px] text-text-secondary space-y-2">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-accent-cyan" />
          <span className="font-medium text-text-primary">城镇档案</span>
          <span className="text-text-muted text-[11px]">(坐标都是游戏内地图坐标;farm 的「城市事件」按这份档案走)</span>
        </div>
        <div className="text-text-muted text-[11px]">
          流程:复活在复活点 → 按需访问商人(触发「回城检查项」时,按「复活点 → 商人」的路线走过去跑配方)→ 按「商人 → 出城口」的路线走到出口 →
          切回挂机地图。没配商人 NPC、或检查项没触发时,直接走到出城口返程。 路线只配一个方向也行(worker 会反着走)。
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
              先把角色走到目标位置 → 点一下要填的坐标框(X 或 Y)→ 再点这个按钮(同时会填地图名)
            </span>
          </div>
        )}
        {collectError && <div className="text-[11px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">读取坐标失败:{collectError}</div>}
      </div>

      {/* 地图名 + 复活点 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-text-secondary mb-1.5 block">
            地图名 <span className="text-text-muted text-[11px]">(游戏内 OCR 读到的中文名,要和它完全一致)</span>
          </label>
          <input
            type="text"
            value={value.mapName ?? ''}
            onChange={(e) => patch({ mapName: e.target.value })}
            placeholder="如:龙城"
            disabled={readOnly}
            className={`w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan ${disabledCls}`}
          />
          <div className="text-[10px] text-text-muted mt-1">复活后 worker 先读地图名,和这里不符就判定"复活点不在本城镇"并结束补给</div>
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1.5 block">
            复活点 <span className="text-text-muted text-[11px]">(原地复活后所在位置)</span>
          </label>
          <div className="flex items-center gap-2">
            <XyField
              x={revivePoint.x}
              y={revivePoint.y}
              readOnly={readOnly}
              onFocus={() => setActiveXy({ key: REVIVE_XY_KEY, label: '复活点' })}
              onX={(v) => patch({ revivePoint: { ...revivePoint, x: v } })}
              onY={(v) => patch({ revivePoint: { ...revivePoint, y: v } })}
            />
          </div>
        </div>
      </div>

      {/* 回城检查项:触发条件 —— 满足才去访问配了配方的商人 NPC;都不触发就直接去出城口 */}
      <div>
        <label className="text-sm text-text-secondary mb-1.5 block">
          回城检查项 <span className="text-text-muted text-[11px]">(触发条件:满足才去访问配了配方的商人 NPC;都不触发就直接去出城口)</span>
        </label>
        <div className="space-y-1.5 bg-bg-input/40 border border-border-base rounded p-2.5">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-cyan"
              disabled={readOnly}
              checked={value.checkDurability === true}
              onChange={(e) => patch({ checkDurability: e.target.checked })}
            />
            <span>检查装备耐久</span>
            <span className="text-text-muted text-[10px]">开角色面板看装备耐久,见底才去访问商人 NPC 修理</span>
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
              title="红药数量少于该值就去访问商人 NPC 买药;留空 = 不检查药水"
            />
            <span className="text-text-muted text-[10px]">个(留空 = 不检查药水)</span>
          </div>
          <div className="text-[10px] text-text-muted">
            勾了检查项、且回城时真的触发(装备见底 / 红药不足)才会去访问下面「配了配方」的商人 NPC; 没勾或都没触发时不访问任何
            NPC,直接走到出城口返程
          </div>
        </div>
      </div>

      {/* NPC 列表 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            NPC 列表 <span className="text-text-muted text-[11px]">(道具商人 / 仓库等;路线与配方都靠 id 引用)</span>
          </label>
          {!readOnly && (
            <button onClick={addNpc} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加 NPC
            </button>
          )}
        </div>
        <div className="text-[10px] text-text-muted mb-1.5">NPC 名称取值见 shared/npc.ts;「配方」留空 = 只当路线锚点,不会被访问</div>

        {npcs.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无 NPC,点"添加 NPC"配置(至少要有一个 NPC 或一个出城口才能保存)
          </div>
        ) : (
          <div className="space-y-1.5">
            {npcs.map((npc, i) => (
              <div key={npc.id} className="flex items-center gap-1.5 bg-bg-input p-1.5 rounded flex-wrap">
                <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                <input
                  type="text"
                  value={npc.id}
                  onChange={(e) => renameNpcId(npc.id, e.target.value)}
                  disabled={readOnly}
                  placeholder="id"
                  title="锚点 id(路线用 «from/to» 引用它)"
                  className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                />
                <select
                  value={normalizeNpcName(npc.name)}
                  onChange={(e) => patchNpc(npc.id, { name: e.target.value })}
                  disabled={readOnly}
                  title="NPC 名称(取值见 shared/npc.ts);也是游戏里找字用的绿字名"
                  className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  {!normalizeNpcName(npc.name) && <option value="">(未选择)</option>}
                  {npcSelectOptions(npc.name).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  value={npc.recipeName ?? ''}
                  onChange={(e) => patchNpc(npc.id, { recipeName: e.target.value || undefined })}
                  disabled={readOnly}
                  title="到达这个 NPC 时执行哪份对话配方;留空 = 只当路线锚点,不会被访问"
                  className={`w-44 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  <option value="">(不访问:只当路线锚点)</option>
                  {npcRecipeOptions(npc.recipeName, recipeNames).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <XyField
                  x={npc.position?.x ?? 0}
                  y={npc.position?.y ?? 0}
                  readOnly={readOnly}
                  onFocus={() => setActiveXy({ key: `npc:${npc.id}`, label: `NPC ${npc.name || npc.id}` })}
                  onX={(v) => patchNpc(npc.id, { position: { x: v, y: npc.position?.y ?? 0 } })}
                  onY={(v) => patchNpc(npc.id, { position: { x: npc.position?.x ?? 0, y: v } })}
                />
                <div className="flex-1" />
                {!readOnly && (
                  <button onClick={() => removeNpc(npc.id)} className="text-accent-red/70 hover:text-accent-red" title="删除该 NPC">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 路线 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            路线 <span className="text-text-muted text-[11px]">(锚点之间的途经点;只配一个方向也可以)</span>
          </label>
          {!readOnly && (
            <button onClick={addRoute} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加路线
            </button>
          )}
        </div>

        {routes.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无路线 = worker 直接从当前位置走过去(有路过不去的障碍时再配)
          </div>
        ) : (
          <div className="space-y-2">
            {routes.map((route, i) => (
              <div key={route.id} className="bg-bg-input p-2 rounded space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                  <span className="text-text-muted text-[10px]">从</span>
                  {renderAnchorSelect(route.from, (v) => patchRoute(route.id, { from: v }))}
                  <span className="text-text-muted text-[10px]">到</span>
                  {renderAnchorSelect(route.to, (v) => patchRoute(route.id, { to: v }))}
                  <div className="flex-1" />
                  {!readOnly && (
                    <>
                      <button onClick={() => addRouteWaypoint(route.id)} className="text-xs btn btn-secondary flex items-center gap-1">
                        <Plus size={11} />
                        添加途经点
                      </button>
                      <button onClick={() => removeRoute(route.id)} className="text-accent-red/70 hover:text-accent-red" title="删除该路线">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>

                {(route.waypoints ?? []).length === 0 ? (
                  <div className="text-[10px] text-text-muted pl-7">没有途经点 = 直接走这条路线(起点 → 终点)</div>
                ) : (
                  <div className="space-y-1 pl-7">
                    {(route.waypoints ?? []).map((wp, wi) => (
                      <div key={wi} className="flex items-center gap-1.5">
                        <span className="text-text-muted text-[10px] w-16">途经点 {wi + 1}</span>
                        <XyField
                          x={wp.x}
                          y={wp.y}
                          readOnly={readOnly}
                          onFocus={() => setActiveXy({ key: `route:${route.id}:${wi}`, label: `路线 #${i + 1} 途经点 ${wi + 1}` })}
                          onX={(v) => setRouteWaypoint(route.id, wi, { x: v })}
                          onY={(v) => setRouteWaypoint(route.id, wi, { y: v })}
                        />
                        {!readOnly && (
                          <button
                            onClick={() => removeRouteWaypoint(route.id, wi)}
                            className="text-text-muted hover:text-accent-red"
                            title="删除该途经点"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          锚点取值:复活点 = revive、NPC 用它的 id、出口用它的 id。途经点只负责"走近",终点仍按 NPC 名字找字 / 出口坐标点击
        </div>
      </div>

      {/* 出城口 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            出城口 <span className="text-text-muted text-[11px]">(目的地 = 挂机地图名或跨图链首图名;可走过去,也可与传送 NPC 对话)</span>
          </label>
          {!readOnly && (
            <button onClick={addExit} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加出口
            </button>
          )}
        </div>

        {exits.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无出口 = 补给完回不了挂机图(建议每个挂机地图都配一个)
          </div>
        ) : (
          <div className="space-y-1.5">
            {exits.map((exit, i) => (
              <div key={exit.id} className="flex items-center gap-1.5 bg-bg-input p-1.5 rounded flex-wrap">
                <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                <input
                  type="text"
                  value={exit.id}
                  onChange={(e) => renameExitId(exit.id, e.target.value)}
                  disabled={readOnly}
                  placeholder="id"
                  title="锚点 id(路线用 «from/to» 引用它)"
                  className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                />
                <input
                  type="text"
                  value={exit.toMap}
                  onChange={(e) => patchExit(exit.id, { toMap: e.target.value })}
                  disabled={readOnly}
                  placeholder="通往的地图名(如:无泪南郊)"
                  title="出口通往的野外地图中文名,要和目的地一致(挂机地图名,或跨图链的首张图名)"
                  className={`w-48 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                />
                <select
                  value={exit.via ?? 'walk'}
                  onChange={(e) => patchExit(exit.id, { via: e.target.value === 'npc' ? 'npc' : undefined })}
                  disabled={readOnly}
                  title="离城方式:走过去踩传送点,或与传送 NPC 对话后传送"
                  className={`w-24 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  <option value="walk">走过去</option>
                  <option value="npc">对话传送</option>
                </select>
                {exit.via === 'npc' && (
                  <>
                    <select
                      value={normalizeNpcName(exit.npcName)}
                      onChange={(e) => patchExit(exit.id, { npcName: e.target.value || undefined })}
                      disabled={readOnly}
                      title="传送 NPC 名称(取值见 shared/npc.ts);游戏里按绿字找它"
                      className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                    >
                      {!normalizeNpcName(exit.npcName) && <option value="">(选择 NPC)</option>}
                      {npcSelectOptions(exit.npcName).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select
                      value={exit.recipeName ?? ''}
                      onChange={(e) => patchExit(exit.id, { recipeName: e.target.value || undefined })}
                      disabled={readOnly}
                      title="对话配方(内容为「使用传送 → 目的地 → 确认」)"
                      className={`w-44 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                    >
                      <option value="">(选择对话配方)</option>
                      {npcRecipeOptions(exit.recipeName, recipeNames).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <XyField
                  x={exit.position?.x ?? 0}
                  y={exit.position?.y ?? 0}
                  readOnly={readOnly}
                  onFocus={() => setActiveXy({ key: `exit:${exit.id}`, label: `出口 ${exit.toMap || exit.id}` })}
                  onX={(v) => patchExit(exit.id, { position: { x: v, y: exit.position?.y ?? 0 } })}
                  onY={(v) => patchExit(exit.id, { position: { x: exit.position?.x ?? 0, y: v } })}
                />
                <div className="flex-1" />
                {!readOnly && (
                  <button onClick={() => removeExit(exit.id)} className="text-accent-red/70 hover:text-accent-red" title="删除该出口">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          「走过去」= 走到坐标踩传送点自动切图;「对话传送」= 走到传送 NPC(飞空艇仙子等)跑对话配方后传送。 两种方式 worker
          都等地图名变成出口填的「通往的地图名」才算成功
        </div>
      </div>

      {/* 其它主城中转:回城卷轴落在别的主城时,用该主城的飞空艇 NPC 传送回本城镇 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm text-text-secondary">
            其它主城中转{' '}
            <span className="text-text-muted text-[11px]">(在这些主城启动、或回城卷轴落在这些主城时,用该城的飞空艇 NPC 传送回本城镇)</span>
          </label>
          {!readOnly && (
            <button onClick={addTransit} className="text-xs btn btn-secondary flex items-center gap-1">
              <Plus size={12} />
              添加中转主城
            </button>
          )}
        </div>

        {transitFrom.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-xs border border-dashed border-border-base rounded">
            暂无中转 = 回城卷轴必须正好落在本城镇(落在别的主城时走不回来)
          </div>
        ) : (
          <div className="space-y-1.5">
            {transitFrom.map((transit, i) => (
              <div key={transit.id} className="flex items-center gap-1.5 bg-bg-input p-1.5 rounded flex-wrap">
                <span className="text-text-muted text-[11px] w-6 text-center">#{i + 1}</span>
                <input
                  type="text"
                  value={transit.id}
                  onChange={(e) => renameTransitId(transit.id, e.target.value)}
                  disabled={readOnly}
                  placeholder="id"
                  title="这条中转记录的 id(仅界面内使用)"
                  className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none font-mono ${disabledCls}`}
                />
                <input
                  type="text"
                  value={transit.mapName}
                  onChange={(e) => patchTransit(transit.id, { mapName: e.target.value })}
                  disabled={readOnly}
                  placeholder="该主城地图名(如:龙城)"
                  title="回城卷轴可能落到的另一座主城的中文地图名(和游戏内 OCR 读到的名字一致)"
                  className={`w-48 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                />
                <select
                  value={normalizeNpcName(transit.npcName)}
                  onChange={(e) => patchTransit(transit.id, { npcName: e.target.value })}
                  disabled={readOnly}
                  title="该主城的飞空艇 NPC(取值见 shared/npc.ts);游戏里按绿字找它"
                  className={`w-32 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  {!normalizeNpcName(transit.npcName) && <option value="">(选择 NPC)</option>}
                  {npcSelectOptions(transit.npcName).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  value={transit.recipeName ?? ''}
                  onChange={(e) => patchTransit(transit.id, { recipeName: e.target.value })}
                  disabled={readOnly}
                  title="对话配方(内容为「使用传送 → 本城镇 → 确认」)"
                  className={`w-44 bg-bg-card border border-border-base rounded px-1.5 py-0.5 text-xs outline-none ${disabledCls}`}
                >
                  <option value="">(选择对话配方)</option>
                  {npcRecipeOptions(transit.recipeName, recipeNames).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <XyField
                  x={transit.position?.x ?? 0}
                  y={transit.position?.y ?? 0}
                  readOnly={readOnly}
                  onFocus={() => setActiveXy({ key: `transit:${transit.id}`, label: `中转主城 ${transit.mapName || transit.id} 的飞空艇` })}
                  onX={(v) => patchTransit(transit.id, { position: { x: v, y: transit.position?.y ?? 0 } })}
                  onY={(v) => patchTransit(transit.id, { position: { x: transit.position?.x ?? 0, y: v } })}
                />
                <div className="flex-1" />
                {!readOnly && (
                  <button
                    onClick={() => removeTransit(transit.id)}
                    className="text-accent-red/70 hover:text-accent-red"
                    title="删除该中转主城"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-text-muted mt-1">
          每座你可能会落到 / 从那里启动的主城都配一条:在这些主城启动,或回城卷轴落在这些主城时,都会用该城的飞空艇 NPC
          传送回本城镇;不含途经点也能走(直接走过去)
        </div>
      </div>
    </div>
  );
}
