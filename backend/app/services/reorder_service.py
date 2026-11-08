"""Smart reorder (same rules as NCG): how much to buy from a supplier, from real sales, stock, open POs and the visit cycle.

    cover days = visit + lead + safety      required = avg daily sale x cover      available = stock + pending PO + incoming PO
    Never leaves stock below Minimum, never exceeds Maximum, then rounds to the item's pack and MOQ.
Suggestions only: a draft PO is created when the buyer ticks items and asks for it.
"""
import calendar
import math
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import text

from app.core import access
from app.services.store_shifts import now_ist

DEFAULT_VISIT, DEFAULT_LEAD, DEFAULT_SAFETY = 7, 2, 2
SALE = "i.invoice_type <> 'return' AND i.status <> 'cancelled'"
OPEN_PO = "h.status NOT IN ('completed', 'cancelled', 'closed', 'rejected')"
OPEN_QTY = "GREATEST(COALESCE(NULLIF(pi.order_qty, 0), pi.qty) - COALESCE(pi.received_qty, 0), 0)"
SALES_DAYS = (15, 30, 60, 90)


def today() -> date:
    return now_ist().date()


def next_visit(s: dict, frm: date) -> date:
    t = s.get("schedule_type") or "interval"
    if t == "daily":
        return frm + timedelta(days=1)
    if t == "weekly":
        days = sorted(int(x) for x in (s.get("weekdays") or [1]))         # 1 = Monday … 7 = Sunday
        dow = frm.isoweekday()
        return frm + timedelta(days=next((d - dow for d in days if d > dow), 7 - dow + days[0]))
    if t == "monthly_dates":
        dates = sorted(int(x) for x in (s.get("month_dates") or [1]))
        last = calendar.monthrange(frm.year, frm.month)[1]
        for d in dates:
            if d > frm.day and d <= last:
                return frm.replace(day=d)
        y, m = (frm.year + 1, 1) if frm.month == 12 else (frm.year, frm.month + 1)
        return date(y, m, min(dates[0], calendar.monthrange(y, m)[1]))
    return frm + timedelta(days=max(1, int(s.get("interval_days") or DEFAULT_VISIT)))


def visit_days(s: Optional[dict]) -> int:
    if s and s["schedule_type"] == "interval" and (s["interval_days"] or 0) > 0:
        return int(s["interval_days"])
    if s and s["schedule_type"] == "daily":
        return 1
    return DEFAULT_VISIT


def fill_levels(avg: float, visit: int, lead: int, safety: int) -> tuple[int, int, int]:
    """Smart Fill: Min lasts until a delivery arrives, Max until the next visit, Reorder halfway."""
    mn = max(1, math.ceil(avg * (lead + safety)))
    mx = max(mn + 1, math.ceil(avg * (visit + lead + safety)))
    return mn, mx, math.ceil((mn + mx) / 2)


def suggest(stock: float, avg: float, cover: int, mn: float, mx: float, rl: float, pending: float, incoming: float, pack: float, moq: float) -> dict:
    avail = stock + pending + incoming
    required = avg * cover
    need = required - avail
    if avail < mn:                     # never leave stock below Minimum
        need = max(need, mn - avail)
    reorder = avail < mn or (rl > 0 and avail <= rl) or need > 0.5
    sug = max(0, math.ceil(need - 1e-9)) if reorder else 0
    cap = max(0, math.floor(mx - stock - incoming - pending)) if mx > 0 else None      # Maximum must not be exceeded
    if cap is not None and sug > cap:
        sug = cap
    if sug > 0 and pack > 1:
        up = math.ceil(sug / pack) * pack
        sug = math.floor(cap / pack) * pack if cap is not None and up > cap else up
    if sug > 0 and moq > sug and (cap is None or moq <= cap):
        sug = moq
    full = max(0, math.ceil(need - 1e-9))
    return {"required": round(required, 1), "need": full, "sug": sug, "reorder": reorder, "capped": cap is not None and reorder and cap < full}


async def schedule(db, supplier_id: int) -> Optional[dict]:
    r = (await db.execute(text("SELECT * FROM supplier_visit_schedules WHERE supplier_id = :s"), {"s": supplier_id})).mappings().first()
    return dict(r) if r else None


def stock_sql(outlet_id: Optional[int], p: dict) -> str:
    """Per-row stock of products alias p, inside the caller's outlets."""
    w = ""
    if outlet_id:
        p["stock_outlet"] = outlet_id
        w = " AND l.outlet_id = :stock_outlet"
    return f"GREATEST(COALESCE((SELECT SUM(l.stock_qty) FROM outlet_stock l WHERE l.product_id = p.id{w}{access.outlet_filter('l.outlet_id', p)}), 0), 0)"


async def calculate(db, supplier_id: int, outlet_id: Optional[int] = None, days: int = 30, category: str = "", brand: str = "", mode: str = "all") -> dict:
    access.check_outlet(outlet_id)
    days = days if days in SALES_DAYS else 30
    sup = (await db.execute(text("SELECT id, name, phone, email FROM suppliers WHERE id = :s"), {"s": supplier_id})).mappings().first()
    if not sup:
        return {"supplier": None, "rows": [], "cards": _cards([]), "days": days}
    sch = await schedule(db, supplier_id)
    sup_visit, sup_lead = visit_days(sch), sch["lead_time_days"] if sch and sch["lead_time_days"] is not None else DEFAULT_LEAD
    p: dict = {"s": supplier_id}
    w = ""
    if category:
        w += " AND p.category = :cat"
        p["cat"] = category
    if brand:
        w += " AND p.brand = :brand"
        p["brand"] = brand
    w += access.product_filter("p", p)
    stk = stock_sql(outlet_id, p)
    items = (await db.execute(text(f"""SELECT p.id, p.item_code, p.name, p.category, p.brand, p.unit, p.mrp, p.gst_percent, {stk} AS stock,
            COALESCE(p.min_stock, 0) AS mn, COALESCE(p.max_stock_level, 0) AS mx, COALESCE(p.reorder_level, 0) AS rl, p.supplier_visit_days, p.safety_stock_days,
            p.lead_time_days, COALESCE(NULLIF(p.basic_cost, 0), p.purchase_price, 0) AS cost, COALESCE(p.purchase_pack_qty, 1) AS pack, COALESCE(p.min_order_qty, 0) AS moq,
            (p.supplier_id = :s) AS pref
        FROM products p WHERE p.is_active AND (p.supplier_id = :s
            OR p.id IN (SELECT x.product_id FROM unit_wise_purchase_items x JOIN unit_wise_purchases u ON u.id = x.purchase_id WHERE u.supplier_id = :s)
            OR p.id IN (SELECT x.product_id FROM po_items x JOIN po_headers h ON h.id = x.po_id WHERE h.supplier_id = :s)){w}
        ORDER BY p.name"""), p)).mappings().all()
    base = {"supplier": dict(sup), "schedule": sch, "sup_visit": sup_visit, "sup_lead": sup_lead, "days": days}
    if not items:
        return {**base, "rows": [], "cards": _cards([])}
    ids = [i["id"] for i in items]
    t = today()
    q: dict = {"ids": ids, "from": t - timedelta(days=days), "d15": t - timedelta(days=15)}
    ow = access.outlet_filter("i.outlet_id", q)
    if outlet_id:
        ow += " AND i.outlet_id = :o"
        q["o"] = outlet_id
    sales = {r[0]: (float(r[1] or 0), float(r[2] or 0)) for r in (await db.execute(text(f"""SELECT ii.product_id, SUM(ii.qty), SUM(ii.qty) FILTER (WHERE i.invoice_date >= :d15)
        FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        WHERE {SALE} AND i.invoice_date >= :from AND ii.product_id = ANY(:ids){ow} GROUP BY ii.product_id"""), q)).all()}
    q2: dict = {"ids": ids}
    pw = access.outlet_filter("h.outlet_id", q2)
    if outlet_id:
        pw += " AND h.outlet_id = :o"
        q2["o"] = outlet_id
    po = {r[0]: (float(r[1] or 0), float(r[2] or 0)) for r in (await db.execute(text(f"""SELECT pi.product_id,
            SUM({OPEN_QTY}) FILTER (WHERE h.approval_status <> 'approved'), SUM({OPEN_QTY}) FILTER (WHERE h.approval_status = 'approved')
        FROM po_items pi JOIN po_headers h ON h.id = pi.po_id WHERE {OPEN_PO} AND pi.product_id = ANY(:ids){pw} GROUP BY pi.product_id"""), q2)).all()}
    rows = []
    for i in items:
        st, (sq, s15), (pend, inc) = float(i["stock"]), sales.get(i["id"], (0.0, 0.0)), po.get(i["id"], (0.0, 0.0))
        avg = sq / days
        visit = i["supplier_visit_days"] if (i["supplier_visit_days"] or 0) > 0 else sup_visit
        lead = i["lead_time_days"] if i["lead_time_days"] is not None else sup_lead
        safe = i["safety_stock_days"] if i["safety_stock_days"] is not None else DEFAULT_SAFETY
        mn, mx, rl, cost = float(i["mn"]), float(i["mx"]), float(i["rl"]), float(i["cost"] or 0)
        s = suggest(st, avg, visit + lead + safe, mn, mx, rl, pend, inc, float(i["pack"] or 1), float(i["moq"] or 0))
        rows.append({"id": i["id"], "item_code": i["item_code"], "name": i["name"], "category": i["category"], "brand": i["brand"], "unit": i["unit"],
                     "mrp": float(i["mrp"] or 0), "gst_percent": float(i["gst_percent"] or 0), "stock": st, "sales_p": sq, "sales_15": s15, "avg": round(avg, 3),
                     "min": mn, "max": mx, "rl": rl, "visit": visit, "lead": lead, "safety": safe, "cover": visit + lead + safe, "pend": pend, "inc": inc, "cost": cost,
                     "value": round(s["sug"] * cost, 2), "below_min": st < mn, "above_max": mx > 0 and st > mx, "pref": bool(i["pref"]), **s})
    cards = _cards(rows)
    if mode == "reorder":
        rows = [r for r in rows if r["sug"] > 0]
    elif mode == "below_min":
        rows = [r for r in rows if r["below_min"]]
    elif mode == "above_max":
        rows = [r for r in rows if r["above_max"]]
    return {**base, "rows": rows, "cards": cards}


def _cards(rows: list[dict]) -> dict:
    return {"items": len(rows), "reorder": sum(1 for r in rows if r["sug"] > 0), "below_min": sum(1 for r in rows if r["below_min"]),
            "above_max": sum(1 for r in rows if r["above_max"]), "value": round(sum(r["value"] for r in rows), 2)}


if __name__ == "__main__":
    d = date(2026, 11, 8)      # a Sunday
    assert next_visit({"schedule_type": "interval", "interval_days": 10}, d) == date(2026, 11, 18) and next_visit({"schedule_type": "daily"}, d) == date(2026, 11, 9)
    assert next_visit({"schedule_type": "weekly", "weekdays": [1, 4]}, d) == date(2026, 11, 9) and next_visit({"schedule_type": "weekly", "weekdays": [1, 7]}, date(2026, 11, 2)) == date(2026, 11, 8)
    assert next_visit({"schedule_type": "monthly_dates", "month_dates": [5, 20]}, d) == date(2026, 11, 20) and next_visit({"schedule_type": "monthly_dates", "month_dates": [5]}, date(2026, 12, 9)) == date(2027, 1, 5)
    assert next_visit({"schedule_type": "monthly_dates", "month_dates": [31]}, date(2027, 1, 31)) == date(2027, 2, 28)
    assert fill_levels(2, 7, 2, 2) == (8, 22, 15)
    # 2/day, 11 cover days = 22 needed, 5 in hand -> 17; no maximum
    assert suggest(5, 2, 11, 0, 0, 0, 0, 0, 1, 0)["sug"] == 17
    # open POs count: 20 already ordered -> nothing more
    assert suggest(5, 2, 11, 0, 0, 0, 10, 10, 1, 0)["sug"] == 0
    # Maximum caps the order; pack rounding stays under it
    x = suggest(5, 2, 11, 0, 15, 0, 0, 0, 1, 0)
    assert x["sug"] == 10 and x["capped"]
    assert suggest(5, 2, 11, 0, 0, 0, 0, 0, 12, 0)["sug"] == 24 and suggest(5, 2, 11, 0, 15, 0, 0, 0, 4, 0)["sug"] == 8
    # no sales but below Minimum still orders up to Minimum; MOQ lifts small orders
    assert suggest(1, 0, 11, 10, 0, 0, 0, 0, 1, 0)["sug"] == 9 and suggest(1, 0, 11, 10, 0, 0, 0, 0, 1, 25)["sug"] == 25
    # enough stock and nothing below the levels -> no order
    assert suggest(100, 2, 11, 10, 200, 20, 0, 0, 1, 0)["sug"] == 0
    print("reorder_service OK")
