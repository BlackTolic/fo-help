// DamooRegistrar: 大漠插件注册检查 + UAC 提权注册
//
// 注册查找逻辑:
//   - 32-bit COM dm.dll 在 64-bit Windows 上的 CLSID 落在
//     HKLM\SOFTWARE\WOW6432Node\Classes\CLSID\{CLSID}
//   - 注册表读取用 reg.exe(原生 64-bit 视图,不会被 PS Registry provider 的反射欺骗)
//
// 注册触发:
//   - Electron 主进程没管理员权限,不能直接 regsvr32
//   - 走 PowerShell + ProcessStartInfo.Verb='runas' + UseShellExecute=$true
//     这会在用户桌面弹 UAC,确认后由 SYSTEM 创建 regsvr32 子进程

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { createLogger } from '../../core/logger';

const log = createLogger('damoo-registrar');

// 大漠 dmsoft 的固定 GUID(从 Type.GetTypeFromProgID('dm.dmsoft') 推出来)
const DM_CLSID = '{26037A0E-7CBD-4FFF-9C63-56F2D0770214}';
const REG_BASE = `HKLM\\SOFTWARE\\WOW6432Node\\Classes\\CLSID\\${DM_CLSID}\\InprocServer32`;

export type DamooStatus =
  | { kind: 'ok'; path: string; expectedPath: string }
  | { kind: 'wrong'; registeredPath: string; expectedPath: string }
  | { kind: 'missing'; expectedPath: string }
  | { kind: 'no-dll'; reason: string };

export interface DamooCheckResult {
  status: DamooStatus;
  /** 人类可读的解释(给 UI 直接显示) */
  message: string;
}

export class DamooRegistrar {
  /**
   * 启动时静默检查:大漠 dll 是否已经注册到当前项目自带的 dm.dll
   * - 注册表存在 + 路径匹配 → ok
   * - 注册表存在 + 路径不匹配 → wrong (旧的 / 其他项目的 dm.dll)
   * - 注册表不存在 → missing
   * - dm.dll 自身未发现 → no-dll
   */
  check(): Promise<DamooCheckResult> {
    const expected = this.getDmPath();
    if (!expected) {
      return Promise.resolve({
        status: { kind: 'no-dll', reason: 'assets/dll/dm.dll 不在项目中' },
        message: '项目内找不到 dm.dll,无法检查注册状态',
      });
    }

    return new Promise((resolve) => {
      const child = spawn('reg.exe', ['query', REG_BASE, '/ve'], { windowsHide: true });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.on('error', (e) => {
        // reg.exe 自身启动失败(罕见)
        log.warn(`[DamooRegistrar] reg.exe 启动失败: ${e.message}`);
        resolve({
          status: { kind: 'no-dll', reason: e.message },
          message: `检查工具不可用: ${e.message}`,
        });
      });
      child.on('close', (code) => {
        // reg.exe 退出码 1 通常代表"找不到键",即完全未注册
        if (code !== 0) {
          log.info(`[DamooRegistrar] 未注册 (reg.exe exit=${code})`);
          resolve({
            status: { kind: 'missing', expectedPath: expected },
            message: '大漠插件未注册,首次使用前需要管理员权限注册一次',
          });
          return;
        }
        // 解析输出,典型格式:
        //   (Default)    REG_SZ    C:\path\to\dm.dll
        const m = stdout.match(/REG_SZ\s+(.+?)\r?\n/);
        if (!m) {
          log.warn(`[DamooRegistrar] 解析注册输出失败: ${stdout.slice(0, 200)}`);
          resolve({
            status: { kind: 'missing', expectedPath: expected },
            message: '大漠插件注册表读取异常,建议重新注册',
          });
          return;
        }
        const registered = m[1].trim();
        if (this.normalize(registered) === this.normalize(expected)) {
          log.info(`[DamooRegistrar] 已正确注册 → ${registered}`);
          resolve({
            status: { kind: 'ok', path: registered, expectedPath: expected },
            message: '大漠插件已注册',
          });
        } else {
          log.warn(`[DamooRegistrar] 注册到了其他路径: ${registered} ≠ 期望 ${expected}`);
          resolve({
            status: { kind: 'wrong', registeredPath: registered, expectedPath: expected },
            message: `大漠已注册到旧路径(${registered}),可能指向其他版本的 dm.dll`,
          });
        }
      });
    });
  }

  /**
   * 通过 UAC 提权触发 regsvr32 注册当前自带的 dm.dll(覆盖旧路径)
   * - 用户会在桌面看到 UAC 弹窗,点"是"之后 regsvr32 以管理员权限运行
   * - 主进程拿不到 UAC 结果,通过 stdout 中 `"exit=N"` 解析
   * - 用户拒绝 UAC 时 stdout 中是 `"err=..."`
   */
  register(): Promise<{ ok: boolean; error?: string }> {
    const dll = this.getDmPath();
    if (!dll) return Promise.resolve({ ok: false, error: 'dm.dll 未发现' });

    log.info(`[DamooRegistrar] 触发 UAC → regsvr32 /s ${dll}`);

    // 双引号转义(虽然路径基本是固定 dev 路径,但还是保险)
    const escaped = dll.replace(/"/g, '""');
    const psScript = [
      `$ErrorActionPreference = 'Stop'`,
      `$psi = New-Object System.Diagnostics.ProcessStartInfo`,
      `$psi.FileName = 'regsvr32.exe'`,
      `$psi.Arguments = '/s "${escaped}"'`,
      `$psi.UseShellExecute = $true`,
      `$psi.Verb = 'runas'`,
      `try {`,
      `  $proc = [System.Diagnostics.Process]::Start($psi)`,
      `  $proc.WaitForExit()`,
      `  "exit=$($proc.ExitCode)"`,
      `} catch {`,
      `  "err=$($_.Exception.Message)"`,
      `}`,
    ].join('\n');

    return new Promise((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { windowsHide: true },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });
      child.on('error', (e) => {
        log.warn(`[DamooRegistrar] powershell 启动失败: ${e.message}`);
        resolve({ ok: false, error: `无法启动 PowerShell: ${e.message}` });
      });
      child.on('close', () => {
        const exitMatch = stdout.match(/exit=(-?\d+)/);
        const errMatch = stdout.match(/err=([^\r\n]+)/);
        if (exitMatch) {
          const code = parseInt(exitMatch[1], 10);
          if (code === 0) {
            log.info('[DamooRegistrar] regsvr32 成功 (exit=0)');
            resolve({ ok: true });
          } else {
            log.warn(`[DamooRegistrar] regsvr32 exit=${code}, stderr=${stderr.trim()}`);
            resolve({ ok: false, error: `regsvr32 返回 ${code}` });
          }
        } else if (errMatch) {
          // 典型: 用户拒绝 UAC → 操作已被用户取消。
          log.warn(`[DamooRegistrar] regsvr32 未启动: ${errMatch[1]}`);
          resolve({ ok: false, error: errMatch[1] });
        } else {
          resolve({ ok: false, error: `未知错误,stdout=${stdout.trim()},stderr=${stderr.trim()}` });
        }
      });
    });
  }

  /**
   * 项目自带的 dm.dll 物理路径
   * - dev:        app.getAppPath() = 项目根 → assets/dll/dm.dll
   * - packaged:   extraResources 抽到 resources/dll/dm.dll(真实磁盘,asar 外)
   *   regsvr32 必须读真实磁盘路径,asar 内的 dll 注册不了
   * 顺序:先看 packaged 路径(如果存在,大概率是对的),fallback 到 dev 路径
   */
  private getDmPath(): string | null {
    const candidates = [
      // packaged: extraResources 把 assets/dll/ 抽到 resources/dll/
      path.join(process.resourcesPath, 'dll', 'dm.dll'),
      // dev: 项目根下
      path.join(app.getAppPath(), 'assets', 'dll', 'dm.dll'),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  private normalize(p: string): string {
    return path.resolve(p).replace(/\\/g, '/').toLowerCase();
  }
}
