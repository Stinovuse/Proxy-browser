"""Картинки установщика S Browser (NSIS): боковая панель и шапка. Запуск: python tools/make_installer_art.py"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
ICON = Image.open(os.path.join(BUILD, 'icon.png')).convert('RGBA')
FONTS = '/usr/share/fonts/truetype/google-fonts'
BOLD = os.path.join(FONTS, 'Poppins-Bold.ttf')
REG = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'
if not os.path.exists(REG):
    REG = os.path.join(FONTS, 'Poppins-Regular.ttf')
BG = (11, 13, 20)       # = MUI_BGCOLOR 0B0D14
SS = 4                  # суперсэмплинг для гладких краёв

def glow(size, center, radius, color, alpha):
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = center
    d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.55))

def stars(img, n, seed):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    w, h = img.size
    for _ in range(n):
        x, y = rnd.randrange(w), rnd.randrange(h)
        a = rnd.randint(40, 140)
        r = rnd.choice([1, 1, 1, 2]) * SS // 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=(220, 225, 255, a))

def text_center(d, cx, y, s, font, fill):
    b = d.textbbox((0, 0), s, font=font)
    d.text((cx - (b[2] - b[0]) / 2 - b[0], y), s, font=font, fill=fill)

def gradient_text(img, cx, y, s, font):
    mask = Image.new('L', img.size, 0)
    md = ImageDraw.Draw(mask)
    b = md.textbbox((0, 0), s, font=font)
    md.text((cx - (b[2] - b[0]) / 2 - b[0], y), s, font=font, fill=255)
    grad = Image.new('RGBA', img.size)
    gp = grad.load()
    x0, x1 = cx - (b[2] - b[0]) / 2, cx + (b[2] - b[0]) / 2
    stops = [(167, 139, 250), (96, 165, 250), (34, 211, 238)]
    for x in range(img.size[0]):
        t = min(1, max(0, (x - x0) / max(1, x1 - x0)))
        c = [int(stops[0][i] + (stops[1][i] - stops[0][i]) * t * 2) for i in range(3)] if t < .5 else \
            [int(stops[1][i] + (stops[2][i] - stops[1][i]) * (t - .5) * 2) for i in range(3)]
        for y2 in range(img.size[1]):
            gp[x, y2] = tuple(c) + (255,)
    img.paste(grad, (0, 0), mask)

def sidebar(lines, seed, path):
    W, H = 164 * SS, 314 * SS
    img = Image.new('RGBA', (W, H), BG + (255,))
    img = Image.alpha_composite(img, glow((W, H), (int(W * .1), int(H * .12)), 90 * SS, (139, 92, 246), 120))
    img = Image.alpha_composite(img, glow((W, H), (int(W * .95), int(H * .9)), 80 * SS, (6, 214, 224), 90))
    img = Image.alpha_composite(img, glow((W, H), (W // 2, int(H * .36)), 46 * SS, (59, 130, 246), 150))
    stars(img, 70, seed)
    # орбита вокруг иконки
    orbit = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(orbit)
    cx, cy = W // 2, int(H * .36)
    od.ellipse((cx - 62 * SS, cy - 22 * SS, cx + 62 * SS, cy + 22 * SS), outline=(167, 139, 250, 90), width=SS)
    orbit = orbit.rotate(-18, center=(cx, cy), resample=Image.BICUBIC)
    img = Image.alpha_composite(img, orbit)
    ic = ICON.resize((84 * SS, 84 * SS), Image.LANCZOS)
    img.alpha_composite(ic, (cx - ic.width // 2, cy - ic.height // 2))
    d = ImageDraw.Draw(img)
    gradient_text(img, W // 2, int(H * .56), 'S Browser', ImageFont.truetype(BOLD, 21 * SS))
    d = ImageDraw.Draw(img)
    # тонкая градиентная линия
    for x in range(W // 2 - 26 * SS, W // 2 + 26 * SS):
        t = (x - (W // 2 - 26 * SS)) / (52 * SS)
        c = (int(167 + (34 - 167) * t), int(139 + (211 - 139) * t), int(250 + (238 - 250) * t), 220)
        d.line((x, int(H * .665), x, int(H * .665) + SS), fill=c)
    f = ImageFont.truetype(REG, 10 * SS)
    y = int(H * .70)
    for ln in lines:
        text_center(d, W // 2, y, ln, f, (176, 182, 204, 255))
        y += 14 * SS
    small = img.resize((164, 314), Image.LANCZOS).convert('RGB')
    small.save(path, 'BMP')
    return small

def header(path):
    W, H = 150 * SS, 57 * SS
    img = Image.new('RGBA', (W, H), BG + (255,))
    img = Image.alpha_composite(img, glow((W, H), (int(W * .8), H // 2), 50 * SS, (139, 92, 246), 110))
    img = Image.alpha_composite(img, glow((W, H), (W, 0), 40 * SS, (6, 214, 224), 80))
    stars(img, 18, 7)
    ic = ICON.resize((40 * SS, 40 * SS), Image.LANCZOS)
    img.alpha_composite(ic, (W - ic.width - 10 * SS, (H - ic.height) // 2))
    small = img.resize((150, 57), Image.LANCZOS).convert('RGB')
    small.save(path, 'BMP')
    return small

if __name__ == '__main__':
    a = sidebar(['Приватный браузер', 'через ваш прокси'], 1, os.path.join(BUILD, 'installerSidebar.bmp'))
    b = sidebar(['Спасибо, что были', 'с нами'], 2, os.path.join(BUILD, 'uninstallerSidebar.bmp'))
    c = header(os.path.join(BUILD, 'installerHeader.bmp'))
    print('ok', a.size, b.size, c.size)
