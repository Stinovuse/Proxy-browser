# Запускает собранный установщик, проходит страницы и сохраняет скриншоты (для проверки оформления)
param([string]$Out = "installer-screens")
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, Microsoft.VisualBasic
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
Write-Host "session: $([System.Diagnostics.Process]::GetCurrentProcess().SessionId) interactive: $([Environment]::UserInteractive)"
try { (New-Object -ComObject Shell.Application).MinimizeAll() } catch { Write-Host "minimize failed: $_" }
New-Item -ItemType Directory -Force $Out | Out-Null

function Shot([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "saved $name"
}
function Front {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -like 'SBrowser-Setup*' } | ForEach-Object {
    Write-Host "window: $($_.ProcessName) pid=$($_.Id) session=$($_.SessionId) title='$($_.MainWindowTitle)'"
    [W]::ShowWindow($_.MainWindowHandle, 9) | Out-Null
    [W]::BringWindowToTop($_.MainWindowHandle) | Out-Null
    [W]::SetForegroundWindow($_.MainWindowHandle) | Out-Null
  }
}
function Press([int]$pid_, [string]$keys) {
  Front
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait($keys)
}

$setup = Get-ChildItem dist\*.exe | Where-Object { $_.Name -like 'SBrowser-Setup-*' } | Select-Object -First 1
Write-Host "installer: $($setup.FullName)"
$p = Start-Process -FilePath $setup.FullName -PassThru
Start-Sleep -Seconds 6
Get-Process | Where-Object { $_.ProcessName -like 'SBrowser*' } | ForEach-Object { Write-Host "proc: $($_.ProcessName) pid=$($_.Id) session=$($_.SessionId) hwnd=$($_.MainWindowHandle) title='$($_.MainWindowTitle)'" }
Front; Start-Sleep -Milliseconds 800; Shot '1-welcome'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '2-next'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '3-next'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 20; Shot '4-after-install'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '5-end'
Get-Process | Where-Object { $_.ProcessName -like 'SBrowser-Setup*' -or $_.ProcessName -eq 'S Browser' } | Stop-Process -Force -ErrorAction SilentlyContinue
