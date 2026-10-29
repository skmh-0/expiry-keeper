param(
  [string]$Source = 'C:\Users\skmh\AppData\Local\Temp\codex-clipboard-1cabea8d-c3ab-4a7f-ba08-d1f02ec791b8.png',
  [string]$Root = 'D:\Codex\expiry-keeper'
)

Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile($Source)
# 右下角有「豆包 AI 生成」水印：裁掉底部，取 356x356 的正方形
$cropRect = New-Object System.Drawing.Rectangle 14, 0, 356, 356
$crop = New-Object System.Drawing.Bitmap 356, 356
$cropGraphics = [System.Drawing.Graphics]::FromImage($crop)
$cropGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cropGraphics.DrawImage($image, (New-Object System.Drawing.Rectangle 0, 0, 356, 356), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$cropGraphics.Dispose()
$image.Dispose()

$cream = [System.Drawing.Color]::FromArgb(255, 253, 246, 231)
$transparent = [System.Drawing.Color]::Transparent

function Save-Icon {
  param(
    [string]$Path,
    [int]$Size,
    [double]$Scale,
    [System.Drawing.Color]$Background,
    [switch]$Round,
    [switch]$CirclePhoto
  )
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear($Background)
  if ($Round) {
    $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $shape.AddEllipse(0, 0, $Size, $Size)
    $graphics.SetClip($shape, [System.Drawing.Drawing2D.CombineMode]::Replace)
  }
  $side = [int][math]::Round($Size * $Scale)
  $offset = [int][math]::Round(($Size - $side) / 2)
  if ($CirclePhoto) {
    # 照片本身裁成圆形，避免在自适应图层里露出方形边界
    $photoShape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $photoShape.AddEllipse($offset, $offset, $side, $side)
    $graphics.SetClip($photoShape, [System.Drawing.Drawing2D.CombineMode]::Intersect)
  }
  $graphics.DrawImage($crop, (New-Object System.Drawing.Rectangle $offset, $offset, $side, $side))
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$densities = [ordered]@{
  'mdpi'    = @{ Icon = 48;  Foreground = 108 }
  'hdpi'    = @{ Icon = 72;  Foreground = 162 }
  'xhdpi'   = @{ Icon = 96;  Foreground = 216 }
  'xxhdpi'  = @{ Icon = 144; Foreground = 324 }
  'xxxhdpi' = @{ Icon = 192; Foreground = 432 }
}

foreach ($density in $densities.Keys) {
  $sizes = $densities[$density]
  $dir = Join-Path $Root "android\app\src\main\res\mipmap-$density"
  Save-Icon -Path (Join-Path $dir 'ic_launcher_new.png') -Size $sizes.Icon -Scale 0.88 -Background $cream
  Save-Icon -Path (Join-Path $dir 'ic_launcher_new_round.png') -Size $sizes.Icon -Scale 0.88 -Background $cream -Round
  # 前景用圆形构图（和圆形图标同一套画法），启动器再按自身形状裁切
  Save-Icon -Path (Join-Path $dir 'ic_launcher_new_foreground.png') -Size $sizes.Foreground -Scale 0.88 -Background $cream -Round
}

Save-Icon -Path (Join-Path $Root 'shots\icon-512.png') -Size 512 -Scale 0.88 -Background $cream
Save-Icon -Path (Join-Path $Root 'shots\icon-round-512.png') -Size 512 -Scale 0.88 -Background $cream -Round
$crop.Dispose()
Write-Output '图标已生成：mipmap 各密度 + shots/icon-512.png'
