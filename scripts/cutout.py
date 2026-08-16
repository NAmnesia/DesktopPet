# -*- coding: utf-8 -*-
# 白底抠图 v1（恢复版）：仅删除与边框连通的白色背景 + 边缘白度羽化
# 主体 100% 保留（含内部的白色/亮部），代价是发丝间封闭白色保留
import cv2
import numpy as np
from collections import deque
from PIL import Image

WHITE_TH = 233

def flood_background(img):
    """与边框连通的近白区域"""
    h, w = img.shape[:2]
    near_white = (img >= WHITE_TH).all(axis=2)
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))
    return bg

def remove_white(src):
    img = cv2.imread(src)  # BGR
    h, w = img.shape[:2]
    bg = flood_background(img)

    # 边缘带羽化：背景膨胀带内按最深通道渐变，消除 JPEG 白边；带外主体全保留
    band = cv2.dilate((bg * 255).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    minc = img.min(axis=2).astype(np.float32)
    wf = np.clip((WHITE_TH - minc) / (WHITE_TH - 170.0), 0, 1)
    alpha = np.ones((h, w), np.float32)
    alpha[bg] = 0.0
    band_only = band & ~bg
    alpha[band_only] = wf[band_only]

    rgba = np.dstack([img[:, :, ::-1], (alpha * 255).astype(np.uint8)])
    im = Image.fromarray(rgba, 'RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        pad = 4
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))
    return im, bg.mean()

if __name__ == '__main__':
    import os
    dst = r'D:\zcode__coding\desktop-pet\assets\characters\miku'
    SIZE = 640
    im1, p1 = remove_white(r'D:\zcode__coding\1.jpg')
    print('1.jpg 背景占比 %.0f%%，抠后 %s' % (p1 * 100, im1.size))
    im1.thumbnail((SIZE, SIZE), Image.LANCZOS)
    im1.save(os.path.join(dst, 'idle.png'))
    im1.save(os.path.join(dst, 'drag.png'))
    im2, p2 = remove_white(r'D:\zcode__coding\2.jpg')
    print('2.jpg 背景占比 %.0f%%，抠后 %s' % (p2 * 100, im2.size))
    im2.thumbnail((SIZE, SIZE), Image.LANCZOS)
    im2.save(os.path.join(dst, 'talk.png'))
    print('done')
