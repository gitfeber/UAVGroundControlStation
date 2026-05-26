# Generates installer BMP assets for NSIS (.exe) and WiX/MSI (.msi).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$bg = [System.Drawing.Color]::FromArgb(2, 6, 23)
$panel = [System.Drawing.Color]::FromArgb(8, 13, 18)
$cyan = [System.Drawing.Color]::FromArgb(34, 211, 238)
$cyanDark = [System.Drawing.Color]::FromArgb(12, 74, 92)
$text = [System.Drawing.Color]::FromArgb(224, 242, 254)
$textDim = [System.Drawing.Color]::FromArgb(148, 163, 184)

function New-Bitmap([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    return @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Bmp($bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
}

function Draw-BrandedPanel {
    param(
        [System.Drawing.Graphics]$g,
        [int]$w,
        [int]$h,
        [int]$accentWidth = 12
    )
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $bg), 0, 0, $w, $h)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $cyan), 0, 0, $accentWidth, $h)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $panel), $accentWidth, 0, $w, $h)
    $g.DrawLine((New-Object System.Drawing.Pen $cyanDark, 1), ($accentWidth + 8), [int]($h * 0.42), ($w - 8), [int]($h * 0.42))

    $fontTitle = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
    $fontSub = [System.Drawing.Font]::new('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $fontMeta = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Regular)
    $brushText = New-Object System.Drawing.SolidBrush $text
    $brushCyan = New-Object System.Drawing.SolidBrush $cyan
    $brushDim = New-Object System.Drawing.SolidBrush $textDim

    $x = $accentWidth + 14
    $g.DrawString('UAV', $fontTitle, $brushCyan, $x, [int]($h * 0.14))
    $g.DrawString('GROUND', $fontSub, $brushText, $x, [int]($h * 0.28))
    $g.DrawString('CONTROL', $fontSub, $brushText, $x, [int]($h * 0.36))
    $g.DrawString('', $fontMeta, $brushDim, $x, [int]($h * 0.52))
    $g.DrawString('LOCAL GCS', $fontMeta, $brushDim, $x, [int]($h * 0.58))
}

function Draw-Header {
    $w = 150; $h = 57
    $ctx = New-Bitmap $w $h
    $g = $ctx.Graphics
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $bg), 0, 0, $w, $h)
    $g.DrawLine((New-Object System.Drawing.Pen $cyan, 3), 0, ($h - 2), $w, ($h - 2))

    $fontTitle = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
    $fontSub = [System.Drawing.Font]::new('Segoe UI', 8, [System.Drawing.FontStyle]::Regular)
    $g.DrawString('UAV', $fontTitle, (New-Object System.Drawing.SolidBrush $text), 10, 10)
    $g.DrawString('GROUND CONTROL', $fontSub, (New-Object System.Drawing.SolidBrush $cyan), 10, 32)

    Save-Bmp $ctx.Bitmap (Join-Path $dir 'header.bmp')
    $ctx.Graphics.Dispose(); $ctx.Bitmap.Dispose()
}

function Draw-Sidebar {
    $w = 164; $h = 314
    $ctx = New-Bitmap $w $h
    Draw-BrandedPanel -g $ctx.Graphics -w $w -h $h -accentWidth 10
    Save-Bmp $ctx.Bitmap (Join-Path $dir 'sidebar.bmp')
    $ctx.Graphics.Dispose(); $ctx.Bitmap.Dispose()
}

function Draw-WixBanner {
    $w = 493; $h = 58
    $ctx = New-Bitmap $w $h
    $g = $ctx.Graphics
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $bg), 0, 0, $w, $h)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $cyan), 0, ($h - 4), $w, $h)

    $fontTitle = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
    $fontSub = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Regular)
    $g.DrawString('UAV GROUND CONTROL STATION', $fontTitle, (New-Object System.Drawing.SolidBrush $text), 16, 10)
    $g.DrawString('Local UAV GCS', $fontSub, (New-Object System.Drawing.SolidBrush $cyan), 16, 34)

    Save-Bmp $ctx.Bitmap (Join-Path $dir 'wix-banner.bmp')
    $ctx.Graphics.Dispose(); $ctx.Bitmap.Dispose()
}

function Draw-WixDialog {
    $w = 493; $h = 312
    $ctx = New-Bitmap $w $h
    Draw-BrandedPanel -g $ctx.Graphics -w $w -h $h -accentWidth 14
    Save-Bmp $ctx.Bitmap (Join-Path $dir 'wix-dialog.bmp')
    $ctx.Graphics.Dispose(); $ctx.Bitmap.Dispose()
}

Draw-Header
Draw-Sidebar
Draw-WixBanner
Draw-WixDialog
Write-Host "Wrote NSIS + WiX BMPs to $dir"
