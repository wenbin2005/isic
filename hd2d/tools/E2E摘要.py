# 把 E2E驗收.cjs 輸出的 結果.json 轉成 markdown 表格（逐項結果＋效能數據）
# 用法：python hd2d/tools/E2E摘要.py <輸出資料夾>/結果.json
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
    if r['pass'] and r.get('detail') is not None:
        note = json.dumps(r['detail'], ensure_ascii=False)[:160]
    print(f"| {r['name']} | {'通過' if r['pass'] else '**失敗**'} | {r['seconds']:.1f} | {note.replace('|', '/')} |")
print('\n| 場景 | 畫質 | FPS | 每幀繪製次數 |')
print('|---|---|---|---|')
for p in data.get('perf', []):
    print(f"| {p['label']} | {'精緻' if p['quality'] == 'high' else '流暢'} | {p['fps']} | {p['calls']} |")
