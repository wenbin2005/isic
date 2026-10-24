# 把 E2E驗收.cjs 的 結果.json 轉成 markdown 表格（逐項結果＋四景數據）。用法：python E2E摘要.py <輸出資料夾>/結果.json
import json
import sys

data = json.load(open(sys.argv[1], encoding='utf-8'))
rows = data['results']
passed = sum(r['pass'] for r in rows)
print(f"時間 {data['time']}；GPU {data.get('gpu')}")
print(f"合計 {len(rows)} 項，通過 {passed}，失敗 {len(rows) - passed}\n")
print('| 項目 | 結果 | 秒 | 備註 |')
print('|---|---|---|---|')
for r in rows:
    note = r.get('error', '') if not r['pass'] else ''
    if r['pass'] and isinstance(r.get('detail'), dict):
        d = r['detail']
        keep = {k: v for k, v in d.items() if k not in ('moves',)}
        note = json.dumps(keep, ensure_ascii=False)[:160]
    print(f"| {r['name']} | {'通過' if r['pass'] else '**失敗**'} | {r['seconds']:.1f} | {note.replace('|', '/')} |")
print('\n| 管線／景 | FPS | draw calls | 三角形 |')
print('|---|---|---|---|')
for r in rows:
    d = r.get('detail')
    if r['pass'] and isinstance(d, dict) and 'moves' in d and 'fps' in d:
        print(f"| {r['name'].split('：')[0]} | {d['fps']} | {d['drawCalls']} | {d['triangles']:,} |")
