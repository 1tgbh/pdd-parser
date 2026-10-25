#!/usr/bin/env python3
"""生成扩展图标：PDD 红渐变圆角底 + 白色「下载入托盘」字形。
无第三方依赖，直接输出 icons/icon{16,48,128}.png。"""
import struct
import zlib
from pathlib import Path

SS = 4  # 超采样倍数


def _lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size: int) -> bytes:
    S = size * SS
    top = (224, 46, 36)      # #e02e24 PDD 红
    bot = (158, 24, 22)      # 深红渐变
    radius = int(size * 0.22) * SS

    # 字形几何（归一化坐标 -> 像素）
    def px(n):  # 0..1 坐标转像素
        return int(n * S)

    arrow_shaft = (px(.45), px(.28), px(.55), px(.58))   # x0,y0,x1,y1
    arrow_head = [(px(.34), px(.52)), (px(.66), px(.52)), (px(.5), px(.72))]
    tray_bottom = (px(.30), px(.80), px(.70), px(.88))
    tray_left = (px(.30), px(.68), px(.38), px(.80))
    tray_right = (px(.62), px(.68), px(.70), px(.80))

    def in_rect(p, r):
        return r[0] <= p[0] < r[2] and r[1] <= p[1] < r[3]

    def in_tri(p, t):
        (x1, y1), (x2, y2), (x3, y3) = t
        d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if d == 0:
            return False
        a = ((y2 - y3) * (p[0] - x3) + (x3 - x2) * (p[1] - y3)) / d
        b = ((y3 - y1) * (p[0] - x3) + (x1 - x3) * (p[1] - y3)) / d
        c = 1 - a - b
        return a >= 0 and b >= 0 and c >= 0

    def rounded_rect(p):
        x, y = p
        r = radius
        if r <= 0:
            return 0 <= x < S and 0 <= y < S
        if (r <= x < S - r) or (r <= y < S - r):
            return 0 <= x < S and 0 <= y < S
        for cx, cy in ((r, r), (S - r, r), (r, S - r), (S - r, S - r)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                return True
        return False

    # 超采样渲染
    acc = [[0.0] * (size * 3) for _ in range(size)]
    for y in range(S):
        for x in range(S):
            if not rounded_rect((x, y)):
                continue
            base = _lerp(top, bot, y / max(1, S - 1))
            p = (x, y)
            if in_rect(p, arrow_shaft) or in_tri(p, arrow_head) or \
               in_rect(p, tray_bottom) or in_rect(p, tray_left) or in_rect(p, tray_right):
                col = (255, 255, 255)
            else:
                col = base
            fx, fy = x // SS, y // SS
            w = 1.0 / (SS * SS)
            for i in range(3):
                acc[fy][fx * 3 + i] += col[i] * w  # 平面存储通道

    # 组装 PNG scanlines
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        row = acc[y]
        for x in range(size):
            raw += bytes(int(round(v)) for v in row[x * 3:x * 3 + 3]) + b'\xff'

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    out = Path(__file__).parent / 'icons'
    out.mkdir(exist_ok=True)
    for s in (16, 48, 128):
        (out / f'icon{s}.png').write_bytes(make_icon(s))
        print(f'icons/icon{s}.png written')
