// 设置面板:分辨率 + 大漠注册码 + 验证码大模型 API key
// - 分辨率决定坐标常量取哪一档(core/constant-ocr/*),未设置时首页会自动弹出本面板
// - 保存走主进程 settings:save,落到本地 JSON;下次启动不再提醒

import { useEffect, useState } from 'react';
import { X, Monitor, KeyRound, Bot, Save } from 'lucide-react';
import type { GameResolution } from '../../shared/types';
import { useStore } from '../store/useStore';

/** 支持的分辨率档位(与 core/constant-ocr 的坐标常量分档对应) */
const RESOLUTIONS: { value: GameResolution; label: string; hint: string }[] = [
  { value: '1600*900', label: '1600 × 900', hint: '游戏窗口客户区 1600×900' },
  { value: '1280*800', label: '1280 × 800', hint: '游戏窗口客户区 1280×800' },
];

interface Props {
  /** true = 首次启动自动弹出(未检测到分辨率设置),提示用户必须先选一个 */
  firstRun?: boolean;
  onClose: () => void;
}

export function SettingsDialog({ firstRun = false, onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);

  const [resolution, setResolution] = useState<GameResolution | null>(settings?.resolution ?? null);
  const [damooRegisterCode, setDamooRegisterCode] = useState(settings?.damooRegisterCode ?? '');
  const [damooAttachCode, setDamooAttachCode] = useState(settings?.damooAttachCode ?? '');
  const [dashscopeApiKey, setDashscopeApiKey] = useState(settings?.dashscopeApiKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // settings 是从主进程异步读的,可能晚于本面板挂载(首次自动弹出时)——读到了就填进去
  useEffect(() => {
    if (!settings) return;
    setResolution(settings.resolution);
    setDamooRegisterCode(settings.damooRegisterCode);
    setDamooAttachCode(settings.damooAttachCode);
    setDashscopeApiKey(settings.dashscopeApiKey);
  }, [settings]);

  const handleSave = async () => {
    if (!resolution) {
      setError('请先选择游戏分辨率');
      return;
    }
    setSaving(true);
    setError('');
    const saved = await saveSettings({
      resolution,
      damooRegisterCode: damooRegisterCode.trim(),
      damooAttachCode: damooAttachCode.trim(),
      dashscopeApiKey: dashscopeApiKey.trim(),
    });
    setSaving(false);
    if (!saved) {
      setError('保存失败,请重试');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-card border border-border-base rounded-lg shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-base">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-accent-cyan" />
            <span className="font-medium">设置</span>
            {firstRun && (
              <span className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                首次使用,请先选择分辨率
              </span>
            )}
          </div>
          <button className="text-text-muted hover:text-text-primary" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 分辨率 */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Monitor size={14} className="text-text-secondary" />
              游戏分辨率
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              决定地图坐标、弹框识别等区域读哪一档常量。与游戏窗口客户区尺寸不一致会读错位置。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.value}
                  className={[
                    'text-left px-3 py-2 rounded border transition-colors',
                    resolution === r.value
                      ? 'bg-accent-cyan/15 border-accent-cyan/60 text-accent-cyan'
                      : 'bg-bg-input border-border-base hover:border-border-active',
                  ].join(' ')}
                  onClick={() => setResolution(r.value)}
                >
                  <div className="text-sm font-mono">{r.label}</div>
                  <div className="text-[11px] text-text-muted mt-0.5">{r.hint}</div>
                </button>
              ))}
            </div>
          </section>

          {/* 大漠注册码 */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound size={14} className="text-text-secondary" />
              大漠插件注册码
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              留空则使用程序内置注册码。注册码无效时窗口绑定、截图等高级接口不可用。
            </p>
            <input
              className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono"
              placeholder="大漠注册码(留空用内置)"
              value={damooRegisterCode}
              onChange={(e) => setDamooRegisterCode(e.target.value)}
            />
            <input
              className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono"
              placeholder="大漠附加码(留空用内置)"
              value={damooAttachCode}
              onChange={(e) => setDamooAttachCode(e.target.value)}
            />
          </section>

          {/* 验证码大模型 */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Bot size={14} className="text-text-secondary" />
              验证码识别大模型 API key
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              通义千问 DashScope(多模态)API key,用于神医验证码弹框自动作答。留空则兜底点第一个选项。
            </p>
            <input
              type="password"
              className="w-full bg-bg-input border border-border-base rounded px-3 py-1.5 text-sm outline-none focus:border-accent-cyan font-mono"
              placeholder="sk-..."
              value={dashscopeApiKey}
              onChange={(e) => setDashscopeApiKey(e.target.value)}
            />
          </section>

          {error && <div className="text-xs text-accent-red">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-base">
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary flex items-center gap-1 disabled:opacity-60"
            disabled={saving}
            onClick={handleSave}
          >
            <Save size={12} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
