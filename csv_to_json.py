"""
使用方式：
  python csv_to_json.py 多方.csv 空方.csv

會自動產生 stocks.json，直接上傳即可。
股票名稱會從證交所自動抓取。
"""

import csv
import json
import sys
import ssl
import urllib.request

def fetch_stock_names():
    """從證交所抓所有股票代號對應名稱"""
    url = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as res:
            raw = res.read()
            data = json.loads(raw.decode("utf-8"))
            return {item["Code"]: item["Name"] for item in data}
    except Exception as e:
        print(f"[警告] 無法抓取股票名稱：{e}，名稱欄位將留空")
        return {}

def read_csv(path):
    """讀取 CSV，取第一欄股號，去掉 .TW 後綴"""
    ids = []
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if row and row[0].strip():
                sid = row[0].strip().replace(".TW", "").replace(".TWO", "")
                ids.append(sid)
    return ids

def build_entries(ids, name_map):
    return [{"id": sid, "name": name_map.get(sid, "")} for sid in ids]

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("用法：python csv_to_json.py 多方.csv 空方.csv")
        sys.exit(1)

    long_csv  = sys.argv[1]
    short_csv = sys.argv[2]

    print("抓取股票名稱中...")
    name_map = fetch_stock_names()

    long_ids  = read_csv(long_csv)
    short_ids = read_csv(short_csv)

    result = {
        "long":  build_entries(long_ids,  name_map),
        "short": build_entries(short_ids, name_map)
    }

    with open("stocks.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"完成！多方 {len(long_ids)} 支，空方 {len(short_ids)} 支 → stocks.json")
