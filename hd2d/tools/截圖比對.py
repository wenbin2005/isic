# 逐像素比對兩組固定時間截圖（tools/固定時間截圖.cjs 的輸出），需要 Pillow 與 numpy
# 用法：python hd2d/tools/截圖比對.py <A 資料夾> <B 資料夾> <輸出 json> [差異圖資料夾]
import json
import os
import sys

import numpy as np
from PIL import Image

a_dir, b_dir, out_json = sys.argv[1:4]
diff_dir = sys.argv[4] if len(sys.argv) > 4 else None
rows = []
for name in sorted(f for f in os.listdir(a_dir) if f.endswith('.png')):
    a = np.asarray(Image.open(os.path.join(a_dir, name)).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(os.path.join(b_dir, name)).convert('RGB')).astype(np.int16)
    d = np.abs(a - b)
    px = d.max(axis=2)
    row = {'scene': name[:-4], 'size': f'{a.shape[1]}x{a.shape[0]}', 'pixels': int(px.size),
           'diffPixels': int((px > 0).sum()), 'diffOver1': int((px > 1).sum()), 'maxDiff': int(px.max()),
           'meanDiff': round(float(d.mean()), 5), 'meanLumaA': round(float(a.mean()), 3), 'meanLumaB': round(float(b.mean()), 3)}
    rows.append(row)
    print(f"{row['scene']}：不同像素 {row['diffPixels']}／{row['pixels']}，差超過 1 階 {row['diffOver1']}，最大差 {row['maxDiff']} 階，平均差 {row['meanDiff']}")
    if diff_dir:
        os.makedirs(diff_dir, exist_ok=True)
        # 差異圖：有差的像素依差值放大（×40，上限 255），沒差的是黑色
        Image.fromarray(np.clip(px * 40, 0, 255).astype(np.uint8)).save(os.path.join(diff_dir, f'{row["scene"]}-差異.png'))
json.dump(rows, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
