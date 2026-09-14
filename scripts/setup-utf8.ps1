# 一键设置 PowerShell/cmd 默认 UTF-8
# 解决 Windows 中文日志乱码
# 用法(右键 PowerShell → 以管理员身份运行):
#   .\scripts\setup-utf8.ps1

$ErrorActionPreference = 'Stop'

Write-Host '=== PowerShell UTF-8 配置 ===' -ForegroundColor Cyan

# 1. 修改 PowerShell profile
$profilePath = $PROFILE
if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Path $profilePath -Force | Out-Null
    Write-Host "[1/3] 创建 profile: $profilePath" -ForegroundColor Green
} else {
    Write-Host "[1/3] profile 已存在" -ForegroundColor Yellow
}

# 2. 注入 chcp 65001(幂等)
$marker = '# === fo-help: chcp 65001 (UTF-8) ==='
$cmd = "chcp 65001 | Out-Null"
$content = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
if ($content -and $content -match [regex]::Escape($marker)) {
    Write-Host "       chcp 65001 已配置" -ForegroundColor Yellow
} else {
    @"

$marker
$cmd
"@ | Add-Content $profilePath
    Write-Host "       OK 已注入 chcp 65001" -ForegroundColor Green
}

# 3. 系统全局 UTF-8(Win10 1903+,需管理员)
$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls'
$regName = 'EnableUTF8'
$current = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
if ($current.EnableUTF8 -eq 1) {
    Write-Host "[2/3] 系统全局 UTF-8 已启用" -ForegroundColor Yellow
} else {
    try {
        Set-ItemProperty -Path $regPath -Name $regName -Value 1 -Type DWord
        Write-Host "[2/3] OK 已启用系统全局 UTF-8(需重启)" -ForegroundColor Green
    } catch {
        Write-Host "[2/3] 跳过(需管理员): $_" -ForegroundColor Yellow
    }
}

# 4. 当前会话切 UTF-8
Write-Host "[3/3] 当前会话切 UTF-8" -ForegroundColor Cyan
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ''
Write-Host 'Done!' -ForegroundColor Green
Write-Host '   - 新 PowerShell 窗口自动 UTF-8' -ForegroundColor Gray
Write-Host '   - 已开窗口: 重开 PowerShell 生效' -ForegroundColor Gray
Write-Host '   - 验证: chcp  应显示 65001' -ForegroundColor Gray
