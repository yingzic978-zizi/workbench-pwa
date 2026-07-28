# -*- coding: utf-8 -*-
"""「喵霸天」图标：紫色反派渐变底 + 恶魔角坏笑小猫（4x 超采样抗锯齿）"""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))
S = 2048  # 4x 画布，最后缩小


def gradient(size, c1=(91, 61, 240), c2=(178, 77, 240)):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t0 = y / size
        for x in range(size):
            t = (x / size + t0) / 2
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def P(*pts):  # 512 坐标 -> 2048
    return [(x * 4, y * 4) for x, y in pts]


def B(x0, y0, x1, y1):
    return [x0 * 4, y0 * 4, x1 * 4, y1 * 4]


img = gradient(S)
d = ImageDraw.Draw(img)

WHITE = (255, 250, 252)
PINK = (255, 179, 199)
RED = (255, 77, 109)
BLACK = (43, 34, 60)

# 星星点缀
for (x, y, r) in [(70, 90, 7), (444, 96, 9), (56, 400, 6), (452, 380, 7), (100, 250, 4), (420, 240, 4)]:
    d.ellipse(B(x - r, y - r, x + r, y + r), fill=(255, 255, 255))

# 猫耳（白）+ 内耳（粉）
d.polygon(P((140, 235), (108, 92), (255, 172)), fill=WHITE)
d.polygon(P((372, 235), (404, 92), (257, 172)), fill=WHITE)
d.polygon(P((152, 215), (132, 122), (228, 176)), fill=PINK)
d.polygon(P((360, 215), (380, 122), (284, 176)), fill=PINK)

# 恶魔角（红）
d.polygon(P((205, 165), (176, 72), (248, 150)), fill=RED)
d.polygon(P((307, 165), (336, 72), (264, 150)), fill=RED)

# 脸
d.ellipse(B(106, 152, 406, 432), fill=WHITE)

# 坏坏的眉毛（内高外低的斜眉）
d.line(P((165, 252), (215, 268)), fill=BLACK, width=9 * 4)
d.line(P((347, 252), (297, 268)), fill=BLACK, width=9 * 4)

# 眼睛 + 高光
d.ellipse(B(184, 284, 218, 318), fill=BLACK)
d.ellipse(B(294, 284, 328, 318), fill=BLACK)
d.ellipse(B(206, 290, 216, 300), fill=(255, 255, 255))
d.ellipse(B(316, 290, 326, 300), fill=(255, 255, 255))

# 腮红
d.ellipse(B(142, 330, 194, 360), fill=PINK)
d.ellipse(B(318, 330, 370, 360), fill=PINK)

# ω 嘴（两个小 u）
d.arc(B(222, 320, 256, 350), start=0, end=180, fill=BLACK, width=8 * 4)
d.arc(B(256, 320, 290, 350), start=0, end=180, fill=BLACK, width=8 * 4)

# 小尖牙
d.polygon(P((238, 336), (256, 336), (247, 358)), fill=(255, 255, 255), outline=BLACK, width=3 * 4)

# 胡须
for (a, b_) in [((90, 300), (140, 306)), ((92, 336), (142, 334)),
                ((422, 300), (372, 306)), ((420, 336), (370, 334))]:
    d.line(P(a, b_), fill=(255, 255, 255), width=6 * 4)

for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png")]:
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), "PNG")
    print("saved", name)
