param(
  [string]$Source = 'C:\Users\skmh\AppData\Local\Temp\codex-clipboard-1cabea8d-c3ab-4a7f-ba08-d1f02ec791b8.png',
  [string]$Root = 'D:\Codex\expiry-keeper'
)

Add-Type -AssemblyName System.Drawing

# 源图右下角有「豆包 AI 生成」水印：裁掉底部，取 356x356 正方形
$image = [System.Drawing.Image]::FromFile($Source)
$cropRect = New-Object System.Drawing.Rectangle 14, 0, 356, 356
$crop = New-Object System.Drawing.Bitmap 356, 356
$cg = [System.Drawing.Graphics]::FromImage($crop)
$cg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cg.DrawImage($image, (New-Object System.Drawing.Rectangle 0, 0, 356, 356), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$cg.Dispose()
$image.Dispose()

$cream = [System.Drawing.Color]::FromArgb(255, 253, 246, 231)

function New-Icon {
  param(
    [string]$Path,
    [int]$Size,
    [double]$Scale,          # 照片占画布的比例
    [switch]$Transparent,    # 前景层：透明底
    [switch]$RoundCanvas     # 整个画布裁成圆（legacy round icon）
  )
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($RoundCanvas) {
    # 圆角画布：底透明 + 奶白填圆；Clear 会无视裁剪区，所以必须用 FillEllipse
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush $cream
    $g.FillEllipse($brush, 0, 0, ($Size - 1), ($Size - 1))
    $brush.Dispose()
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddEllipse(0, 0, $Size, $Size)
    $g.SetClip($clip, [System.Drawing.Drawing2D.CombineMode]::Intersect)
  } else {
    $g.Clear($(if ($Transparent) { [System.Drawing.Color]::Transparent } else { $cream }))
  }

  $side = [int][math]::Round($Size * $Scale)
  $offset = [int][math]::Round(($Size - $side) / 2)

  # 照片裁圆，避免出现方形硬边
  $photoClip = New-Object System.Drawing.Drawing2D.GraphicsPath
  $photoClip.AddEllipse($offset, $offset, $side, $side)
  $g.SetClip($photoClip, [System.Drawing.Drawing2D.CombineMode]::Intersect)

  $g.DrawImage($crop, (New-Object System.Drawing.Rectangle $offset, $offset, $side, $side))

  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

# 108dp 画布的可视区约 72dp；内容压在 66dp 安全区内 => 0.60
$densities = [ordered]@{
  'mdpi'    = @{ Icon = 48;  Foreground = 108 }
  'hdpi'    = @{ Icon = 72;  Foreground = 162 }
  'xhdpi'   = @{ Icon = 96;  Foreground = 216 }
  'xxhdpi'  = @{ Icon = 144; Foreground = 324 }
  'xxxhdpi' = @{ Icon = 192; Foreground = 432 }
}

foreach ($d in $densities.Keys) {
  $s = $densities[$d]
  $dir = Join-Path $Root "android\app\src\main\res\mipmap-$d"
  New-Icon -Path (Join-Path $dir 'ic_launcher_cat.png')            -Size $s.Icon       -Scale 0.86
  New-Icon -Path (Join-Path $dir 'ic_launcher_cat_round.png')      -Size $s.Icon       -Scale 0.86 -RoundCanvas
  New-Icon -Path (Join-Path $dir 'ic_launcher_cat_foreground.png') -Size $s.Foreground -Scale 0.60 -Transparent
}

# 预览图，方便肉眼核对
New-Icon -Path (Join-Path $Root 'shots\cat-icon-512.png')       -Size 512 -Scale 0.86
New-Icon -Path (Join-Path $Root 'shots\cat-icon-round-512.png') -Size 512 -Scale 0.86 -RoundCanvas
New-Icon -Path (Join-Path $Root 'shots\cat-icon-fg-432.png')    -Size 432 -Scale 0.60 -Transparent

$crop.Dispose()
Write-Output 'ok: ic_launcher_cat (legacy square / round / adaptive foreground 0.60)'
