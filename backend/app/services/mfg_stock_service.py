"""Department stock for manufacturing: the only place stock moves between mfg_stores.

post() is the single posting path: it converts the entered unit to the item's base unit, locks the source
balance row, refuses to go below zero, moves the quantity and writes an append-only mfg_stock_txns row —
all inside the caller's transaction. A request_key makes a double-submitted form post only once.
"""
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

ZERO = Decimal("0")
CARTON_UNITS = {"CTN", "CARTON", "CARTONS", "CASE"}


def d(v) -> Decimal:
    return Decimal(str(v or 0))


async def next_doc(db: AsyncSession, prefix: str) -> str:
    """Gap-free per-prefix numbering (row-locked), e.g. TRF-2026-00012."""
    key = f"{prefix}-{datetime.now():%Y}"
    n = (await db.execute(text("""INSERT INTO mfg_doc_seq (prefix, last_no) VALUES (:k, 1)
        ON CONFLICT (prefix) DO UPDATE SET last_no = mfg_doc_seq.last_no + 1 RETURNING last_no"""), {"k": key})).scalar()
    return f"{key}-{n:05d}"


async def item(db: AsyncSession, product_id: int) -> dict:
    r = (await db.execute(text("""SELECT p.id, p.name, p.item_code, UPPER(COALESCE(p.unit, 'PCS')) AS unit,
        COALESCE(NULLIF(pk.total_units_per_carton, 0), 1) AS units_per_carton
        FROM products p LEFT JOIN item_packaging_master pk ON pk.product_id = p.id AND pk.is_active
        WHERE p.id = :p"""), {"p": product_id})).mappings().first()
    if not r:
        raise HTTPException(404, f"Item #{product_id} not found")
    return dict(r)


async def factor(db: AsyncSession, product_id: int, unit: Optional[str], units_per_carton: Optional[int] = None) -> Decimal:
    """Base units in one `unit` of the item. Cartons use the given units-per-carton (packaging spec) or the
    item's packaging master. Anything else needs an Item Units entry — never a silent guess."""
    it = await item(db, product_id)
    u = (unit or it["unit"]).upper()
    if u == it["unit"]:
        return Decimal(1)
    row = (await db.execute(text("SELECT factor FROM mfg_item_uoms WHERE product_id = :p AND UPPER(unit) = :u"),
                            {"p": product_id, "u": u})).scalar()
    if row:
        return d(row)
    if u in CARTON_UNITS:
        upc = units_per_carton or it["units_per_carton"]
        if upc and upc > 1:
            return Decimal(upc)
    raise HTTPException(400, f"No conversion from {u} to {it['unit']} for '{it['name']}'. Add it under Manufacturing → Item Units.")


async def to_base(db: AsyncSession, product_id: int, qty, unit: Optional[str], units_per_carton: Optional[int] = None) -> Decimal:
    q = d(qty)
    if q <= 0:
        raise HTTPException(400, "Quantity must be more than zero.")
    return (q * await factor(db, product_id, unit, units_per_carton)).quantize(Decimal("0.0001"))


def cartons(qty_base, units_per_carton: int) -> dict:
    """72 tins @ 24 → 3 cartons 0 loose; 70 → 2 cartons 22 loose. Exact, nothing rounded away."""
    q, upc = d(qty_base), max(int(units_per_carton or 1), 1)
    full = (q / upc).to_integral_value(rounding=ROUND_DOWN)
    return {"units": q, "cartons": int(full), "loose": q - full * upc, "units_per_carton": upc}


async def balance(db: AsyncSession, store_id: int, product_id: int, batch_no: str = "", brand_id: int = 0, lock: bool = False) -> Decimal:
    q = await db.execute(text("SELECT qty FROM mfg_stock WHERE store_id = :s AND product_id = :p AND batch_no = :b AND brand_id = :br"
                              + (" FOR UPDATE" if lock else "")), {"s": store_id, "p": product_id, "b": batch_no or "", "br": brand_id or 0})
    return d(q.scalar())


async def post(db: AsyncSession, *, txn_type: str, product_id: int, qty_base: Decimal, from_store: Optional[int], to_store: Optional[int],
               user_id: Optional[int], batch_no: str = "", brand_id: int = 0, unit_entered: Optional[str] = None,
               qty_entered=None, ref_type: Optional[str] = None, ref_id: Optional[int] = None, ref_no: Optional[str] = None,
               remarks: Optional[str] = None, request_key: Optional[str] = None, doc_no: Optional[str] = None,
               reversal_of: Optional[int] = None) -> dict:
    q = d(qty_base)
    if q <= 0:
        raise HTTPException(400, "Quantity must be more than zero.")
    if from_store == to_store:
        raise HTTPException(400, "Source and destination store are the same.")
    if request_key:
        dup = (await db.execute(text("SELECT id, doc_no FROM mfg_stock_txns WHERE request_key = :k"), {"k": request_key})).first()
        if dup:
            return {"id": dup[0], "doc_no": dup[1], "duplicate": True}
    batch_no, brand_id = batch_no or "", brand_id or 0
    if from_store:
        await db.execute(text("""INSERT INTO mfg_stock (store_id, product_id, batch_no, brand_id, qty) VALUES (:s, :p, :b, :br, 0)
            ON CONFLICT DO NOTHING"""), {"s": from_store, "p": product_id, "b": batch_no, "br": brand_id})
        have = await balance(db, from_store, product_id, batch_no, brand_id, lock=True)
        if have < q:
            it = await item(db, product_id)
            sname = (await db.execute(text("SELECT name FROM mfg_stores WHERE id = :s"), {"s": from_store})).scalar()
            raise HTTPException(400, f"Not enough '{it['name']}'{f' (batch {batch_no})' if batch_no else ''} in {sname}: "
                                     f"available {have.normalize():f} {it['unit']}, needed {q.normalize():f}.")
        await db.execute(text("""UPDATE mfg_stock SET qty = qty - :q, updated_at = NOW()
            WHERE store_id = :s AND product_id = :p AND batch_no = :b AND brand_id = :br"""),
            {"q": q, "s": from_store, "p": product_id, "b": batch_no, "br": brand_id})
    if to_store:
        await db.execute(text("""INSERT INTO mfg_stock (store_id, product_id, batch_no, brand_id, qty) VALUES (:s, :p, :b, :br, :q)
            ON CONFLICT (store_id, product_id, batch_no, brand_id) DO UPDATE SET qty = mfg_stock.qty + EXCLUDED.qty, updated_at = NOW()"""),
            {"s": to_store, "p": product_id, "b": batch_no, "br": brand_id, "q": q})
    doc = doc_no or await next_doc(db, "MST")
    tid = (await db.execute(text("""INSERT INTO mfg_stock_txns (doc_no, txn_type, product_id, batch_no, brand_id, from_store_id, to_store_id,
        qty, unit_entered, qty_entered, ref_type, ref_id, ref_no, remarks, request_key, reversal_of, posted_by)
        VALUES (:doc, :t, :p, :b, :br, :f, :to, :q, :ue, :qe, :rt, :ri, :rn, :rm, :rk, :rv, :u) RETURNING id"""),
        {"doc": doc, "t": txn_type, "p": product_id, "b": batch_no, "br": brand_id, "f": from_store, "to": to_store, "q": q,
         "ue": unit_entered, "qe": d(qty_entered) if qty_entered is not None else None, "rt": ref_type, "ri": ref_id, "rn": ref_no,
         "rm": remarks, "rk": request_key, "rv": reversal_of, "u": user_id})).scalar()
    return {"id": tid, "doc_no": doc, "duplicate": False}


async def reverse(db: AsyncSession, txn_id: int, user_id: Optional[int], reason: str) -> dict:
    t = (await db.execute(text("SELECT * FROM mfg_stock_txns WHERE id = :i"), {"i": txn_id})).mappings().first()
    if not t:
        raise HTTPException(404, "Movement not found")
    if t["reversal_of"]:
        raise HTTPException(400, "This row is itself a reversal; it cannot be reversed again.")
    if (await db.execute(text("SELECT 1 FROM mfg_stock_txns WHERE reversal_of = :i"), {"i": txn_id})).first():
        raise HTTPException(400, f"{t['doc_no']} has already been reversed.")
    return await post(db, txn_type=f"REVERSAL", product_id=t["product_id"], qty_base=t["qty"], from_store=t["to_store_id"],
                      to_store=t["from_store_id"], user_id=user_id, batch_no=t["batch_no"], brand_id=t["brand_id"],
                      ref_type=t["ref_type"], ref_id=t["ref_id"], ref_no=t["doc_no"], remarks=f"Reversal of {t['doc_no']}: {reason}",
                      reversal_of=txn_id)


if __name__ == "__main__":  # python -m app.services.mfg_stock_service
    assert cartons(72, 24) == {"units": Decimal(72), "cartons": 3, "loose": Decimal(0), "units_per_carton": 24}
    c = cartons(70, 24)
    assert c["cartons"] == 2 and c["loose"] == Decimal(22)
    c = cartons(Decimal("49.5"), 12)
    assert c["cartons"] == 4 and c["loose"] == Decimal("1.5")
    print("mfg_stock_service OK")
