"""Smart reorder (from NCG): Stock Planning (min / max / reorder), Supplier Visits, supplier-wise Smart Reorder -> draft PO, planning reports.
Permissions: Purchase Order module (view / edit / create / export), plus the user's outlets and categories on every query."""
import io
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

import openpyxl
import openpyxl.styles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import reorder_service as rs

router = APIRouter(prefix="/reorder", tags=["smart reorder"], dependencies=[Depends(get_current_user)])

# column -> (Excel / screen label, type)
FIELDS = {"min_stock": ("Minimum Stock", "num"), "max_stock_level": ("Maximum Stock", "num"), "reorder_level": ("Reorder Level", "num"),
          "fixed_margin_percent": ("Fixed Margin %", "pct"), "supplier_visit_days": ("Supplier Visit Days", "int"),
          "safety_stock_days": ("Safety Stock Days", "int"), "lead_time_days": ("Lead Time Days", "int")}
NOT_NULL = ("min_stock", "max_stock_level", "reorder_level")


def _clean(field: str, raw) -> tuple[bool, Optional[float]]:
    """(valid, value); blank is valid and means empty."""
    s = str(raw if raw is not None else "").strip()
    if s == "":
        return True, None
    try:
        v = float(s)
    except ValueError:
        return False, None
    t = FIELDS[field][1]
    if v < 0 or (t == "pct" and v > 100):
        return False, None
    return True, int(round(v)) if t == "int" else round(v, 3)


def _same(a, b) -> bool:
    return (a is None) == (b is None) and (a is None or abs(float(a) - float(b)) < 0.0005)


def _xlsx(name: str, head: list, rows: list) -> StreamingResponse:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(head)
    for c in ws[1]:
        c.font = openpyxl.styles.Font(bold=True)
    for r in rows:
        ws.append([float(v) if isinstance(v, Decimal) else v for v in r])
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}_{rs.today():%Y%m%d}.xlsx"'})


def _j(v):
    return float(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, date) else v


@router.get("/filters")
async def filters(db: AsyncSession = Depends(get_db)):
    p: dict = {}
    outlets = (await db.execute(text("SELECT id, outlet_name AS name FROM outlets WHERE COALESCE(is_active, TRUE)" + access.outlet_filter("id", p) + " ORDER BY outlet_name"), p)).mappings().all()
    q: dict = {}
    pf = access.product_filter("p", q)
    return {"outlets": [dict(r) for r in outlets],
            "suppliers": [dict(r) for r in (await db.execute(text("""SELECT s.id, s.name, v.next_visit_date FROM suppliers s
                LEFT JOIN supplier_visit_schedules v ON v.supplier_id = s.id WHERE s.status ORDER BY s.name"""))).mappings()],
            "categories": [r[0] for r in (await db.execute(text(f"SELECT DISTINCT p.category FROM products p WHERE p.is_active AND COALESCE(p.category, '') <> ''{pf} ORDER BY 1"), q)).all()],
            "brands": [r[0] for r in (await db.execute(text(f"SELECT DISTINCT p.brand FROM products p WHERE p.is_active AND COALESCE(p.brand, '') <> ''{pf} ORDER BY 1"), q)).all()],
            "buyers": [dict(r) for r in (await db.execute(text("SELECT id, name FROM users WHERE status ORDER BY name"))).mappings()],
            "sales_days": rs.SALES_DAYS}


# ── Stock Planning ────────────────────────────────────────────────────────────
async def _items(db, supplier_id, category, brand, q, flag, limit: int = 0) -> list[dict]:
    p: dict = {}
    w = ["p.is_active"]
    if supplier_id:
        p["sid"] = supplier_id
        w.append("""(p.supplier_id = :sid OR p.id IN (SELECT x.product_id FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id WHERE u.supplier_id = :sid))""")
    if category:
        w.append("p.category = :cat")
        p["cat"] = category
    if brand:
        w.append("p.brand = :brand")
        p["brand"] = brand
    for n, word in enumerate((q or "").split()[:6]):
        p[f"w{n}"] = f"%{word}%"
        w.append(f"(p.name ILIKE :w{n} OR p.item_code ILIKE :w{n})")
    stk = rs.stock_sql(None, p)
    if flag == "below_min":
        w.append(f"p.min_stock > 0 AND {stk} < p.min_stock")
    elif flag == "below_reorder":
        w.append(f"p.reorder_level > 0 AND {stk} <= p.reorder_level")
    elif flag == "above_max":
        w.append(f"p.max_stock_level > 0 AND {stk} > p.max_stock_level")
    elif flag == "not_set":
        w.append("COALESCE(p.max_stock_level, 0) = 0 AND COALESCE(p.reorder_level, 0) = 0 AND p.fixed_margin_percent IS NULL")
    sql = f"""SELECT p.id, p.item_code, p.name, p.category, p.brand, p.mrp, p.supplier_id, {stk} AS stock, COALESCE(p.min_stock, 0) AS min_stock,
            COALESCE(p.max_stock_level, 0) AS max_stock_level, COALESCE(p.reorder_level, 0) AS reorder_level, p.fixed_margin_percent,
            p.supplier_visit_days, p.safety_stock_days, p.lead_time_days,
            COALESCE(s.name, (SELECT s2.name FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id JOIN suppliers s2 ON s2.id = u.supplier_id
                              WHERE x.product_id = p.id ORDER BY u.id DESC LIMIT 1)) AS supplier
        FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE {' AND '.join(w)}{access.product_filter('p', p)} ORDER BY p.name""" + (f" LIMIT {int(limit)}" if limit else "")
    return [{k: _j(v) for k, v in r.items()} for r in (await db.execute(text(sql), p)).mappings()]


@router.get("/planning")
async def planning(supplier_id: Optional[int] = None, category: str = "", brand: str = "", q: str = "", flag: str = "", db: AsyncSession = Depends(get_db)):
    rows = await _items(db, supplier_id, category, brand, q, flag, 500)
    return {"rows": rows, "capped": len(rows) >= 500}


async def _set(db, pid: int, changes: dict, old: dict, source: str, user_id: int):
    """Apply + audit. Minimum also drives the existing low-stock alert."""
    sets = dict(changes)
    if sets.get("min_stock"):
        import math
        sets["low_stock_threshold"] = max(1, math.ceil(sets["min_stock"]))
    await db.execute(text("UPDATE products SET " + ", ".join(f"{c} = :{c}" for c in sets) + " WHERE id = :pid"), {**sets, "pid": pid})
    await db.execute(text("""INSERT INTO product_planning_log (product_id, field_name, old_value, new_value, source, changed_by)
        VALUES (:p, :f, :o, :n, :s, :u)"""), [{"p": pid, "f": f, "o": None if old.get(f) is None else str(old[f]), "n": None if v is None else str(v), "s": source, "u": user_id}
                                              for f, v in changes.items()])


class save_in(BaseModel):
    id: int
    field: str
    value: Optional[str] = None


@router.put("/planning/save")
async def planning_save(b: save_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if b.field not in FIELDS:
        raise HTTPException(400, "Unknown field.")
    ok, v = _clean(b.field, b.value)
    if not ok:
        raise HTTPException(400, "Enter a valid number (fixed margin 0–100).")
    if v is None and b.field in NOT_NULL:
        v = 0
    await access.check_products(db, [b.id])
    old = (await db.execute(text(f"SELECT {b.field} FROM products WHERE id = :i FOR UPDATE"), {"i": b.id})).mappings().first()
    if not old:
        raise HTTPException(404, "Item not found.")
    if not _same(old[b.field], v):
        await _set(db, b.id, {b.field: v}, dict(old), "inline", user.user_id)
        await db.commit()
    return {"value": v}


class fill_in(BaseModel):
    supplier_id: Optional[int] = None
    category: str = ""
    brand: str = ""
    q: str = ""
    flag: str = ""
    days: int = 60
    overwrite: bool = False
    apply: bool = False


@router.put("/planning/smart-fill")
async def smart_fill(b: fill_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Works out Min / Reorder / Max from real sales and the visit, lead and safety days. Items with no sales are left alone;
    without overwrite only items whose Max and Reorder are unset are filled. apply=false is a preview."""
    days = b.days if b.days in (30, 60, 90, 120) else 60
    items = await _items(db, b.supplier_id, b.category, b.brand, b.q, b.flag)
    res = {"total": len(items), "fill": 0, "applied": 0, "skipped_set": 0, "skipped_nosales": 0, "days": days, "rows": []}
    if not items:
        return res
    p: dict = {"ids": [i["id"] for i in items], "from": rs.today() - timedelta(days=days)}
    ow = access.outlet_filter("i.outlet_id", p)
    sales = {r[0]: float(r[1]) for r in (await db.execute(text(f"""SELECT ii.product_id, SUM(ii.qty) FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        WHERE {rs.SALE} AND i.invoice_date >= :from AND ii.product_id = ANY(:ids){ow} GROUP BY 1"""), p)).all()}
    sch = {r["supplier_id"]: dict(r) for r in (await db.execute(text("SELECT * FROM supplier_visit_schedules"))).mappings()}
    out = []
    for i in items:
        if not b.overwrite and (i["max_stock_level"] > 0 or i["reorder_level"] > 0):
            res["skipped_set"] += 1
            continue
        q = sales.get(i["id"], 0)
        if q <= 0:
            res["skipped_nosales"] += 1
            continue
        s = sch.get(i["supplier_id"])
        visit = i["supplier_visit_days"] if (i["supplier_visit_days"] or 0) > 0 else rs.visit_days(s)
        lead = i["lead_time_days"] if i["lead_time_days"] is not None else (s["lead_time_days"] if s and s["lead_time_days"] is not None else rs.DEFAULT_LEAD)
        safe = i["safety_stock_days"] if i["safety_stock_days"] is not None else rs.DEFAULT_SAFETY
        mn, mx, rl = rs.fill_levels(q / days, visit, lead, safe)
        out.append({"id": i["id"], "code": i["item_code"], "name": i["name"], "avg": round(q / days, 2), "visit": visit, "lead": lead, "safety": safe,
                    "old": [i["min_stock"], i["max_stock_level"], i["reorder_level"]], "new": [mn, mx, rl]})
    if b.apply:
        for r in out:
            old = dict(zip(("min_stock", "max_stock_level", "reorder_level"), r["old"]))
            chg = {f: v for f, v in zip(old, r["new"]) if not _same(old[f], v)}
            if chg:
                await _set(db, r["id"], chg, old, "smartfill", user.user_id)
                res["applied"] += 1
        await db.commit()
    res["fill"], res["rows"] = len(out), out[:60]
    return res


@router.get("/planning/export")
async def planning_export(supplier_id: Optional[int] = None, category: str = "", brand: str = "", q: str = "", flag: str = "", db: AsyncSession = Depends(get_db)):
    rows = await _items(db, supplier_id, category, brand, q, flag)
    head = ["Item Code", "Item Name", "Supplier", "Category", "Brand", "Current Stock", "MRP"] + [v[0] for v in FIELDS.values()]
    return _xlsx("Stock_Planning", head, [[r["item_code"], r["name"], r["supplier"], r["category"], r["brand"], r["stock"], r["mrp"]] + [r[f] for f in FIELDS] for r in rows])


def _code(v) -> str:
    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v if v is not None else "").strip()


@router.put("/planning/import")
async def planning_import(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Excel in the Export layout, matched on Item Code. A blank cell never overwrites."""
    data = await file.read()
    try:
        rows = list(openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True).active.iter_rows(values_only=True))
    except Exception:
        raise HTTPException(400, "Could not read that file (.xlsx).")
    if len(rows) > 50001:
        raise HTTPException(400, "Too many rows (50,000 at most).")
    head = {str(h or "").strip().lower(): n for n, h in enumerate(rows[0])} if rows else {}
    if "item code" not in head:
        raise HTTPException(400, 'The file needs an "Item Code" column (use the Export file as the template).')
    cols = {f: head[v[0].lower()] for f, v in FIELDS.items() if v[0].lower() in head}
    sup_col = head.get("supplier")
    sups = {r[1].strip().lower(): r[0] for r in (await db.execute(text("SELECT id, name FROM suppliers"))).all()}
    res = {"updated": 0, "unchanged": 0, "unknown": [], "bad": []}
    for row in rows[1:]:
        code = _code(row[head["item code"]])
        if not code:
            continue
        p = (await db.execute(text(f"SELECT id, supplier_id, {', '.join(FIELDS)} FROM products WHERE item_code = :c FOR UPDATE"), {"c": code})).mappings().first()
        if not p:
            res["unknown"].append(code)
            continue
        await access.check_products(db, [p["id"]])
        chg: dict = {}
        for f, c in cols.items():
            raw = row[c] if c < len(row) else None
            if raw is None or str(raw).strip() == "":
                continue                       # blank never overwrites
            ok, v = _clean(f, raw)
            if not ok:
                res["bad"].append(f"{code} ({FIELDS[f][0]}={raw})")
            elif not _same(p[f], v):
                chg[f] = v
        if sup_col is not None and sup_col < len(row) and str(row[sup_col] or "").strip():
            sid = sups.get(str(row[sup_col]).strip().lower())
            if not sid:
                res["bad"].append(f"{code} (supplier '{row[sup_col]}' not found)")
            elif sid != p["supplier_id"]:
                chg["supplier_id"] = sid
        if chg:
            await _set(db, p["id"], chg, dict(p), "excel", user.user_id)
            res["updated"] += 1
        else:
            res["unchanged"] += 1
    await db.commit()
    return {**res, "unknown": res["unknown"][:20], "bad": res["bad"][:20], "unknown_count": len(res["unknown"]), "bad_count": len(res["bad"])}


@router.get("/planning/history")
async def planning_history(product_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    p: dict = {"pid": product_id}
    pf = access.product_filter("p", p)
    return [{k: _j(v) for k, v in r.items()} for r in (await db.execute(text(f"""SELECT l.id, l.field_name, l.old_value, l.new_value, l.source, l.changed_at, p.item_code, p.name, u.name AS user_name
        FROM product_planning_log l JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.changed_by
        WHERE (CAST(:pid AS INT) IS NULL OR l.product_id = :pid){pf} ORDER BY l.id DESC LIMIT 300"""), p)).mappings()]


# ── Supplier visits ───────────────────────────────────────────────────────────
REMIND_DAYS = 3
WEEK = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}


def _freq(r) -> str:
    t = r["schedule_type"]
    if t == "interval":
        return f"Every {r['interval_days']} days"
    if t == "daily":
        return "Daily"
    if t == "weekly":
        return "Weekly " + ",".join(WEEK.get(int(d), str(d)) for d in (r["weekdays"] or []))
    if t == "monthly_dates":
        return "Monthly on " + ",".join(str(d) for d in (r["month_dates"] or []))
    return "-"


@router.get("/visits")
async def visits(status: str = "", q: str = "", buyer: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    p: dict = {"q": f"%{q.strip()}%", "buyer": buyer}
    scope = access.outlet_filter("l.outlet_id", p)
    rows = (await db.execute(text(f"""WITH st AS (SELECT l.product_id, SUM(l.stock_qty) AS q FROM outlet_stock l WHERE TRUE{scope} GROUP BY 1),
        need AS (SELECT p.supplier_id, COUNT(*) AS n FROM products p LEFT JOIN st ON st.product_id = p.id WHERE p.is_active AND
            ((p.min_stock > 0 AND COALESCE(st.q, 0) < p.min_stock) OR (p.reorder_level > 0 AND COALESCE(st.q, 0) <= p.reorder_level)) GROUP BY 1)
        SELECT s.id, s.name, s.contact_name, s.phone, v.schedule_type, v.interval_days, v.weekdays, v.month_dates, v.lead_time_days, v.last_visit_date, v.next_visit_date,
               v.assigned_buyer, v.notes AS remarks, u.name AS buyer_name, COALESCE(need.n, 0) AS need_items
        FROM suppliers s LEFT JOIN supplier_visit_schedules v ON v.supplier_id = s.id LEFT JOIN users u ON u.id = v.assigned_buyer LEFT JOIN need ON need.supplier_id = s.id
        WHERE s.status AND (s.name ILIKE :q OR COALESCE(s.phone, '') ILIKE :q) AND (CAST(:buyer AS INT) IS NULL OR v.assigned_buyer = :buyer)
        ORDER BY v.next_visit_date NULLS LAST, s.name"""), p)).mappings().all()
    t, cards, out, remind = rs.today(), {"total": len(rows), "overdue": 0, "today": 0, "soon": 0, "none": 0}, [], []
    for r in rows:
        d = {k: _j(v) for k, v in r.items()}
        d["freq"] = _freq(r) if r["schedule_type"] else "-"
        if not r["next_visit_date"]:
            d["state"], d["days_to"] = "none", None
            cards["none"] += 1
        else:
            n = (r["next_visit_date"] - t).days
            d["days_to"], d["state"] = n, "overdue" if n < 0 else "today" if n == 0 else "soon" if n <= 7 else "later"
            if d["state"] in cards:
                cards[d["state"]] += 1
            if 0 <= n <= REMIND_DAYS:
                remind.append(d)
        out.append(d)
    return {"rows": [r for r in out if not status or r["state"] == status], "cards": cards, "remind": remind, "remind_days": REMIND_DAYS}


async def _audit(db, sid, field, old, new, reason, uid):
    if str(old) == str(new) or (old is None and new in (None, "")):
        return
    await db.execute(text("INSERT INTO supplier_visit_audit (supplier_id, field_name, old_value, new_value, reason, user_id) VALUES (:s, :f, :o, :n, :r, :u)"),
                     {"s": sid, "f": field, "o": None if old is None else str(old)[:120], "n": None if new is None else str(new)[:120], "r": (reason or None) and reason[:200], "u": uid})


class record_in(BaseModel):
    supplier_id: int
    visit_date: Optional[date] = None
    notes: Optional[str] = None
    po_value: Decimal = Field(Decimal(0), ge=0)


@router.put("/visits/record")
async def record_visit(b: record_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """The supplier actually visited (default today): logs it and moves the next visit on."""
    d = b.visit_date or rs.today()
    if d > rs.today():
        raise HTTPException(400, "A visit cannot be in the future.")
    if not (await db.execute(text("SELECT 1 FROM suppliers WHERE id = :s"), {"s": b.supplier_id})).first():
        raise HTTPException(404, "Supplier not found.")
    s = await rs.schedule(db, b.supplier_id)
    nxt = rs.next_visit(s or {"schedule_type": "interval", "interval_days": rs.DEFAULT_VISIT}, d)
    await db.execute(text("INSERT INTO supplier_visit_logs (supplier_id, buyer_id, visit_date, notes, po_value) VALUES (:s, :u, :d, :n, :p)"),
                     {"s": b.supplier_id, "u": user.user_id, "d": d, "n": b.notes, "p": b.po_value})
    await db.execute(text("""INSERT INTO supplier_visit_schedules (supplier_id, schedule_type, interval_days, last_visit_date, next_visit_date) VALUES (:s, 'interval', :iv, :d, :n)
        ON CONFLICT (supplier_id) DO UPDATE SET last_visit_date = :d, next_visit_date = :n, updated_at = NOW()"""), {"s": b.supplier_id, "iv": rs.DEFAULT_VISIT, "d": d, "n": nxt})
    await _audit(db, b.supplier_id, "last_visit_date", s and s["last_visit_date"], d, "visit recorded", user.user_id)
    await _audit(db, b.supplier_id, "next_visit_date", s and s["next_visit_date"], nxt, "after visit", user.user_id)
    await db.commit()
    return {"next": nxt}


class visit_in(BaseModel):
    supplier_id: int
    schedule_type: str = Field("interval", pattern="^(interval|daily|weekly|monthly_dates)$")
    interval_days: Optional[int] = Field(None, ge=1, le=365)
    weekdays: list[int] = []
    month_dates: list[int] = []
    lead_time_days: Optional[int] = Field(None, ge=0, le=60)
    last_visit_date: Optional[date] = None
    next_visit_date: Optional[date] = None        # given = manual override
    assigned_buyer: Optional[int] = None
    remarks: Optional[str] = None
    reason: Optional[str] = None


@router.put("/visits/save")
async def save_visit(b: visit_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if b.schedule_type == "weekly" and (not b.weekdays or any(d not in WEEK for d in b.weekdays)):
        raise HTTPException(400, "Choose the weekdays (1 = Monday … 7 = Sunday).")
    if b.schedule_type == "monthly_dates" and (not b.month_dates or any(not 1 <= d <= 31 for d in b.month_dates)):
        raise HTTPException(400, "Enter the dates of the month (1–31).")
    if b.schedule_type == "interval" and not b.interval_days:
        raise HTTPException(400, "Enter how many days between visits.")
    if not (await db.execute(text("SELECT 1 FROM suppliers WHERE id = :s"), {"s": b.supplier_id})).first():
        raise HTTPException(404, "Supplier not found.")
    old = await rs.schedule(db, b.supplier_id) or {}
    last = b.last_visit_date or old.get("last_visit_date")
    new = {"schedule_type": b.schedule_type, "interval_days": b.interval_days, "weekdays": b.weekdays or None, "month_dates": b.month_dates or None, "lead_time_days": b.lead_time_days,
           "last_visit_date": last, "assigned_buyer": b.assigned_buyer, "notes": b.remarks}
    new["next_visit_date"] = b.next_visit_date or (rs.next_visit(new, last) if last else old.get("next_visit_date"))
    await db.execute(text("""INSERT INTO supplier_visit_schedules (supplier_id, schedule_type, interval_days, weekdays, month_dates, lead_time_days, last_visit_date, next_visit_date, assigned_buyer, notes)
        VALUES (:sid, :schedule_type, :interval_days, CAST(:wd AS JSONB), CAST(:md AS JSONB), :lead_time_days, :last_visit_date, :next_visit_date, :assigned_buyer, :notes)
        ON CONFLICT (supplier_id) DO UPDATE SET schedule_type = EXCLUDED.schedule_type, interval_days = EXCLUDED.interval_days, weekdays = EXCLUDED.weekdays, month_dates = EXCLUDED.month_dates,
            lead_time_days = EXCLUDED.lead_time_days, last_visit_date = EXCLUDED.last_visit_date, next_visit_date = EXCLUDED.next_visit_date, assigned_buyer = EXCLUDED.assigned_buyer,
            notes = EXCLUDED.notes, updated_at = NOW()"""),
        {**new, "sid": b.supplier_id, "wd": json.dumps(b.weekdays) if b.weekdays else None, "md": json.dumps(b.month_dates) if b.month_dates else None})
    for f, v in new.items():
        await _audit(db, b.supplier_id, f, old.get(f), v, b.reason if f != "next_visit_date" or not b.next_visit_date else (b.reason or "manual change"), user.user_id)
    await db.commit()
    return {"next": new["next_visit_date"]}


@router.get("/visits/{supplier_id}/history")
async def visit_history(supplier_id: int, db: AsyncSession = Depends(get_db)):
    p = {"s": supplier_id}
    return {"audit": [{k: _j(v) for k, v in r.items()} for r in (await db.execute(text("""SELECT a.*, u.name AS user_name FROM supplier_visit_audit a LEFT JOIN users u ON u.id = a.user_id
                WHERE a.supplier_id = :s ORDER BY a.id DESC LIMIT 200"""), p)).mappings()],
            "visits": [{k: _j(v) for k, v in r.items()} for r in (await db.execute(text("""SELECT l.*, u.name AS user_name FROM supplier_visit_logs l LEFT JOIN users u ON u.id = l.buyer_id
                WHERE l.supplier_id = :s ORDER BY l.visit_date DESC, l.id DESC LIMIT 50"""), p)).mappings()]}


# ── Smart Reorder ─────────────────────────────────────────────────────────────
@router.get("/smart/dashboard")
async def smart_dashboard(db: AsyncSession = Depends(get_db)):
    p: dict = {"t": rs.today(), "w": rs.today() + timedelta(days=7), "m": rs.today() - timedelta(days=30)}
    stk = rs.stock_sql(None, p)
    pf = access.product_filter("p", p)
    r = (await db.execute(text(f"""SELECT
        (SELECT COUNT(*) FROM suppliers WHERE status) AS suppliers,
        (SELECT COUNT(*) FROM supplier_visit_schedules v JOIN suppliers s ON s.id = v.supplier_id WHERE s.status AND v.next_visit_date BETWEEN :t AND :w) AS visits,
        (SELECT COUNT(*) FROM supplier_visit_schedules v JOIN suppliers s ON s.id = v.supplier_id WHERE s.status AND v.next_visit_date < :t) AS overdue,
        (SELECT COUNT(*) FROM products p WHERE p.is_active AND p.reorder_level > 0 AND {stk} <= p.reorder_level{pf}) AS below_reorder,
        (SELECT COUNT(*) FROM products p WHERE p.is_active AND p.min_stock > 0 AND {stk} < p.min_stock{pf}) AS below_min,
        (SELECT COUNT(*) FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id JOIN products p ON p.id = x.product_id
          WHERE u.invoice_date >= :m AND p.fixed_margin_percent IS NOT NULL AND p.mrp > 0 AND (p.mrp - x.price) / p.mrp * 100 < p.fixed_margin_percent - 0.005{pf}) AS low_margin"""), p)).mappings().one()
    return dict(r)


@router.get("/smart/export")
async def smart_export(supplier_id: int, outlet_id: Optional[int] = None, days: int = 30, category: str = "", brand: str = "", mode: str = "reorder", db: AsyncSession = Depends(get_db)):
    res = await rs.calculate(db, supplier_id, outlet_id, days, category, brand, mode)
    if not res["supplier"]:
        raise HTTPException(404, "Supplier not found.")
    head = ["Item Code", "Item Name", "Category", "Stock", "Avg Daily Sales", "Last 15d Sales", "Min", "Max", "Reorder Lvl", "Visit Days", "Pending PO", "Incoming", "Required", "Suggested PO Qty", "Cost", "Est. Value"]
    return _xlsx("reorder", head, [[r["item_code"], r["name"], r["category"], r["stock"], r["avg"], r["sales_15"], r["min"], r["max"], r["rl"], r["visit"], r["pend"], r["inc"], r["need"], r["sug"], r["cost"], r["value"]] for r in res["rows"]])


@router.get("/smart/{supplier_id}")
async def smart(supplier_id: int, outlet_id: Optional[int] = None, days: int = 30, category: str = "", brand: str = "", mode: str = "reorder", db: AsyncSession = Depends(get_db)):
    res = await rs.calculate(db, supplier_id, outlet_id, days, category, brand, mode)
    if not res["supplier"]:
        raise HTTPException(404, "Supplier not found.")
    return {k: ({a: _j(x) for a, x in v.items()} if k == "schedule" and v else v) for k, v in res.items()}


class po_line(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)


class po_in(BaseModel):
    supplier_id: int
    outlet_id: Optional[int] = None
    days: int = 30
    items: list[po_line] = Field(min_length=1)
    force: bool = False


@router.post("/smart/create-po")
async def create_po(b: po_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Ticked rows -> ONE draft PO + the planning snapshot, in one transaction. The vendor sees it only after approval."""
    from app.routers.purchases import _next_po_no, create_po as make_po
    from app.schemas.purchase import po_create, po_item_in
    await db.execute(text("SELECT pg_advisory_xact_lock(7101, :s)"), {"s": b.supplier_id})
    t = rs.today()
    dup = (await db.execute(text("""SELECT h.po_no FROM purchase_reorder_sessions s JOIN po_headers h ON h.po_no = s.po_no
        WHERE s.supplier_id = :s AND h.status = 'draft' AND h.po_date = :t LIMIT 1"""), {"s": b.supplier_id, "t": t})).scalar()
    if dup and not b.force:
        raise HTTPException(409, f"A reorder draft PO ({dup}) was already created for this supplier today.")
    res = await rs.calculate(db, b.supplier_id, b.outlet_id, b.days)
    if not res["supplier"]:
        raise HTTPException(404, "Supplier not found.")
    by = {r["id"]: r for r in res["rows"]}
    if len({l.product_id for l in b.items}) != len(b.items):
        raise HTTPException(400, "An item is listed twice.")
    bad = [l.product_id for l in b.items if l.product_id not in by]
    if bad:
        raise HTTPException(400, "An item does not belong to this supplier.")
    total = Decimal(0)
    lines = []
    for l in b.items:
        r = by[l.product_id]
        rate, gst = Decimal(str(r["cost"])), Decimal(str(r["gst_percent"]))
        total += l.qty * rate * (1 + gst / 100)
        lines.append(po_item_in(product_id=l.product_id, order_qty=l.qty, rate=rate, gst_percent=gst, mrp=Decimal(str(r["mrp"])), outlet_stock=Decimal(str(r["stock"])),
                                avg_daily_sale=Decimal(str(r["avg"])), suggested_qty=Decimal(str(r["sug"]))))
    po_no = await _next_po_no(db)
    total = total.quantize(Decimal("0.01"))
    sid = (await db.execute(text("""INSERT INTO purchase_reorder_sessions (supplier_id, outlet_id, sales_days, items_count, total_value, po_no, created_by)
        VALUES (:s, :o, :d, :n, :v, :po, :u) RETURNING id"""), {"s": b.supplier_id, "o": b.outlet_id, "d": res["days"], "n": len(lines), "v": total, "po": po_no, "u": user.user_id})).scalar()
    await db.execute(text("""INSERT INTO purchase_reorder_session_items (session_id, product_id, stock, avg_daily, min_q, max_q, reorder_level, pending_qty, incoming_qty, suggested_qty, final_qty, cost)
        VALUES (:s, :p, :st, :a, :mn, :mx, :rl, :pe, :i, :sg, :f, :c)"""),
        [{"s": sid, "p": l.product_id, "st": by[l.product_id]["stock"], "a": by[l.product_id]["avg"], "mn": by[l.product_id]["min"], "mx": by[l.product_id]["max"], "rl": by[l.product_id]["rl"],
          "pe": by[l.product_id]["pend"], "i": by[l.product_id]["inc"], "sg": by[l.product_id]["sug"], "f": l.qty, "c": by[l.product_id]["cost"]} for l in b.items])
    lead = res["sup_lead"]
    out = await make_po(po_create(po_no=po_no, supplier_id=b.supplier_id, outlet_id=b.outlet_id, po_date=t, expected_date=t + timedelta(days=lead), delivery_days=lead or 7,
                                  total_amount=total, status="draft", notes=f"Created from Smart Reorder planning #{sid}", items=lines), db, user)        # commits everything above
    return {"po_id": out["po_id"], "po_no": out["po_no"], "items": len(lines), "session": sid}


# ── reports ───────────────────────────────────────────────────────────────────
TITLES = {"supplier_reorder": "Supplier-wise Reorder", "min_max": "Item-wise Min / Max Stock", "below_reorder": "Below Reorder Level", "below_min": "Stock Below Minimum",
          "excess": "Excess Stock", "visit_calendar": "Supplier Visit Calendar", "suggested_po": "Suggested Purchase Orders", "low_margin_grn": "Low Margin GRN",
          "velocity": "Item-wise Sales Velocity", "plan_vs_actual": "Purchase Planning vs Actual"}


async def _report(db, key: str, frm: date, to: date, sid: Optional[int], outlet: Optional[int]) -> tuple[list, list]:
    access.check_outlet(outlet)
    p: dict = {"from": frm, "to": to}
    sw = ""
    if sid:
        p["sid"] = sid
        sw = " AND p.supplier_id = :sid"
    stk = rs.stock_sql(outlet, p)
    pf = access.product_filter("p", p)
    base = f"FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.is_active{sw}{pf}"
    q = None
    if key == "supplier_reorder":
        rows = []
        for s in (await db.execute(text("SELECT s.id, s.name, v.next_visit_date FROM suppliers s LEFT JOIN supplier_visit_schedules v ON v.supplier_id = s.id WHERE s.status AND (CAST(:i AS INT) IS NULL OR s.id = :i) ORDER BY s.name"), {"i": sid})).mappings().all():
            r = await rs.calculate(db, s["id"], outlet)
            if r["rows"]:
                rows.append([s["name"], s["next_visit_date"], len(r["rows"]), r["cards"]["below_min"], r["cards"]["reorder"], sum(x["sug"] for x in r["rows"]), r["cards"]["value"]])
        return ["Supplier", "Next Visit", "Items", "Below Min", "Items to Order", "Total Qty", "Est. Value"], rows
    if key == "min_max":
        head, q = ["Code", "Item", "Supplier", "Stock", "Min", "Max", "Reorder Lvl", "Fixed Margin %", "Visit Days", "Lead", "Safety"], f"SELECT p.item_code, p.name, COALESCE(s.name, '-'), {stk}, p.min_stock, p.max_stock_level, p.reorder_level, p.fixed_margin_percent, p.supplier_visit_days, p.lead_time_days, p.safety_stock_days {base} ORDER BY p.name LIMIT 5000"
    elif key == "below_reorder":
        head, q = ["Code", "Item", "Supplier", "Stock", "Reorder Lvl", "Min", "Max"], f"SELECT * FROM (SELECT p.item_code, p.name, COALESCE(s.name, '-') sn, {stk} st, p.reorder_level rl, p.min_stock, p.max_stock_level {base} AND p.reorder_level > 0) t WHERE st <= rl ORDER BY name LIMIT 5000"
    elif key == "below_min":
        head, q = ["Code", "Item", "Supplier", "Stock", "Min", "Short By"], f"SELECT * FROM (SELECT p.item_code, p.name, COALESCE(s.name, '-') sn, {stk} st, p.min_stock mn, p.min_stock - {stk} sh {base} AND p.min_stock > 0) t WHERE st < mn ORDER BY sh DESC LIMIT 5000"
    elif key == "excess":
        head, q = ["Code", "Item", "Supplier", "Stock", "Max", "Excess Qty", "Excess Value (cost)"], f"SELECT * FROM (SELECT p.item_code, p.name, COALESCE(s.name, '-') sn, {stk} st, p.max_stock_level mx, {stk} - p.max_stock_level ex, ROUND(({stk} - p.max_stock_level) * COALESCE(NULLIF(p.basic_cost, 0), p.purchase_price, 0), 2) val {base} AND p.max_stock_level > 0) t WHERE st > mx ORDER BY val DESC LIMIT 5000"
    elif key == "visit_calendar":
        head, q = ["Next Visit", "Supplier", "Phone", "Frequency", "Last Visit", "Lead", "Purchase Manager", "Remarks"], f"""SELECT v.next_visit_date, s.name, s.phone, CASE WHEN v.schedule_type = 'interval' THEN v.interval_days || ' days' ELSE v.schedule_type END, v.last_visit_date, v.lead_time_days, u.name, v.notes
            FROM supplier_visit_schedules v JOIN suppliers s ON s.id = v.supplier_id LEFT JOIN users u ON u.id = v.assigned_buyer WHERE s.status AND v.next_visit_date BETWEEN :from AND :to{' AND s.id = :sid' if sid else ''} ORDER BY v.next_visit_date, s.name"""
    elif key == "suggested_po":
        head, q = ["Planned On", "Session", "Supplier", "PO No", "Item", "Stock", "Avg/day", "System Suggested", "Final Qty", "Cost"], f"""SELECT TO_CHAR(rs.created_at + INTERVAL '5 hours 30 minutes', 'DD-MM-YYYY HH24:MI'), rs.id, s.name, rs.po_no, p.name, i.stock, ROUND(i.avg_daily, 2), i.suggested_qty, i.final_qty, i.cost
            FROM purchase_reorder_session_items i JOIN purchase_reorder_sessions rs ON rs.id = i.session_id JOIN suppliers s ON s.id = rs.supplier_id JOIN products p ON p.id = i.product_id
            WHERE CAST(rs.created_at AS DATE) BETWEEN :from AND :to{' AND rs.supplier_id = :sid' if sid else ''}{pf} ORDER BY rs.id DESC, p.name"""
    elif key == "low_margin_grn":
        head, q = ["GRN", "Date", "Supplier", "Item", "MRP", "Cost", "Actual Margin %", "Required %", "Short (pts)"], f"""SELECT * FROM (SELECT u.purchase_no, u.invoice_date, s.name sn, p.name, p.mrp, x.price, ROUND((p.mrp - x.price) / p.mrp * 100, 2) am, p.fixed_margin_percent fm, ROUND(p.fixed_margin_percent - (p.mrp - x.price) / p.mrp * 100, 2) sh
            FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id JOIN suppliers s ON s.id = u.supplier_id JOIN products p ON p.id = x.product_id
            WHERE p.fixed_margin_percent IS NOT NULL AND p.mrp > 0 AND u.invoice_date BETWEEN :from AND :to{' AND u.supplier_id = :sid' if sid else ''}{pf}{access.outlet_filter('u.outlet_id', p)}) t WHERE sh > 0.005 ORDER BY invoice_date DESC LIMIT 5000"""
    elif key == "velocity":
        d = max(1, (to - frm).days + 1)
        lw = access.outlet_filter("i.outlet_id", p)
        if outlet:
            p["o"] = outlet
            lw += " AND i.outlet_id = :o"
        p["d7"] = rs.today() - timedelta(days=7)
        head, q = ["Code", "Item", "Supplier", "Sold Qty", "Avg/day", "Last 7d", "Stock", "Days of Cover"], f"""SELECT p.item_code, p.name, COALESCE(s.name, '-'), SUM(ii.qty), ROUND(SUM(ii.qty) / {d}, 2), COALESCE(SUM(ii.qty) FILTER (WHERE i.invoice_date >= :d7), 0), {stk},
                CASE WHEN SUM(ii.qty) > 0 THEN ROUND({stk} / (SUM(ii.qty) / {d}), 1) END
            FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE {rs.SALE} AND i.invoice_date BETWEEN :from AND :to{lw}{sw}{pf} GROUP BY p.id, s.name ORDER BY SUM(ii.qty) DESC LIMIT 5000"""
    elif key == "plan_vs_actual":
        head, q = ["Planned On", "Supplier", "PO No", "PO Status", "Item", "Suggested", "Ordered", "Received", "Pending"], f"""SELECT TO_CHAR(rs.created_at + INTERVAL '5 hours 30 minutes', 'DD-MM-YYYY'), s.name, rs.po_no, h.status, p.name, i.suggested_qty, i.final_qty, COALESCE(pi.received_qty, 0), GREATEST(i.final_qty - COALESCE(pi.received_qty, 0), 0)
            FROM purchase_reorder_session_items i JOIN purchase_reorder_sessions rs ON rs.id = i.session_id JOIN suppliers s ON s.id = rs.supplier_id JOIN products p ON p.id = i.product_id
            LEFT JOIN po_headers h ON h.po_no = rs.po_no LEFT JOIN po_items pi ON pi.po_id = h.id AND pi.product_id = i.product_id
            WHERE CAST(rs.created_at AS DATE) BETWEEN :from AND :to{' AND rs.supplier_id = :sid' if sid else ''}{pf} ORDER BY rs.id DESC, p.name"""
    if q is None:
        raise HTTPException(404, "Unknown report.")
    r = await db.execute(text(q), p)
    return head, [list(x) for x in r.fetchall()]


def _period(key: str, frm: Optional[date], to: Optional[date]) -> tuple[date, date]:
    t = rs.today()
    return (frm or t, to or t + timedelta(days=30)) if key == "visit_calendar" else (frm or t - timedelta(days=30), to or t)


@router.get("/reports/{key}/export")
async def report_export(key: str, from_date: Optional[date] = None, to_date: Optional[date] = None, supplier_id: Optional[int] = None, outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    if key not in TITLES:
        raise HTTPException(404, "Unknown report.")
    head, rows = await _report(db, key, *_period(key, from_date, to_date), supplier_id, outlet_id)
    return _xlsx(key, head, rows)


@router.get("/reports/{key}")
async def report(key: str, from_date: Optional[date] = None, to_date: Optional[date] = None, supplier_id: Optional[int] = None, outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    if key not in TITLES:
        raise HTTPException(404, "Unknown report.")
    frm, to = _period(key, from_date, to_date)
    head, rows = await _report(db, key, frm, to, supplier_id, outlet_id)
    return {"title": TITLES[key], "titles": TITLES, "from": frm, "to": to, "head": head, "rows": [[_j(v) for v in r] for r in rows]}


@router.get("/item/{pid}")
async def item(pid: int, outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    """Everything a buyer wants to see about one item before deciding."""
    access.check_outlet(outlet_id)
    await access.check_products(db, [pid])
    p: dict = {"p": pid}
    stk = rs.stock_sql(outlet_id, p)
    it = (await db.execute(text(f"""SELECT p.id, p.name, p.item_code, p.min_stock, p.max_stock_level, p.reorder_level, {stk} AS stock, s.name AS supplier
        FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = :p"""), p)).mappings().first()
    if not it:
        raise HTTPException(404, "Item not found.")
    t = rs.today()
    q: dict = {"p": pid, "t": t}
    lw = access.outlet_filter("i.outlet_id", q)
    if outlet_id:
        q["o"] = outlet_id
        lw += " AND i.outlet_id = :o"
    s = (await db.execute(text(f"""SELECT COALESCE(SUM(ii.qty) FILTER (WHERE i.invoice_date >= CAST(:t AS DATE) - 7), 0) d7, COALESCE(SUM(ii.qty) FILTER (WHERE i.invoice_date >= CAST(:t AS DATE) - 15), 0) d15,
            COALESCE(SUM(ii.qty) FILTER (WHERE i.invoice_date >= CAST(:t AS DATE) - 30), 0) d30, COALESCE(SUM(ii.qty) FILTER (WHERE i.invoice_date >= CAST(:t AS DATE) - 60), 0) d60, COALESCE(SUM(ii.qty), 0) d90
        FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id WHERE ii.product_id = :p AND {rs.SALE} AND i.invoice_date >= CAST(:t AS DATE) - 90{lw}"""), q)).mappings().one()
    trend = (await db.execute(text(f"""SELECT TO_CHAR(i.invoice_date, 'IYYY-"W"IW') wk, SUM(ii.qty) q FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        WHERE ii.product_id = :p AND {rs.SALE} AND i.invoice_date >= CAST(:t AS DATE) - 56{lw} GROUP BY 1 ORDER BY 1"""), q)).mappings().all()
    pur = (await db.execute(text("""SELECT u.invoice_date, x.qty, x.price, s.name AS supplier FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id
        LEFT JOIN suppliers s ON s.id = u.supplier_id WHERE x.product_id = :p ORDER BY u.invoice_date DESC, u.id DESC LIMIT 2"""), {"p": pid})).mappings().all()
    pend = (await db.execute(text(f"SELECT COALESCE(SUM({rs.OPEN_QTY}), 0) FROM po_items pi JOIN po_headers h ON h.id = pi.po_id WHERE pi.product_id = :p AND {rs.OPEN_PO}"), {"p": pid})).scalar()
    conv = lambda r: {k: _j(v) for k, v in dict(r).items()}  # noqa: E731
    return {"item": conv(it), "sales": conv(s), "avg": round(float(s["d30"]) / 30, 2), "trend": [conv(r) for r in trend], "purchases": [conv(r) for r in pur], "pending": float(pend)}
