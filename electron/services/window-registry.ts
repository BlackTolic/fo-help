// WindowRegistry: 枚举并跟踪游戏窗口
// P1 阶段:用 PowerShell + Win32 API 枚举(简单可靠)
// P2 阶段:可换 koffi 直接调,避免 PowerShell 启动开销

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GameWindow } from '../../shared/types';
import { createLogger } from '../../core/logger';

const log = createLogger('window-registry');
const execFileAsync = promisify(execFile);

/** 调 PowerShell 枚举所有可见顶层窗口,返回 JSON 列表 */
async function listAllWindowsViaPS(): Promise<GameWindow[]> {
  const script = `
    # 强制 UTF-8,避免中文窗口标题在子进程 stdout 中被 GBK 编码乱码丢弃
    chcp 65001 >nul
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8

    Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      using System.Collections.Generic;
      public class WinEnum {
        public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("psapi.dll", CharSet=CharSet.Unicode)] public static extern uint GetModuleBaseName(IntPtr h, IntPtr m, StringBuilder s, uint n);
        [DllImport("user32.dll")] public static extern bool EnumProcesses(uint[] pids, uint size, out uint needed);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
      }
"@ -ErrorAction SilentlyContinue

    $results = New-Object System.Collections.ArrayList
    $max = 256

    $cb = [WinEnum+EnumProc]{
      param($h, $l)
      if (-not [WinEnum]::IsWindowVisible($h)) { return $true }
      $title = New-Object System.Text.StringBuilder $max
      [WinEnum]::GetWindowText($h, $title, $max) | Out-Null
      if ($title.Length -eq 0) { return $true }
      $cls = New-Object System.Text.StringBuilder $max
      [WinEnum]::GetClassName($h, $cls, $max) | Out-Null
      $procId = 0
      [WinEnum]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
      # 注意:不要用 $procId -eq 0 跳过 — 部分反外挂保护的游戏窗口 PID 读到 0,
      # 但 title/className 仍可正确识别,跳过会导致游戏窗口被漏掉
      $r = New-Object WinEnum+RECT
      [WinEnum]::GetWindowRect($h, [ref]$r) | Out-Null
      $w = $r.R - $r.L
      $h2 = $r.B - $r.T
      # 尺寸检查放宽:某些私服/反外挂让 GetWindowRect 返回 0,但 title/className 仍可识别
      if ($w -lt 50 -or $h2 -lt 50) { return $true }
      $procName = ""
      $hp = [WinEnum]::OpenProcess(0x1000, $false, $procId)
      if ($hp -ne [IntPtr]::Zero) {
        $nb = New-Object System.Text.StringBuilder 256
        [WinEnum]::GetModuleBaseName($hp, [IntPtr]::Zero, $nb, 256) | Out-Null
        $procName = $nb.ToString()
        [WinEnum]::CloseHandle($hp) | Out-Null
      }
      $fg = [WinEnum]::GetForegroundWindow() -eq $h
      $mini = [WinEnum]::IsIconic($h)
      $obj = [PSCustomObject]@{
        HWnd = $h.ToInt64()
        Pid = [int]$procId
        Title = $title.ToString()
        ClassName = $cls.ToString()
        ProcessName = $procName
        X = [int]$r.L
        Y = [int]$r.T
        W = [int]$w
        H = [int]$h2
        IsForeground = $fg
        IsMinimized = $mini
      }
      [void]$results.Add($obj)
      return $true
    }

    [WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    $json = $results | ConvertTo-Json -Depth 3 -Compress
    # stdout 编码默认是 GBK,直接 pipe 给 Node 会乱码 → 改用 base64 传输
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    [Convert]::ToBase64String($bytes)
  `;

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { timeout: 5000, windowsHide: true });

    if (!stdout.trim()) return [];
    // base64 传输避免 stdout 编码问题
    const decoded = Buffer.from(stdout.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((w: any) => ({
      hwnd: Number(w.HWnd),
      pid: Number(w.Pid),
      title: String(w.Title || ''),
      className: String(w.ClassName || ''),
      processName: String(w.ProcessName || ''),
      rect: {
        x: Number(w.X) || 0,
        y: Number(w.Y) || 0,
        w: Number(w.W) || 0,
        h: Number(w.H) || 0,
      },
      isForeground: !!w.IsForeground,
      isMinimized: !!w.IsMinimized,
    }));
  } catch (err) {
    log.error('[WindowRegistry] PowerShell 枚举失败:', err);
    return [];
  }
}

/** QQ幻想 窗口识别规则(可扩展) */
export function isQQFantasyWindow(win: GameWindow): boolean {
  const procName = win.processName.toLowerCase();
  const title = win.title.toLowerCase();
  const className = win.className;

  // 0. 排除自己(electron / chrome 类窗口,避免本应用误报)
  const SELF_CLASSES = [
    'Chrome_WidgetWin_1',  // Electron 主窗口
    'Chrome_RenderWidgetHostHWND',
    'Intermediate D3D Window',
  ];
  // console.log('title--------', title);
  // 测试
  if(title.includes('文本文档')){
     return true
  }
  if (SELF_CLASSES.includes(className)) {
    return false;
  }

  // 0b. 排除本应用("QQ幻想助手" 是我们自己的窗口)
  if (title === 'qq幻想助手' || title.startsWith('qq幻想助手')) {
    return false;
  }

  // 0c. 排除 Windows 文件资源管理器(打开 "QQ幻想" 文件夹时标题会含 qq幻想,误报)
  if (className === 'CabinetWClass') {
    return false;
  }

  // 1. 进程名匹配(空名放过,可能是反外挂保护)
  if (procName && (
    procName.includes('qq') ||
    procName.includes('fantasy') ||
    procName.includes('幻想') ||
    procName === 'game.exe'
  )) {
    return true;
  }
  // 2. 标题匹配(QQ幻想私服常见标题: "QQ幻想之XX" / "幻想世界")
  if (title.includes('qq幻想') || title.includes('幻想世界')) {
    return true;
  }

  // 3. 类名匹配(QQ幻想 / 私服)
  const KNOWN_CLASSES = [
    'TMainForm',         // 老版 Delphi
    'QQSwordWinClass',   // QQ幻想之龙飞凤舞 实际类名
    'TApplication',      // 部分老游戏
    'GameWnd',           // 私服
  ];
  if (KNOWN_CLASSES.includes(className)) {
    return true;
  }

  return false;
}

/** 列出所有 QQ幻想 窗口 */
export async function listGameWindows(): Promise<GameWindow[]> {
  const all = await listAllWindowsViaPS();
  return all.filter(isQQFantasyWindow);
}
