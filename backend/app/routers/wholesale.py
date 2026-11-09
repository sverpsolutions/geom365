"""Wholesale billing (from NCG / Gupta Bros WholesaleBilling): GST bills to wholesale customers, franchise outlets and suppliers cleared for
billing, with e-invoice (IRN) and e-way bill through GSTZen, receipts and party ledger.

A bill is a unit_wise_invoices row (invoice_type='wholesale') made by billing_service.create_invoice, so stock, batches, GST and discount policy
stay in one place. Franchise outlets and suppliers bill through a linked customers row (linked_outlet_id / linked_supplier_id).
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import current_user_dep, get_current_user
from app.schemas.invoice import invoice_create, invoice_item_in, payment_in
from app.services import accounts_service as svc, billing_service, gstzen
from app.services.auth_service import write_audit
from app.services.store_shifts import now_ist
from app.utils.gst_validators import STATE_CODE_MAP, validate_gstin

router = APIRouter(prefix="/wholesale", tags=["wholesale"])

COMPANY = """SELECT legal_name, brand_name, gstin, company_pan, company_state, state_code, ho_address, ho_city, ho_pincode, ho_phone, ho_email, reg_address, reg_city,
    reg_pincode, fssai_no, logo_path, bank_account_name, bank_name, bank_account_no, bank_ifsc, bank_branch, upi_id, authorized_signatory,
    signatory_designation, invoice_terms, invoice_footer FROM company_settings ORDER BY id LIMIT 1"""
OUTLET = "SELECT id, outlet_name, address, city, state, pincode, gst_number, store_type, store_phone, manager_mobile FROM outlets WHERE id = :i"
KIND = "CASE WHEN c.linked_outlet_id IS NOT NULL THEN 'franchise' WHEN c.linked_supplier_id IS NOT NULL THEN 'supplier' ELSE 'customer' END"
NOT_APPLICABLE = "Not applicable: this party has no GSTIN."


class line_in(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)
    rate: Decimal = Field(ge=0)
    disc_pct: Decimal = Field(default=Decimal(0), ge=0, lt=100)
    batch_id: Optional[int] = None


class ship_in(BaseModel):
    ship_to_different: bool = False
    ship_name: Optional[str] = Field(default=None, max_length=100)
    ship_gstin: Optional[str] = Field(default=None, max_length=15)
    ship_address: Optional[str] = Field(default=None, max_length=200)
    ship_place: Optional[str] = Field(default=None, max_length=100)
    ship_pincode: Optional[str] = Field(default=None, max_length=6)
    ship_state_code: Optional[str] = Field(default=None, max_length=2)


class create_in(ship_in):
    party_type: Literal["customer", "franchise", "supplier"]
    party_id: int
    outlet_id: int
    invoice_date: date
    rates_incl_gst: bool = True
    payment_mode: str = "credit"
    notes: Optional[str] = None
    discount_approval_no: Optional[str] = None
    items: list[line_in] = Field(min_length=1)


class ewb_in(BaseModel):
    transport_mode: int = 1
    vehicle_no: Optional[str] = None
    vehicle_type: Literal["R", "O"] = "R"
    transporter_id: Optional[str] = None
    transporter_name: Optional[str] = None
    transport_doc_no: Optional[str] = None
    transport_doc_date: Optional[date] = None
    transport_distance: int = 0


class reason_in(BaseModel):
    reason: str = Field(min_length=5, max_length=100)


class settings_in(BaseModel):
    token: Optional[str] = None          # blank keeps the saved one
    sandbox: bool = True
    sandbox_gstin: Optional[str] = None
    prefix: str = "WS"


def _only_admin(user):
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only an administrator can change the e-invoice settings.")


async def _one(db, sql: str, **p) -> Optional[dict]:
    r = (await db.execute(text(sql), p)).mappings().first()
    return dict(r) if r else None


async def _company(db) -> dict:
    return await _one(db, COMPANY) or {}


# ── Parties ────────────────────────────────────────────────────────────────

async def _ensure_customer(db, kind: str, pid: int) -> dict:
    """The customers row a bill posts to. A franchise outlet / cleared supplier gets one on its first bill (re-used by GSTIN if it is already
    a customer) and every bill refreshes it from its master, so the master stays the one place to correct an address."""
    if kind == "customer":
        c = await _one(db, "SELECT * FROM customers WHERE id = :i AND status", i=pid)
        if not c:
            raise HTTPException(404, "Customer not found or inactive.")
        return c
    if kind == "franchise":
        o = await _one(db, """SELECT outlet_name AS name, gst_number, address, city, state, pincode, COALESCE(store_phone, manager_mobile) AS phone
                              FROM outlets WHERE id = :i AND is_active AND store_type = 'Franchise'""", i=pid)
        if not o:
            raise HTTPException(404, "Franchise outlet not found (Outlet Master: Store Type must be Franchise).")
        src, col = o, "linked_outlet_id"
    else:
        s = await _one(db, "SELECT name, gst_number, address, city, state, pincode, phone FROM suppliers WHERE id = :i AND status AND allow_wholesale_bill", i=pid)
        if not s:
            raise HTTPException(404, "Supplier not found, or 'Allow wholesale bill' is off in Supplier Master.")
        src, col = s, "linked_supplier_id"

    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('wholesale_party'))"))
    g = (src["gst_number"] or "").strip().upper() or None
    vals = {"n": src["name"][:100], "g": g, "a": src["address"], "c": (src["city"] or "")[:50] or None, "s": (src["state"] or "")[:50] or "Delhi",
            "pin": (src["pincode"] or "")[:10] or None, "sc": gstzen.gstin_state(g) or gstzen.state_code(src["state"]) or None, "i": pid}
    row = await _one(db, f"SELECT id FROM customers WHERE {col} = :i", i=pid)
    if not row and g:
        row = await _one(db, "SELECT id FROM customers WHERE gst_number = :g AND status ORDER BY id LIMIT 1", g=g)
    if row:
        await db.execute(text(f"""UPDATE customers SET {col} = :i, name = :n, gst_number = :g, address = :a, city = :c, state = :s, pincode = :pin,
                                  state_code = :sc, gst_registration_type = CASE WHEN CAST(:g AS VARCHAR) IS NULL THEN gst_registration_type ELSE 'Regular' END,
                                  updated_at = NOW() WHERE id = :cid"""), {**vals, "cid": row["id"]})
        cid = row["id"]
    else:
        cid = (await db.execute(text(f"""INSERT INTO customers (name, phone, type, gst_number, address, city, state, pincode, state_code, gst_registration_type, {col})
            VALUES (:n, :ph, 'wholesale', :g, :a, :c, :s, :pin, :sc, :rt, :i) RETURNING id"""),
            {**vals, "ph": (src["phone"] or "0000000000")[:20], "rt": "Regular" if g else "Unregistered"})).scalar()
        await db.execute(text("UPDATE customers SET customer_code = 'CUST' || LPAD(id::text, 5, '0') WHERE id = :i"), {"i": cid})
    return await _one(db, "SELECT * FROM customers WHERE id = :i", i=cid)


@router.get("/options")
async def options(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    p: dict = {}
    stores = (await db.execute(text(f"""SELECT id, outlet_name FROM outlets WHERE is_active AND COALESCE(store_type, '') <> 'Franchise'
        {access.outlet_filter('id', p)} ORDER BY outlet_name"""), p)).mappings().all()
    modes = (await db.execute(text("SELECT code, name FROM payment_modes WHERE is_active AND 'SALE' = ANY(applies_to) ORDER BY name"))).mappings().all()
    cfg = await gstzen.config(db)
    return {"stores": list(stores), "payment_modes": [m for m in modes if m["code"].lower() not in ("split", "wallet", "gift_voucher", "loyalty", "credit")],
            "states": [{"code": c, "name": n} for c, n in sorted(STATE_CODE_MAP.items())], "today": now_ist().date(),
            "sandbox": cfg["sandbox"], "has_token": bool(cfg["token"])}


@router.get("/parties")
async def parties(q: str = "", kind: Optional[str] = None, limit: int = Query(30, le=100), db: AsyncSession = Depends(get_db),
                  user: current_user_dep = Depends(get_current_user)):
    like = f"%{q.strip()}%"
    parts = {
        "customer": """SELECT 'customer' AS kind, c.id, c.name, c.gst_number, c.address, c.city, c.state, c.pincode FROM customers c
            WHERE c.status AND c.id <> :walkin AND c.linked_outlet_id IS NULL AND c.linked_supplier_id IS NULL
              AND (c.type = 'wholesale' OR NULLIF(TRIM(c.gst_number), '') IS NOT NULL)
              AND (c.name ILIKE :q OR c.phone ILIKE :q OR c.gst_number ILIKE :q OR c.customer_code ILIKE :q)""",
        "franchise": """SELECT 'franchise', o.id, o.outlet_name, o.gst_number, o.address, o.city, o.state, o.pincode FROM outlets o
            WHERE o.is_active AND o.store_type = 'Franchise' AND (o.outlet_name ILIKE :q OR o.unit_code ILIKE :q OR o.gst_number ILIKE :q)""",
        "supplier": """SELECT 'supplier', s.id, s.name, s.gst_number, s.address, s.city, s.state, s.pincode FROM suppliers s
            WHERE s.status AND s.allow_wholesale_bill AND (s.name ILIKE :q OR s.supplier_code ILIKE :q OR s.gst_number ILIKE :q)""",
    }
    sql = " UNION ALL ".join(v for k, v in parts.items() if not kind or k == kind)
    rows = await db.execute(text(f"SELECT * FROM ({sql}) x ORDER BY name LIMIT :l"), {"q": like, "walkin": svc.WALK_IN_ID, "l": limit})
    return list(rows.mappings().all())


# ── Bills ──────────────────────────────────────────────────────────────────

@router.get("")
async def list_bills(from_date: date, to_date: date, q: str = "", kind: Optional[str] = None, einvoice: Optional[str] = None, status: Optional[str] = None,
                     outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    p: dict = {"fd": from_date, "td": to_date, "q": f"%{q.strip()}%"}
    w = "i.invoice_type = 'wholesale' AND i.invoice_date BETWEEN :fd AND :td AND (i.invoice_no ILIKE :q OR c.name ILIKE :q OR COALESCE(c.gst_number, '') ILIKE :q)" \
        + access.outlet_filter("i.outlet_id", p)
    if kind:
        w += f" AND {KIND} = :k"
        p["k"] = kind
    if status:
        w += " AND i.status = :st"
        p["st"] = status
    if outlet_id:
        w += " AND i.outlet_id = :o"
        p["o"] = outlet_id
    if einvoice == "pending":
        w += " AND i.status <> 'cancelled' AND NULLIF(TRIM(c.gst_number), '') IS NOT NULL AND COALESCE(i.einvoice_status, '') <> 'generated'"
    elif einvoice:
        w += " AND i.einvoice_status = :e"
        p["e"] = einvoice
    rows = (await db.execute(text(f"""SELECT i.id, i.invoice_no, i.invoice_date, i.status, i.payment_mode, i.taxable_amount, i.total_gst, i.total_amount, i.due_amount,
            i.is_interstate, i.einvoice_status, i.einvoice_sandbox, i.einvoice_irn, i.ewb_status, i.ewb_no, c.name AS party, c.gst_number, {KIND} AS kind, o.outlet_name
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN outlets o ON o.id = i.outlet_id
        WHERE {w} ORDER BY i.invoice_date DESC, i.id DESC LIMIT 500"""), p)).mappings().all()
    live = [r for r in rows if r["status"] != "cancelled"]
    return {"rows": list(rows), "totals": {"bills": len(live), "taxable": sum(r["taxable_amount"] for r in live), "gst": sum(r["total_gst"] for r in live),
                                           "total": sum(r["total_amount"] for r in live), "due": sum(r["due_amount"] for r in live)}}


async def interstate_for(db, outlet_id: int, party: dict, ship: Optional[dict] = None) -> bool:
    """IGST vs CGST+SGST from the seller's GSTIN state and the place of supply; a party with no usable state is treated as local."""
    addr = gstzen.resolve(await _company(db), await _one(db, OUTLET, i=outlet_id) or {}, party, ship)
    return bool(addr["pos"] and addr["seller_state"] and addr["pos"] != addr["seller_state"])


@router.post("")
async def create(b: create_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    access.check_outlet(b.outlet_id)
    if b.invoice_date > now_ist().date():
        raise HTTPException(400, "A wholesale bill cannot carry a future date.")
    outlet = await _one(db, OUTLET, i=b.outlet_id)
    if not outlet or outlet["store_type"] == "Franchise":
        raise HTTPException(400, "Choose one of your own stores as the dispatch location.")
    party = await _ensure_customer(db, b.party_type, b.party_id)

    company = await _company(db)
    ship = b.model_dump(include=set(ship_in.model_fields)) if b.ship_to_different else None
    addr = gstzen.resolve(company, outlet, party, ship)
    has_gstin = len((party["gst_number"] or "").strip()) == 15
    problems = list(addr["errors"]) if has_gstin or ship else []
    if has_gstin and addr["buyer"]["gstin"] == addr["seller_gstin"]:
        problems.append("The party has the same GSTIN as the seller: use a Stock Transfer, not a bill.")

    ids = [l.product_id for l in b.items]
    prods = {r["id"]: r for r in (await db.execute(text("SELECT id, name, item_code, unit, gst_percent, hsn_code FROM products WHERE id = ANY(:i)"), {"i": ids})).mappings()}
    if missing := set(ids) - set(prods):
        raise HTTPException(400, f"Unknown item id(s): {sorted(missing)}")
    if has_gstin:
        problems += [f"'{prods[i]['name']}' has HSN '{prods[i]['hsn_code'] or ''}': e-invoice needs 4, 6 or 8 digits (Item Master)." for i in dict.fromkeys(ids) if not gstzen.hsn_ok(prods[i]["hsn_code"])]
    if problems:
        raise HTTPException(400, "Please fix before saving:\n- " + "\n- ".join(problems))

    interstate = bool(addr["pos"] and addr["seller_state"] and addr["pos"] != addr["seller_state"])
    items = []
    for l in b.items:
        p, g = prods[l.product_id], Decimal(str(prods[l.product_id]["gst_percent"] or 0))
        rate = (l.rate / (1 + g / 100)).quantize(Decimal("0.0001")) if b.rates_incl_gst else l.rate
        items.append(invoice_item_in(product_id=p["id"], item_code=p["item_code"], name=p["name"], qty=l.qty, unit=p["unit"] or "PCS", rate=rate,
                                     disc_val=l.disc_pct, disc_type="%", gst_percent=g, hsn_code=p["hsn_code"], batch_id=l.batch_id))
    total = sum(billing_service._calc_item(i, interstate)["total"] for i in items).quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    mode = b.payment_mode.strip().lower()
    if mode == "credit" and party["credit_limit"] and party["credit_limit"] > 0:
        owing = (await svc.customer_outstanding(db, [party["id"]])).get(party["id"], Decimal(0))
        if owing + total > party["credit_limit"]:
            raise HTTPException(400, f"Credit limit ₹{party['credit_limit']:,.2f} would be crossed: owing ₹{owing:,.2f} + this bill ₹{total:,.2f}.")

    data = invoice_create(outlet_id=b.outlet_id, customer_id=party["id"], invoice_type="wholesale", invoice_date=b.invoice_date, invoice_datetime=now_ist(),
                          payment_mode=mode, is_interstate=interstate, notes=(b.notes or "").strip() or None, items=items, round_off=True,
                          paid_amount=Decimal(0) if mode == "credit" else total, discount_approval_no=b.discount_approval_no or None)
    extra = {k: (v.strip() if isinstance(v, str) else v) or None for k, v in (ship or {}).items() if k != "ship_to_different"}
    if ship:
        extra["ship_to_different"] = True
    try:
        inv = await billing_service.create_invoice(db, data, user.user_id, extra=extra)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": inv.id, "invoice_no": inv.invoice_no, "total_amount": inv.total_amount}


async def _bill(db, inv_id: int) -> dict:
    inv = await _one(db, "SELECT * FROM unit_wise_invoices WHERE id = :i AND invoice_type = 'wholesale'", i=inv_id)
    if not inv:
        raise HTTPException(404, "Wholesale bill not found")
    access.check_outlet(inv["outlet_id"])
    return inv


async def _context(db, inv: dict) -> tuple:
    items = [dict(r) for r in (await db.execute(text("SELECT * FROM unit_wise_invoice_items WHERE invoice_id = :i ORDER BY id"), {"i": inv["id"]})).mappings()]
    company = await _company(db)
    outlet = await _one(db, OUTLET, i=inv["outlet_id"]) or {}
    party = await _one(db, f"SELECT c.*, {KIND} AS kind FROM customers c WHERE c.id = :i", i=inv["customer_id"])
    return items, company, outlet, party, gstzen.resolve(company, outlet, party, inv)


@router.get("/{inv_id:int}")
async def detail(inv_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv = await _bill(db, inv_id)
    items, company, outlet, party, addr = await _context(db, inv)
    pays = (await db.execute(text("SELECT payment_no, payment_date, amount, payment_mode, reference_no FROM unit_wise_payments WHERE invoice_id = :i ORDER BY id"), {"i": inv_id})).mappings().all()
    notes = (await db.execute(text("SELECT id, invoice_no, invoice_date, total_amount, status FROM unit_wise_invoices WHERE invoice_type = 'return' AND ref_invoice_no = :n ORDER BY id"), {"n": inv["invoice_no"]})).mappings().all()
    cfg = await gstzen.config(db)
    party = {k: party[k] for k in ("id", "kind", "name", "phone", "email", "gst_number", "address", "city", "state", "pincode", "credit_days", "customer_code")}
    gst_party = len((party["gst_number"] or "").strip()) == 15
    return {"bill": inv, "items": items, "company": company, "outlet": outlet, "party": party, "payments": list(pays), "credit_notes": list(notes),
            "seller_gstin": addr["seller_gstin"], "place_of_supply": addr["pos"], "place_of_supply_name": STATE_CODE_MAP.get(addr["pos"], ""),
            "problems": addr["errors"] if gst_party else [NOT_APPLICABLE], "can_einvoice": gst_party and not addr["errors"], "sandbox": cfg["sandbox"], "has_token": bool(cfg["token"])}


def _frozen(inv: dict):
    if inv["einvoice_status"] == "generated" or inv["ewb_status"] == "generated":
        raise HTTPException(400, "An IRN / E-Way Bill exists for this bill: cancel it first to change the address.")


@router.put("/{inv_id:int}/ship")
async def update_ship(inv_id: int, b: ship_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv = await _bill(db, inv_id)
    _frozen(inv)
    if inv["status"] == "cancelled":
        raise HTTPException(400, "This bill is cancelled.")
    _, _, _, party, _ = await _context(db, inv)
    addr = gstzen.resolve(await _company(db), await _one(db, OUTLET, i=inv["outlet_id"]) or {}, party, b.model_dump())
    if errs := [e for e in addr["errors"] if "hip-to" in e]:
        raise HTTPException(400, "\n".join(errs))
    interstate = bool(addr["pos"] and addr["seller_state"] and addr["pos"] != addr["seller_state"])
    if interstate != inv["is_interstate"]:
        raise HTTPException(400, "This address changes the place of supply (IGST vs CGST+SGST). Cancel the bill and make it again.")
    vals = {k: ((v.strip() if isinstance(v, str) else v) or None) if b.ship_to_different else None for k, v in b.model_dump().items() if k != "ship_to_different"}
    await db.execute(text("UPDATE unit_wise_invoices SET ship_to_different = :on, " + ", ".join(f"{k} = :{k}" for k in vals) + " WHERE id = :i"),
                     {**vals, "on": b.ship_to_different, "i": inv_id})
    await db.commit()
    return {"message": "Delivery address saved"}


@router.post("/{inv_id:int}/receipt")
async def receipt(inv_id: int, b: payment_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv = await _bill(db, inv_id)
    if b.amount <= 0 or b.amount > inv["due_amount"]:
        raise HTTPException(400, f"Amount must be more than 0 and not above the due ₹{inv['due_amount']:,.2f}.")
    await billing_service.check_payment_modes(db, [b.payment_mode], inv["outlet_id"])
    try:
        await billing_service.add_payment(db, inv_id, b, user.user_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"message": "Receipt saved"}


@router.post("/{inv_id:int}/cancel")
async def cancel(inv_id: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    await _bill(db, inv_id)
    try:
        await billing_service.cancel_invoice(db, inv_id, b.reason, user.user_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"message": "Bill cancelled and stock restored"}


# ── E-invoice / e-way bill ─────────────────────────────────────────────────

async def _gsp_ready(db, inv_id: int) -> tuple:
    if not (await db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext('wholesale_irn'), :i)"), {"i": inv_id})).scalar():
        raise HTTPException(409, "This bill is already being sent to the GST portal. Wait a moment.")
    inv = await _bill(db, inv_id)
    if inv["status"] == "cancelled":
        raise HTTPException(400, "This bill is cancelled.")
    items, company, _, party, addr = await _context(db, inv)
    if len((party["gst_number"] or "").strip()) != 15:
        raise HTTPException(400, "Party must have a 15-character GSTIN for E-Invoice.")
    if addr["errors"]:
        raise HTTPException(400, "Address problems:\n- " + "\n- ".join(addr["errors"]))
    if (addr["pos"] != addr["seller_state"]) != inv["is_interstate"]:
        raise HTTPException(400, "This bill's GST type (IGST vs CGST+SGST) no longer matches the party's state. Cancel the bill and make it again.")
    return inv, items, company, addr, await gstzen.config(db)


async def _store(db, inv_id: int, reply: dict, sandbox: bool) -> dict:
    u = gstzen.saved_fields(reply["body"])
    if "einvoice_irn" in u:
        u["einvoice_sandbox"] = sandbox
    if u:
        await db.execute(text("UPDATE unit_wise_invoices SET " + ", ".join(f"{k} = :{k}" for k in u) + " WHERE id = :_i"), {**u, "_i": inv_id})
    await db.commit()                     # the log row and anything the portal issued are kept even when the call is reported as failed
    return u


@router.post("/{inv_id:int}/irn")
async def generate_irn(inv_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv, items, company, addr, cfg = await _gsp_ready(db, inv_id)
    if inv["einvoice_status"] == "generated" and (inv["einvoice_sandbox"] == cfg["sandbox"]):
        raise HTTPException(400, "An IRN already exists for this bill.")
    if bad := [i["name"] for i in items if not gstzen.hsn_ok(i["hsn_code"])]:
        raise HTTPException(400, "HSN must be 4, 6 or 8 digits for: " + ", ".join(bad))
    r = await gstzen.post(db, cfg, "", "GENERATE", gstzen.payload(inv, items, company, addr, cfg), inv_id, user.user_id)
    u = await _store(db, inv_id, r, cfg["sandbox"])
    if not (r["ok"] and u.get("einvoice_irn")):
        raise HTTPException(400, f"GSTZen: {r['message']}")
    await write_audit(db=db, module="wholesale", action="irn", record_id=inv_id, record_no=inv["invoice_no"], description=f"IRN generated{' (sandbox)' if cfg['sandbox'] else ''}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"irn": u["einvoice_irn"], "message": f"E-Invoice generated{' (sandbox)' if cfg['sandbox'] else ''}"}


@router.post("/{inv_id:int}/irn/recheck")
async def recheck_irn(inv_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    """GSTZen has no get-IRN call; posting the same bill again is idempotent and answers with the IRN it holds."""
    inv, items, company, addr, cfg = await _gsp_ready(db, inv_id)
    if not inv["einvoice_irn"] or inv["einvoice_status"] != "generated":
        raise HTTPException(400, "No active IRN on this bill.")
    r = await gstzen.post(db, cfg, "", "CHECK", gstzen.payload(inv, items, company, addr, cfg), inv_id, user.user_id)
    await db.commit()
    irn = r["body"].get("Irn")
    if not irn:
        raise HTTPException(400, f"Check failed. GSTZen: {r['message']}")
    if irn != inv["einvoice_irn"]:
        raise HTTPException(400, f"GSTZen holds a DIFFERENT IRN for this bill: {irn}")
    return {"message": f"IRN confirmed with GSTZen. Status: {r['body'].get('IrnStatus', '')}"}


@router.post("/{inv_id:int}/irn/cancel")
async def cancel_irn(inv_id: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv, items, company, addr, cfg = await _gsp_ready(db, inv_id)
    if inv["einvoice_status"] != "generated":
        raise HTTPException(400, "No active IRN on this bill.")
    if inv["ewb_status"] == "generated":
        raise HTTPException(400, "Cancel the E-Way Bill first: the portal will not cancel an IRN with an active E-Way Bill.")
    body = {**gstzen.payload(inv, items, company, addr, cfg), "CnlRsn": "4", "CnlRem": b.reason}
    r = await gstzen.post(db, cfg, "cancel/", "CANCEL", body, inv_id, user.user_id)
    done = r["ok"] or r["body"].get("IrnStatus") == "CAN"
    if done:
        await db.execute(text("UPDATE unit_wise_invoices SET einvoice_status = 'cancelled' WHERE id = :i"), {"i": inv_id})
    await db.commit()
    if not done:
        raise HTTPException(400, f"Cancel failed. GSTZen: {r['message']}")
    await write_audit(db=db, module="wholesale", action="irn_cancel", record_id=inv_id, record_no=inv["invoice_no"], description=b.reason, user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"message": "E-Invoice cancelled. You can now cancel the bill."}


@router.post("/{inv_id:int}/ewb")
async def generate_ewb(inv_id: int, b: ewb_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv, items, company, addr, cfg = await _gsp_ready(db, inv_id)
    if inv["einvoice_status"] != "generated":
        raise HTTPException(400, "Generate the E-Invoice (IRN) first: the E-Way Bill is created from the IRN.")
    if inv["ewb_status"] == "generated":
        raise HTTPException(400, "An E-Way Bill already exists for this bill.")
    t = b.model_dump()
    t["vehicle_no"] = "".join(c for c in (t["vehicle_no"] or "") if c.isalnum()).upper() or None
    t["transporter_id"] = (t["transporter_id"] or "").strip().upper() or None
    t["transporter_name"] = (t["transporter_name"] or "").strip() or None
    t["transport_doc_no"] = (t["transport_doc_no"] or "").strip() or None
    if errs := gstzen.transport_errors(t):
        raise HTTPException(400, "Please fix:\n- " + "\n- ".join(errs))
    await db.execute(text("UPDATE unit_wise_invoices SET " + ", ".join(f"{k} = :{k}" for k in t) + " WHERE id = :_i"), {**t, "_i": inv_id})
    r = await gstzen.post(db, cfg, "genewb/", "GENEWB", gstzen.payload({**inv, **t}, items, company, addr, cfg, True), inv_id, user.user_id)
    u = await _store(db, inv_id, r, cfg["sandbox"])
    if not u.get("ewb_no"):                # an EwbNo means one exists for this IRN: just made, or already there after a timed-out retry
        raise HTTPException(400, f"GSTZen: {r['message']}")
    await write_audit(db=db, module="wholesale", action="ewb", record_id=inv_id, record_no=inv["invoice_no"], description=f"E-Way Bill {u['ewb_no']}", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"ewb_no": u["ewb_no"], "message": f"E-Way Bill {u['ewb_no']} generated"}


@router.post("/{inv_id:int}/ewb/cancel")
async def cancel_ewb(inv_id: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    inv, items, company, addr, cfg = await _gsp_ready(db, inv_id)
    if inv["ewb_status"] != "generated":
        raise HTTPException(400, "No active E-Way Bill on this bill.")
    body = {**gstzen.payload(inv, items, company, addr, cfg, True), "CnlRsn": "4", "CnlRem": b.reason}
    r = await gstzen.post(db, cfg, "cancelewb/", "CANCELEWB", body, inv_id, user.user_id)
    done = r["ok"] or r["body"].get("EwbStatus") == "CAN"
    if done:
        await db.execute(text("UPDATE unit_wise_invoices SET ewb_status = 'cancelled' WHERE id = :i"), {"i": inv_id})
    await db.commit()
    if not done:
        raise HTTPException(400, f"Cancel failed. GSTZen: {r['message']}")
    await write_audit(db=db, module="wholesale", action="ewb_cancel", record_id=inv_id, record_no=inv["invoice_no"], description=b.reason, user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"message": "E-Way Bill cancelled"}


# ── Ledger ─────────────────────────────────────────────────────────────────

@router.get("/ledger")
async def ledger(kind: Literal["customer", "franchise", "supplier"], party_id: int, from_date: date, to_date: date, db: AsyncSession = Depends(get_db),
                 user: current_user_dep = Depends(get_current_user)):
    """Customer / franchise: positive balance = they owe us. Supplier: net of purchases and bills to them, positive = we owe them."""
    if kind == "supplier":
        return {**await svc.ledger(db, party_id, from_date, to_date), "side": "payable"}
    cid = party_id
    if kind == "franchise":
        cid = (await db.execute(text("SELECT id FROM customers WHERE linked_outlet_id = :i"), {"i": party_id})).scalar()
        if not cid:
            return {"opening": 0, "lines": [], "closing": 0, "side": "receivable"}
    return {**await svc.customer_ledger(db, cid, from_date, to_date), "side": "receivable"}


# ── Settings ───────────────────────────────────────────────────────────────

async def _prefix_preview(db, prefix: str) -> str:
    return prefix + gstzen.fy_code(now_ist().date()) + "0001"


@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    cfg, c = await gstzen.config(db), await _company(db)
    missing = [] if len((c.get("gstin") or "").strip()) == 15 else ["Company GSTIN (Company Settings)"]
    return {"has_token": bool(cfg["token"]), "sandbox": cfg["sandbox"], "sandbox_gstin": cfg["sandbox_gstin"], "prefix": cfg["prefix"], "company_gstin": c.get("gstin"),
            "sample_no": await _prefix_preview(db, cfg["prefix"]), "missing": missing}


@router.put("/settings")
async def save_settings(b: settings_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    _only_admin(user)
    prefix, sg = b.prefix.strip().upper(), (b.sandbox_gstin or "").strip().upper()
    if not gstzen.valid_prefix(prefix):
        raise HTTPException(400, "Number prefix: up to 8 capital letters, digits, / or -, starting with a letter or 1-9.")
    if sg and not validate_gstin(sg)[0]:
        raise HTTPException(400, "Sandbox GSTIN is not valid.")
    await db.execute(text("""UPDATE company_settings SET gstzen_sandbox = :s, gstzen_sandbox_gstin = :g, wholesale_invoice_prefix = :p,
        gstzen_token = COALESCE(NULLIF(:t, ''), gstzen_token) WHERE id = (SELECT id FROM company_settings ORDER BY id LIMIT 1)"""),
                     {"s": b.sandbox, "g": sg or None, "p": prefix, "t": (b.token or "").strip()})
    await write_audit(db=db, module="wholesale", action="settings", record_id=0, description=f"E-invoice settings saved: sandbox={b.sandbox}, prefix={prefix}, token {'changed' if (b.token or '').strip() else 'unchanged'}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return await get_settings(db, user)


@router.post("/settings/test")
async def test_settings(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    _only_admin(user)
    c = await _company(db)
    if len((c.get("gstin") or "").strip()) != 15:
        raise HTTPException(400, "Set the Company GSTIN in Company Settings first.")
    r = await gstzen.test_connection(db, await gstzen.config(db), c["gstin"].strip().upper(), user.user_id)
    await db.commit()
    return r


@router.get("/logs")
async def logs(invoice_id: Optional[int] = None, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    p: dict = {}
    w = ""
    if invoice_id:
        w = "WHERE l.invoice_id = :i"
        p["i"] = invoice_id
    rows = await db.execute(text(f"""SELECT l.id, l.created_at, l.action, l.sandbox, l.http_code, l.ok, l.message, l.request, l.response, i.invoice_no
        FROM einvoice_api_logs l LEFT JOIN unit_wise_invoices i ON i.id = l.invoice_id {w} ORDER BY l.id DESC LIMIT 100"""), p)
    return list(rows.mappings().all())
