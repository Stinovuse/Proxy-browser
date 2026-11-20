# Запускает собранный установщик, проходит страницы и сохраняет скриншоты (для проверки оформления)
param([string]$Out = "installer-screens")
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, Microsoft.VisualBasic
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
function Press([int]$pid_, [string]$keys) {
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($pid_) } catch {}
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait($keys)
}

$setup = Get-ChildItem dist\*.exe | Where-Object { $_.Name -like 'SBrowser-Setup-*' } | Select-Object -First 1
Write-Host "installer: $($setup.FullName)"
$p = Start-Process -FilePath $setup.FullName -PassThru
Start-Sleep -Seconds 6; Shot '1-welcome'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '2-next'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '3-next'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 20; Shot '4-after-install'
Press $p.Id '{ENTER}'; Start-Sleep -Seconds 3; Shot '5-end'
Get-Process | Where-Object { $_.ProcessName -like 'SBrowser-Setup*' -or $_.ProcessName -eq 'S Browser' } | Stop-Process -Force -ErrorAction SilentlyContinue
