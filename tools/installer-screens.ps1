# Проходит страницы собранного установщика и деинсталлятора и снимает их окна (для проверки оформления).
# Окно снимается через PrintWindow (видно даже под другими окнами), «Далее» нажимается командой WM_COMMAND.
param([string]$Out = "installer-screens")
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
New-Item -ItemType Directory -Force $Out | Out-Null

function FindWin([scriptblock]$filter) {
  for ($i = 0; $i -lt 40; $i++) {
    $found = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Where-Object $filter | Select-Object -First 1
    if ($found) { return $found }
    Start-Sleep -Milliseconds 500
  }
  return $null
}
function Cap([IntPtr]$h, [string]$name) {
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  if ($w -le 0 -or $hh -le 0) { Write-Host "skip $name (no rect)"; return }
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [W]::PrintWindow($h, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "saved $name ($w x $hh)"
}
function Next([IntPtr]$h) { [W]::PostMessage($h, 0x0111, [IntPtr]1, [IntPtr]::Zero) | Out-Null }  # WM_COMMAND, IDOK = «Далее»
function Cancel([IntPtr]$h) { [W]::PostMessage($h, 0x0111, [IntPtr]2, [IntPtr]::Zero) | Out-Null }

# ---------- Установка ----------
$setup = Get-ChildItem dist\*.exe | Where-Object { $_.Name -like 'SBrowser-Setup-*' } | Select-Object -First 1
Write-Host "installer: $($setup.FullName)"
$proc = Start-Process -FilePath $setup.FullName -PassThru
$setupId = $proc.Id
$win = FindWin { $_.Id -eq $setupId -or $_.ProcessName -like 'SBrowser-Setup*' }
if (-not $win) { Write-Host 'installer window not found'; exit 0 }
$h = $win.MainWindowHandle
Write-Host "title: $($win.MainWindowTitle)"
Start-Sleep -Seconds 1; Cap $h '1-welcome'
Next $h; Start-Sleep -Seconds 2; Cap $h '2-mode'
Next $h; Start-Sleep -Seconds 2; Cap $h '3-folder'
Next $h; Start-Sleep -Seconds 2; Cap $h '4-progress'
Start-Sleep -Seconds 25; Cap $h '5-finish'
Cancel $h; Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'SBrowser-Setup*' } | Stop-Process -Force -ErrorAction SilentlyContinue

# ---------- Удаление (только первая страница) ----------
$un = Join-Path $env:LOCALAPPDATA 'Programs\S Browser\Uninstall S Browser.exe'
if (Test-Path $un) {
  Start-Process -FilePath $un | Out-Null
  $uw = FindWin { $_.MainWindowTitle -like '*S Browser*' -and $_.ProcessName -ne 'S Browser' -and $_.ProcessName -notlike 'SBrowser-Setup*' }
  if ($uw) {
    Start-Sleep -Seconds 1; Cap $uw.MainWindowHandle '6-uninstall-welcome'
    Next $uw.MainWindowHandle; Start-Sleep -Seconds 2; Cap $uw.MainWindowHandle '7-uninstall-next'
    Next $uw.MainWindowHandle; Start-Sleep -Seconds 12; Cap $uw.MainWindowHandle '8-uninstall-finish'
    Next $uw.MainWindowHandle
  }
} else { Write-Host "uninstaller not found: $un" }
Get-Process | Where-Object { $_.ProcessName -eq 'S Browser' } | Stop-Process -Force -ErrorAction SilentlyContinue
