param($out, $size)
Add-Type -AssemblyName System.Drawing
$S = 512
$bmp = New-Object Drawing.Bitmap $S,$S
$g = [Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode='AntiAlias'; $g.InterpolationMode='HighQualityBicubic'; $g.PixelOffsetMode='HighQuality'
function P($x,$y){ New-Object Drawing.PointF $x,$y }
# rounded-square background, diagonal ember gradient
$r = 112; $bg = New-Object Drawing.Drawing2D.GraphicsPath
$bg.AddArc(0,0,$r*2,$r*2,180,90); $bg.AddArc($S-$r*2,0,$r*2,$r*2,270,90); $bg.AddArc($S-$r*2,$S-$r*2,$r*2,$r*2,0,90); $bg.AddArc(0,$S-$r*2,$r*2,$r*2,90,90); $bg.CloseFigure()
$grad = New-Object Drawing.Drawing2D.LinearGradientBrush (P 0 0),(P $S $S),([Drawing.Color]::FromArgb(255,255,150,20)),([Drawing.Color]::FromArgb(255,214,32,40))
$blend = New-Object Drawing.Drawing2D.ColorBlend 3
$blend.Colors = @([Drawing.Color]::FromArgb(255,255,170,40),[Drawing.Color]::FromArgb(255,255,96,10),[Drawing.Color]::FromArgb(255,200,28,48)); $blend.Positions = @(0.0,0.5,1.0)
$grad.InterpolationColors = $blend
$g.FillPath($grad,$bg)
# soft inner glow at bottom
$glow = New-Object Drawing.Drawing2D.GraphicsPath; $glow.AddEllipse(56,250,400,300)
$pg = New-Object Drawing.Drawing2D.PathGradientBrush $glow; $pg.CenterColor=[Drawing.Color]::FromArgb(110,255,230,140); $pg.SurroundColors=@([Drawing.Color]::FromArgb(0,255,230,140))
$g.SetClip($bg); $g.FillPath($pg,$glow); $g.ResetClip()
# flame with play-triangle cut-out
$f = New-Object Drawing.Drawing2D.GraphicsPath ([Drawing.Drawing2D.FillMode]::Alternate)
$f.AddBezier((P 256 446),(P 168 446),(P 112 386),(P 112 312))
$f.AddBezier((P 112 312),(P 112 238),(P 162 196),(P 186 128))
$f.AddBezier((P 186 128),(P 204 170),(P 222 194),(P 244 206))
$f.AddBezier((P 244 206),(P 238 148),(P 266 90),(P 322 56))
$f.AddBezier((P 322 56),(P 308 122),(P 338 166),(P 366 198))
$f.AddBezier((P 366 198),(P 392 228),(P 400 268),(P 400 312))
$f.AddBezier((P 400 312),(P 400 386),(P 344 446),(P 256 446))
$f.CloseFigure()
$f.AddPolygon(@((P 226 284),(P 226 386),(P 314 335)))
# drop shadow
$shadow = $f.Clone(); $m = New-Object Drawing.Drawing2D.Matrix; $m.Translate(0,10); $shadow.Transform($m)
$g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(60,90,10,0))),$shadow)
$white = New-Object Drawing.Drawing2D.LinearGradientBrush (P 0 56),(P 0 446),([Drawing.Color]::FromArgb(255,255,255,255)),([Drawing.Color]::FromArgb(255,255,240,214))
$g.FillPath($white,$f)
$g.Dispose()
$final = New-Object Drawing.Bitmap $size,$size
$g2 = [Drawing.Graphics]::FromImage($final); $g2.InterpolationMode='HighQualityBicubic'; $g2.SmoothingMode='AntiAlias'; $g2.PixelOffsetMode='HighQuality'
$g2.DrawImage($bmp,0,0,$size,$size); $g2.Dispose()
$final.Save($out,[Drawing.Imaging.ImageFormat]::Png); $final.Dispose(); $bmp.Dispose()
