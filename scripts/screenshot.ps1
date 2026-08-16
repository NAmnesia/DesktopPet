# 截取屏幕指定区域用于验证桌宠渲染
param(
  [int]$X = -1, [int]$Y = -1,
  [int]$W = 540, [int]$H = 700,
  [string]$Out = "D:\zcode__coding\desktop-pet\.shot.png"
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($X -lt 0) { $X = $bounds.Width - $W - 30 }
if ($Y -lt 0) { $Y = $bounds.Height - $H }
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $Out (region ${W}x${H} @ $X,$Y)"
