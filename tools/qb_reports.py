#!/usr/bin/env python3
"""Turn QuickBooks Online report exports (.xlsx) into rows for public.finance_snapshots.

Reads: A/R Aging Detail, A/P Aging Detail, Balance Sheet, and Profit and Loss
(cash basis, columns by month). Prints SQL that upserts one snapshot per report.

  python3 -I tools/qb_reports.py file1.xlsx file2.xlsx ... > load.sql
"""
import json, re, sys, datetime
import openpyxl

def num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) else None

def mdy(s):
    try: return datetime.datetime.strptime(str(s).strip(), "%m/%d/%Y").date().isoformat()
    except Exception: return None

def as_of_from(rows):
    # "As of Nov 20, 2026" in row 3, else the export timestamp in the footer
    for r in rows[:4] + rows[-3:]:
        t = str(r[0] or "")
        m = re.search(r"As of ([A-Z][a-z]{2} \d{1,2}, \d{4})", t)
        if m: return datetime.datetime.strptime(m.group(1), "%b %d, %Y").date().isoformat()
        m = re.search(r"([A-Z][a-z]+ \d{1,2}, \d{4}) \d", t)
        if m: return datetime.datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    return datetime.date.today().isoformat()

def aging(rows, who_col_name):
    hdr = next(i for i, r in enumerate(rows) if "Transaction type" in [str(c).strip() if c else "" for c in r])
    cols = {str(c).strip(): j for j, c in enumerate(rows[hdr]) if c}
    items, bucket = [], None
    for r in rows[hdr + 1:]:
        if r[0] and not r[1]:
            t = str(r[0]).strip()
            if not t.startswith("Total") and t != "TOTAL": bucket = t
            continue
        if not r[cols["Date"]]: continue
        items.append({
            "date": mdy(r[cols["Date"]]), "type": r[cols["Transaction type"]], "num": r[cols["Num"]] or "",
            "name": r[cols[who_col_name]] or "", "due": mdy(r[cols["Due date"]]),
            "amount": num(r[cols["Amount"]]), "open": num(r[cols["Open balance"]]), "bucket": bucket,
        })
    return {"items": items, "total": round(sum(i["open"] or 0 for i in items), 2)}

def pnl_monthly(rows):
    hdr = next(i for i, r in enumerate(rows) if r[0] == "" or (r[0] is None and r[1]))
    months = [str(c).strip() for c in rows[hdr][1:] if c]
    lines = {}
    for r in rows[hdr + 1:]:
        if not r[0] or all(v is None for v in r[1:]): continue
        name = str(r[0]).strip()
        vals = [num(v) or 0 for v in r[1:1 + len(months)]]
        if name in lines: name = name + " (all)"   # QuickBooks repeats "Total Cost of Goods Sold"
        lines[name] = vals
    # Keep the lines the dashboard uses, and drop the empty months before the books start
    keep = ["Total Income", "Total Cost of Goods Sold (all)", "Total Expenses", "Net Income", "QuickBooks Payments Fees",
            "Total for Billable Consultants Fees", "Total for Payroll Expense", "Vendor Pest Treatment-Expense", "Plant Material"]
    lines = {k: lines[k] for k in keep if k in lines}
    start = next((i for i in range(len(months)) if any(v[i] for v in lines.values())), 0)
    months = months[start:]
    lines = {k: v[start:] for k, v in lines.items()}
    basis = "cash" if any("Cash Basis" in str(r[0] or "") for r in rows[-3:]) else "accrual"
    return {"months": months, "lines": lines, "basis": basis}

def balance_sheet(rows):
    lines = {}
    for r in rows[5:]:
        if r[0] and isinstance(r[1], (int, float)): lines[str(r[0]).strip()] = num(r[1])
    bank = {k: v for k, v in lines.items() if re.search(r"\(\d{4}\)|checking|savings|bank", k, re.I) and not k.startswith("Total")}
    return {"lines": lines, "bank": bank, "total_bank": lines.get("Total Bank Accounts", round(sum(bank.values()), 2))}

def parse(path):
    ws = openpyxl.load_workbook(path, data_only=True).active
    rows = [list(r) + [None] * 10 for r in ws.iter_rows(values_only=True)]
    title = str(rows[1][0] or "").strip()
    if title.startswith("A/R Aging Detail"): return "ar_detail", as_of_from(rows), aging(rows, "Customer full name")
    if title.startswith("A/P Aging Detail"): return "ap_detail", as_of_from(rows), aging(rows, "Vendor display name")
    if title.startswith("Balance Sheet"): return "balance_sheet", as_of_from(rows), balance_sheet(rows)
    if title.startswith("Profit and Loss"):
        d = pnl_monthly(rows)
        if len(d["months"]) < 3: raise SystemExit(f"{path}: the Profit and Loss needs columns by month")
        return "pnl_monthly", as_of_from(rows), d
    raise SystemExit(f"{path}: not a report the dashboard uses ({title})")

def sql_str(s):
    return "'" + s.replace("'", "''") + "'"

if __name__ == "__main__":
    for p in sys.argv[1:]:
        kind, as_of, data = parse(p)
        print(f"insert into public.finance_snapshots (kind, as_of, data, source) values ({sql_str(kind)}, {sql_str(as_of)}, {sql_str(json.dumps(data))}::jsonb, {sql_str(p.split('/')[-1])})"
              f" on conflict (kind, as_of) do update set data = excluded.data, source = excluded.source, created_at = now();")
