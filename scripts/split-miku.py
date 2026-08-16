# -*- coding: utf-8 -*-
# 纯 Python 连通域分析：把 miku.png 里每个独立角色形象精确切出来
# 二遍扫描 + 并查集（对行程编码 runs 操作，避免逐像素洪泛）
from PIL import Image
import json, os, sys

SRC = r'D:\zcode__coding\miku.png'
ALPHA_TH = 40          # 高阈值切断抗锯齿细丝粘连
MIN_AREA = 4000        # 最小面积（过滤碎屑）
MERGE_PAD = 14         # 相邻框合并距离（双马尾等部件归并到同一形象）

im = Image.open(SRC).convert('RGBA')
W, H = im.size
pix = im.load()

# 1. 每行提取 alpha 行程
rows = []  # rows[y] = [(x0, x1), ...]
for y in range(H):
    runs = []
    x = 0
    a = pix
    row = []
    while x < W:
        if a[x, y][3] > ALPHA_TH:
            x0 = x
            while x < W and a[x, y][3] > ALPHA_TH:
                x += 1
            row.append((x0, x - 1))
        else:
            x += 1
    rows.append(row)

# 2. 并查集
parent = {}
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra

run_id = 0
run_info = []  # (y, x0, x1, label)
prev = []      # 上一行的 (x0, x1, label)
for y in range(H):
    cur = []
    for (x0, x1) in rows[y]:
        lid = run_id
        parent[lid] = lid
        run_id += 1
        # 与上一行重叠的 runs 合并
        for (px0, px1, plabel) in prev:
            if px0 <= x1 and x0 <= px1:  # 行程重叠
                union(lid, plabel)
        cur.append((x0, x1, lid))
    prev = cur
    run_info.extend([(y, r[0], r[1], r[2]) for r in cur])

# 3. 汇总每个连通域的 bbox 与面积
comps = {}  # root -> [x0, y0, x1, y1, area]
for (y, x0, x1, lid) in run_info:
    r = find(lid)
    c = comps.get(r)
    if c is None:
        comps[r] = [x0, y, x1, y, x1 - x0 + 1]
    else:
        c[0] = min(c[0], x0); c[1] = min(c[1], y)
        c[2] = max(c[2], x1); c[3] = max(c[3], y)
        c[4] += x1 - x0 + 1

boxes = [c for c in comps.values() if c[4] >= MIN_AREA]
print(f'连通域(面积>={MIN_AREA}): {len(boxes)} 个')
for b in sorted(boxes, key=lambda c: c[0]):
    print(f'  x{b[0]}-{b[2]} y{b[1]}-{b[3]} ({b[2]-b[0]+1}x{b[3]-b[1]+1}) area={b[4]}')

# 4. 合并相邻框（同一形象的分件：双马尾、飞扬的发梢等）
def merge_boxes(boxes, pad):
    changed = True
    boxes = [list(b) for b in boxes]
    while changed:
        changed = False
        out = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]: continue
            a = boxes[i]
            for j in range(i + 1, len(boxes)):
                b = boxes[j]
                if used[j]: continue
                if (a[0] - pad <= b[2] and b[0] - pad <= a[2] and
                        a[1] - pad <= b[3] and b[1] - pad <= a[3]):
                    a = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]), 0]
                    used[j] = True
                    changed = True
            out.append(a)
        boxes = out
    return boxes

merged = merge_boxes(boxes, MERGE_PAD)
merged = [b for b in merged if (b[2]-b[0]) * (b[3]-b[1]) > 15000]
print(f'\n合并后形象框: {len(merged)} 个')
for i, b in enumerate(sorted(merged, key=lambda c: (c[0]))):
    print(f'  #{i}: x{b[0]}-{b[2]} y{b[1]}-{b[3]} ({b[2]-b[0]+1}x{b[3]-b[1]+1})')

# 5. 导出候选 + 拼贴图
os.makedirs(r'D:\zcode__coding\_miku2', exist_ok=True)
for i, b in enumerate(sorted(merged, key=lambda c: c[0])):
    box = (max(0, b[0]-4), max(0, b[1]-4), min(W, b[2]+5), min(H, b[3]+5))
    im.crop(box).save(rf'D:\zcode__coding\_miku2\f{i}.png')

from PIL import ImageDraw
order = sorted(range(len(merged)), key=lambda i: merged[i][0])
CW, CH, LBL = 300, 300, 40
cols_n = min(4, len(order)) or 1
rows_n = (len(order) + cols_n - 1) // cols_n
sheet = Image.new('RGBA', (cols_n * CW, rows_n * (CH + LBL)), (40, 40, 40, 255))
d = ImageDraw.Draw(sheet)
for idx, i in enumerate(order):
    c = Image.open(rf'D:\zcode__coding\_miku2\f{i}.png')
    c.thumbnail((CW - 10, CH - 10))
    cx, cy = (idx % cols_n) * CW, (idx // cols_n) * (CH + LBL)
    sheet.paste(c, (cx + (CW - c.width) // 2, cy + (CH - c.height) // 2), c)
    d.text((cx + 12, cy + CH + 6), f'#{idx} (f{i})', fill=(255, 255, 80, 255))
sheet.save(r'D:\zcode__coding\_miku2\sheet.png')
print('\nsheet.png 已生成')
