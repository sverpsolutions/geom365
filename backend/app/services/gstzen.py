"""GST e-invoice (IRN) and e-way bill through GSTZen: the API Gupta Bros / NCG use (GstzenGsp.php, GstAddress.php).

Every call POSTs the full NIC e-invoice JSON (schema 1.1) with one `Token` header. Replies share one shape: status (1/0), message,
IrnStatus / EwbStatus (GEN, ERR, CAN, NON), Irn, AckNo, AckDt, EwbNo, EwbDt, EwbValidTill. Sandbox sends a GSTZen demo seller GSTIN
for the company's own state to the government test portal, so CGST+SGST vs IGST stays as on the bill.
"""
import json
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

import httpx
from sqlalchemy import text

from app.utils.gst_validators import STATE_CODE_MAP, validate_gstin

BASE_URL = "https://my.gstzen.in/~gstzen/a/post-einvoice-data/einvoice-json/"

DEMO_GSTINS = {
    "01": "01AADCG4992P1Z7", "03": "03AADCG4992P1Z3", "04": "04AADCG4992P1Z1", "05": "05AADCG4992P1ZZ", "06": "06AADCG4992P1ZX",
    "07": "07AADCG4992P1ZV", "08": "08AADCG4992P1ZT", "09": "09AADCG4992P1ZR", "10": "10AADCG4992P1Z8", "18": "18AADCG4992P1ZS",
    "19": "19AADCG4992P1ZQ", "20": "20AADCG4992P1Z7", "21": "21AADCG4992P1Z5", "22": "22AADCG4992P1Z3", "23": "23AADCG4992P1Z1",
    "24": "24AADCG4992P1ZZ", "27": "27AADCG4992P1ZT", "29": "29AADCG4992P1ZP", "30": "30AADCG4992P1Z6", "32": "32AADCG4992P1Z2",
    "33": "33AADCG4992P1Z0", "36": "36AADCG4992P1ZU", "37": "37AADCG4992P2ZR",
}

# First two digits of the PIN codes of each state (India Post zones)
PIN_PREFIX = {
    "01": ["18", "19"], "02": ["17"], "03": ["14", "15", "16"], "04": ["16"], "05": ["24", "26"], "06": ["12", "13"], "07": ["11"],
    "08": ["30", "31", "32", "33", "34"], "09": ["20", "21", "22", "23", "24", "25", "26", "27", "28"], "10": ["80", "81", "82", "84", "85"],
    "11": ["73"], "12": ["79"], "13": ["79"], "14": ["79"], "15": ["79"], "16": ["79"], "17": ["79"], "18": ["78"],
    "19": ["70", "71", "72", "73", "74"], "20": ["81", "82", "83", "84", "85"], "21": ["75", "76", "77"], "22": ["49"],
    "23": ["45", "46", "47", "48"], "24": ["36", "37", "38", "39"], "26": ["36", "39"], "27": ["40", "41", "42", "43", "44"],
    "29": ["56", "57", "58", "59"], "30": ["40"], "31": ["68"], "32": ["67", "68", "69"], "33": ["60", "61", "62", "63", "64"],
    "34": ["53", "60", "67"], "35": ["74"], "36": ["50"], "37": ["50", "51", "52", "53"], "38": ["19"],
}

UQC = {"PCS": "PCS", "PC": "PCS", "NOS": "NOS", "UNIT": "NOS", "KG": "KGS", "KGS": "KGS", "GM": "GMS", "GMS": "GMS", "G": "GMS",
       "LTR": "LTR", "L": "LTR", "LITRE": "LTR", "ML": "MLT", "BOX": "BOX", "CTN": "CTN", "CARTON": "CTN", "PKT": "PAC", "PACK": "PAC",
       "BAG": "BAG", "BOTTLE": "BTL", "BTL": "BTL", "SET": "SET", "DOZEN": "DOZ", "DOZ": "DOZ", "MTR": "MTR", "ROLL": "ROL", "PAIR": "PRS"}

_ALIAS = {"newdelhi": "07", "nctofdelhi": "07", "orissa": "21", "pondicherry": "34", "uttaranchal": "05", "up": "09", "mp": "23"}


def _letters(s) -> str:
    return re.sub(r"[^a-z]", "", str(s or "").lower().replace("&", "and"))


_BY_NAME = {_letters(n): c for c, n in STATE_CODE_MAP.items()}


def state_code(name) -> str:
    n = _letters(name)
    return _BY_NAME.get(n) or _ALIAS.get(n, "")


def gstin_state(gstin) -> str:
    g = str(gstin or "").strip().upper()
    return g[:2] if len(g) == 15 and g[:2] in STATE_CODE_MAP else ""


def pin_error(pin, state: str, what: str) -> Optional[str]:
    pin = str(pin or "").strip()
    if not pin:
        return f"{what} is missing: it is compulsory for E-Invoice / E-Way Bill."
    if not re.fullmatch(r"[1-9][0-9]{5}", pin):
        return f"{what} '{pin}' is not a valid 6-digit PIN code."
    allowed = PIN_PREFIX.get(state)
    if allowed and pin[:2] not in allowed:
        return f"{what} {pin} does not belong to {STATE_CODE_MAP.get(state)} (PINs there start with {' / '.join(allowed)})."
    return None


def hsn_ok(hsn) -> bool:
    return bool(re.fullmatch(r"\d{4}|\d{6}|\d{8}", str(hsn or "").strip()))


def _clean(v, n: int = 100) -> str:
    v = re.sub(r"[\r\n]+", ", ", str(v or "").strip())
    return re.sub(r",\s*,", ",", v).strip(", ")[:n]


def seller_gstin(company: dict, outlet: dict) -> str:
    """The dispatching store's own GSTIN when it has one, else the company GSTIN."""
    own = str(outlet.get("gst_number") or "").strip().upper()
    return own if len(own) == 15 else str(company.get("gstin") or "").strip().upper()


def resolve(company: dict, outlet: dict, party: dict, ship: Optional[dict]) -> dict:
    """Every address the bill needs, validated the same way at bill creation, IRN and e-way bill."""
    errors: list[str] = []
    gstin = seller_gstin(company, outlet)
    seller_state = gstin_state(gstin)
    if not seller_state:
        errors.append("Company GSTIN (Company Settings) or the store's GSTIN (Outlet Master) is missing or invalid.")

    label = f"Store '{outlet.get('outlet_name')}'"
    dispatch = {"addr1": _clean(outlet.get("address")), "place": _clean(outlet.get("city")), "pin": str(outlet.get("pincode") or "").strip()}
    if seller_state and (e := pin_error(dispatch["pin"], seller_state, f"{label} PIN code (Outlet Master)")):
        errors.append(e)
    if len(dispatch["addr1"]) < 3:
        errors.append(f"{label} address is missing (Outlet Master): it is the dispatch address.")
    if not dispatch["place"]:
        errors.append(f"{label} city is missing (Outlet Master).")

    buyer_gstin = str(party.get("gst_number") or "").strip().upper()
    buyer_state = gstin_state(buyer_gstin) or state_code(party.get("state"))
    name = f"Party '{party.get('name')}'"
    buyer = {"gstin": buyer_gstin, "name": party.get("name") or "", "addr1": _clean(party.get("address")), "place": _clean(party.get("city")),
             "pin": str(party.get("pincode") or "").strip(), "state": buyer_state}
    if not buyer_state:
        errors.append(f"{name} has no valid GSTIN / state.")
    elif e := pin_error(buyer["pin"], buyer_state, f"{name} PIN code"):
        errors.append(e)
    if len(buyer["addr1"]) < 3:
        errors.append(f"{name} address is missing.")
    if not buyer["place"]:
        errors.append(f"{name} city is missing.")

    to = None
    if ship and ship.get("ship_to_different"):
        to = {"gstin": str(ship.get("ship_gstin") or "").strip().upper(), "name": str(ship.get("ship_name") or "").strip(),
              "addr1": _clean(ship.get("ship_address")), "place": _clean(ship.get("ship_place")), "pin": str(ship.get("ship_pincode") or "").strip(),
              "state": str(ship.get("ship_state_code") or "").zfill(2)}
        if to["state"] not in STATE_CODE_MAP:
            errors.append("Ship-to state is not selected.")
        elif e := pin_error(to["pin"], to["state"], "Ship-to PIN code"):
            errors.append(e)
        if not to["name"]:
            errors.append("Ship-to name is missing.")
        if len(to["addr1"]) < 3:
            errors.append("Ship-to address is missing.")
        if not to["place"]:
            errors.append("Ship-to city / place is missing.")
        if to["gstin"] and gstin_state(to["gstin"]) != to["state"]:
            errors.append("Ship-to GSTIN does not match the ship-to state.")

    return {"seller_gstin": gstin, "seller_state": seller_state, "dispatch": dispatch, "buyer": buyer, "ship": to,
            "pos": to["state"] if to else buyer_state, "errors": errors}


async def config(db) -> dict:
    r = (await db.execute(text("""SELECT gstzen_token, gstzen_sandbox, gstzen_sandbox_gstin, wholesale_invoice_prefix
                                  FROM company_settings ORDER BY id LIMIT 1"""))).mappings().first()
    return {"token": ((r and r["gstzen_token"]) or "").strip(), "sandbox": bool(r["gstzen_sandbox"]) if r else True,
            "sandbox_gstin": ((r and r["gstzen_sandbox_gstin"]) or "").strip().upper(), "prefix": (r and r["wholesale_invoice_prefix"]) or "WS"}


def api_gstin(cfg: dict, real: str) -> str:
    """Seller GSTIN sent to GSTZen: in sandbox an override, else the demo GSTIN of the company's state."""
    if not cfg["sandbox"]:
        return real
    if len(cfg["sandbox_gstin"]) == 15:
        return cfg["sandbox_gstin"]
    return DEMO_GSTINS.get(real[:2], DEMO_GSTINS["27"])


def _f(v, places: str = "0.01") -> float:
    return float(Decimal(str(v or 0)).quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _line_discount(it: dict) -> Decimal:
    """Discount the line carries, excl. GST. Worked back from the taxable value so AssAmt = TotAmt - Discount always holds."""
    taxable, val = Decimal(str(it["taxable_amt"])), Decimal(str(it.get("disc_val") or 0))
    if it.get("disc_type") == "%":
        return (taxable * val / (100 - val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if 0 < val < 100 else Decimal(0)
    return (val * Decimal(str(it["qty"]))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def payload(inv: dict, items: list[dict], company: dict, addr: dict, cfg: dict, with_ewb: bool = False) -> dict:
    gstin = api_gstin(cfg, addr["seller_gstin"])
    d, b = addr["dispatch"], addr["buyer"]
    rows = []
    for n, it in enumerate(items, 1):
        ass, disc = Decimal(str(it["taxable_amt"])), _line_discount(it)
        tot, qty = ass + disc, Decimal(str(it["qty"]))
        rows.append({"SlNo": str(n), "PrdDesc": _clean(it.get("name"), 300), "IsServc": "N", "HsnCd": str(it.get("hsn_code") or "").strip(),
                     "Qty": _f(qty, "0.001"), "Unit": UQC.get(str(it.get("unit") or "").strip().upper(), "OTH"),
                     "UnitPrice": _f(tot / qty, "0.001") if qty else 0, "TotAmt": _f(tot), "Discount": _f(disc), "AssAmt": _f(ass),
                     "GstRt": _f(it["gst_percent"]), "IgstAmt": _f(it["igst_amount"]), "CgstAmt": _f(it["cgst_amount"]),
                     "SgstAmt": _f(it["sgst_amount"]), "CesAmt": 0, "TotItemVal": _f(it["total"])})
    p = {
        "Version": "1.1",
        "TranDtls": {"TaxSch": "GST", "SupTyp": "B2B", "RegRev": "N", "IgstOnIntra": "N"},
        "DocDtls": {"Typ": "INV", "No": inv["invoice_no"], "Dt": inv["invoice_date"].strftime("%d/%m/%Y")},
        "SellerDtls": {"Gstin": gstin, "LglNm": _clean(company.get("legal_name") or company.get("brand_name")) or "Seller",
                       "Addr1": d["addr1"], "Loc": d["place"], "Pin": int(d["pin"]), "Stcd": gstin[:2]},
        "BuyerDtls": {"Gstin": b["gstin"], "LglNm": _clean(b["name"]) or "Buyer", "Pos": addr["pos"], "Addr1": b["addr1"], "Loc": b["place"],
                      "Pin": int(b["pin"]), "Stcd": b["state"]},
        "ItemList": rows,
        # Discount here is an invoice-level deduction; line discounts are already inside AssAmt, so it stays 0 or the total would not tally.
        "ValDtls": {"AssVal": _f(inv["taxable_amount"]), "CgstVal": _f(inv["cgst_amount"]), "SgstVal": _f(inv["sgst_amount"]),
                    "IgstVal": _f(inv["igst_amount"]), "CesVal": 0, "Discount": 0, "RndOffAmt": _f(inv["round_off"]), "TotInvVal": _f(inv["total_amount"])},
    }
    if addr["ship"]:
        s = addr["ship"]
        p["ShipDtls"] = {k: v for k, v in {"Gstin": s["gstin"] or None, "LglNm": _clean(s["name"]), "TrdNm": _clean(s["name"]), "Addr1": s["addr1"],
                                           "Loc": s["place"], "Pin": int(s["pin"]), "Stcd": s["state"]}.items() if v not in (None, "")}
    if with_ewb:
        e = {"TransId": str(inv.get("transporter_id") or "").strip().upper(), "TransName": _clean(inv.get("transporter_name")),
             "TransMode": str(inv.get("transport_mode") or 1), "Distance": max(0, int(inv.get("transport_distance") or 0)),
             "TransDocNo": str(inv.get("transport_doc_no") or "").strip(),
             "TransDocDt": inv["transport_doc_date"].strftime("%d/%m/%Y") if inv.get("transport_doc_date") else "",
             "VehNo": re.sub(r"[^A-Za-z0-9]", "", str(inv.get("vehicle_no") or "")).upper(), "VehType": inv.get("vehicle_type") or "R"}
        # NIC rejects empty optional transport fields, so blanks are left out
        if len(e["TransId"]) != 15:
            e.pop("TransId")
        if len(e["TransName"]) < 3:
            e.pop("TransName")
        for k in ("TransDocNo", "TransDocDt", "VehNo"):
            if not e[k]:
                e.pop(k)
        if "VehNo" not in e:                 # Part-A only: the transporter adds the vehicle later
            e.pop("VehType")
            if e["TransMode"] == "1":
                e.pop("TransMode")
        p["EwbDtls"] = e
    return p


def transport_errors(t: dict) -> list[str]:
    e, mode, veh, tid = [], int(t.get("transport_mode") or 0), str(t.get("vehicle_no") or ""), str(t.get("transporter_id") or "")
    if mode not in (1, 2, 3, 4):
        e.append("Select a transport mode.")
    if mode == 1 and not veh and not tid:
        e.append("Road transport needs a Vehicle No (or a Transporter ID if the transporter will add the vehicle).")
    if veh and not re.fullmatch(r"[A-Z]{2}[0-9A-Z]{5,13}", veh):
        e.append(f"Vehicle No '{veh}' looks wrong (e.g. HR26AB1234).")
    if mode > 1 and not (t.get("transport_doc_no") and t.get("transport_doc_date")):
        e.append("Rail / Air / Ship needs the Transport Doc No and Date.")
    if tid and not re.fullmatch(r"[0-9A-Z]{15}", tid):
        e.append("Transporter ID must be the 15-character transporter GSTIN / enrolment ID.")
    if t.get("transporter_name") and len(t["transporter_name"]) < 3:
        e.append("Transporter Name must be at least 3 characters.")
    if not 0 <= int(t.get("transport_distance") or 0) <= 4000:
        e.append("Distance must be 0 to 4000 KM (0 = the portal works it out from the PIN codes).")
    return e


def parse_dt(v) -> Optional[datetime]:
    for f in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %I:%M %p", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(v).strip(), f)
        except ValueError:
            continue
    return None


def saved_fields(b: dict) -> dict:
    """Invoice columns for whatever a GSTZen reply says about the IRN / e-way bill."""
    u: dict = {}
    if b.get("Irn"):
        u.update(einvoice_irn=b["Irn"], einvoice_status="cancelled" if b.get("IrnStatus") == "CAN" else "generated")
        if b.get("AckNo"):
            u["einvoice_ack_no"] = str(b["AckNo"])
        if b.get("AckDt"):
            u["einvoice_ack_date"] = parse_dt(b["AckDt"])
        if b.get("SignedQRCode"):
            u["einvoice_qr_data"] = b["SignedQRCode"]
    if b.get("EwbNo"):
        u.update(ewb_no=str(b["EwbNo"]), ewb_status="cancelled" if b.get("EwbStatus") == "CAN" else "generated")
        if b.get("EwbDt"):
            u["ewb_date"] = parse_dt(b["EwbDt"])
        if b.get("EwbValidTill"):
            u["ewb_valid_until"] = parse_dt(b["EwbValidTill"])
    return u


async def post(db, cfg: dict, path: str, action: str, body: dict, invoice_id: Optional[int], user_id: Optional[int]) -> dict:
    """POST to GSTZen and log it. The token travels only in the header, which is never logged."""
    if not cfg["token"]:
        return {"ok": False, "message": "GSTZen token is not set (Wholesale → E-Invoice Settings).", "body": {}, "http_code": None}
    code, b, msg = None, {}, ""
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(BASE_URL + path, json=body, headers={"Token": cfg["token"], "Content-Type": "application/json"})
        code = r.status_code
        try:
            b = r.json()
        except ValueError:
            msg = f"HTTP {code} from GSTZen"
        if not isinstance(b, dict):
            b = {}
    except httpx.HTTPError as e:
        msg = f"GSTZen not reachable: {type(e).__name__}. Try again; a repeat cannot create a second IRN."
    msg = str(b.get("message") or "").strip() or msg or f"HTTP {code} from GSTZen"
    ok = str(b.get("status", "0")) == "1"
    kept = {k: v for k, v in b.items() if k not in ("SignedInvoice", "SignedQRCode")}   # bulky, and already on the invoice
    await db.execute(text("""INSERT INTO einvoice_api_logs (invoice_id, action, sandbox, http_code, ok, message, request, response, created_by)
                             VALUES (:i, :a, :s, :c, :o, :m, CAST(:rq AS JSONB), CAST(:rs AS JSONB), :u)"""),
                     {"i": invoice_id, "a": action, "s": cfg["sandbox"], "c": code, "o": ok, "m": msg[:1000], "rq": json.dumps(body, default=str),
                      "rs": json.dumps(kept, default=str), "u": user_id})
    return {"ok": ok, "message": msg, "body": b, "http_code": code}


async def test_connection(db, cfg: dict, gstin: str, user_id: Optional[int]) -> dict:
    """Token + seller GSTIN check that creates nothing: a payload with only the seller GSTIN is refused for the missing date once both pass."""
    seller = api_gstin(cfg, gstin)
    r = await post(db, cfg, "", "TEST", {"SellerDtls": {"Gstin": seller}}, None, user_id)
    mode = "SANDBOX" if cfg["sandbox"] else "PRODUCTION"
    if r["http_code"] == 403:
        return {"ok": False, "message": f"GSTZen token is invalid ({r['message']})"}
    if r["http_code"] == 404:
        return {"ok": False, "message": f"GSTIN {seller} is not in this GSTZen account"}
    if r["http_code"] == 200 and "missing" in r["message"].lower():
        return {"ok": True, "message": f"GSTZen connection OK: token valid, seller GSTIN {seller} ({mode})"}
    return {"ok": False, "message": f"Unexpected GSTZen reply: {r['message']}"}


def fy_code(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def valid_prefix(p: str) -> bool:
    return bool(re.fullmatch(r"[A-Z1-9][A-Z0-9/-]{0,7}", p))


if __name__ == "__main__":
    assert state_code("HARYANA ") == "06" and state_code("New Delhi") == "07" and state_code("Jammu & Kashmir") == "01" and state_code("") == ""
    assert pin_error("110001", "07", "x") is None and "does not belong" in pin_error("400001", "07", "x") and "valid" in pin_error("12", "07", "x")
    assert hsn_ok("1902") and hsn_ok("190230") and hsn_ok("19023010") and not hsn_ok("190") and not hsn_ok("19023")
    assert fy_code(date(2026, 11, 9)) == "2627" and fy_code(date(2027, 3, 31)) == "2627" and fy_code(date(2027, 4, 1)) == "2728"
    assert valid_prefix("WS") and valid_prefix("GST-") and not valid_prefix("0X") and not valid_prefix("ws")

    co, out = {"gstin": "07AABCU9603R1ZP", "legal_name": "Seller Pvt Ltd"}, {"outlet_name": "HO", "address": "1 Main Road", "city": "Delhi", "pincode": "110001"}
    pty = {"name": "Buyer", "gst_number": "06AABCU9603R1ZN", "address": "2 Mall Road", "city": "Gurugram", "pincode": "122001", "state": "Haryana"}
    a = resolve(co, out, pty, None)
    assert a["errors"] == [] and a["seller_state"] == "07" and a["pos"] == "06"
    assert resolve(co, out, {**pty, "pincode": "400001"}, None)["errors"], "wrong-state PIN must be refused"
    shipped = resolve(co, out, pty, {"ship_to_different": True, "ship_name": "Depot", "ship_address": "3 Link Road", "ship_place": "Delhi",
                                     "ship_pincode": "110002", "ship_state_code": "07"})
    assert shipped["errors"] == [] and shipped["pos"] == "07", "place of supply follows the ship-to state"

    # 10% line discount: 90 taxable means 100 before discount; the header Discount must stay 0 (see payload)
    inv = {"invoice_no": "WS26270001", "invoice_date": date(2026, 11, 9), "taxable_amount": 90, "cgst_amount": 0, "sgst_amount": 0, "igst_amount": 4.5,
           "round_off": Decimal("0.50"), "total_amount": 95}
    it = {"name": "Tin 200g", "hsn_code": "21069099", "qty": 2, "unit": "CARTON", "taxable_amt": 90, "disc_val": 10, "disc_type": "%", "gst_percent": 5,
          "igst_amount": 4.5, "cgst_amount": 0, "sgst_amount": 0, "total": 94.5}
    cfg = {"sandbox": True, "sandbox_gstin": "", "token": "x"}
    p = payload(inv, [it], co, a, cfg)
    row = p["ItemList"][0]
    assert (row["TotAmt"], row["Discount"], row["AssAmt"], row["UnitPrice"], row["Unit"]) == (100, 10, 90, 50, "CTN")
    v = p["ValDtls"]
    assert v["Discount"] == 0 and round(v["AssVal"] + v["IgstVal"] + v["RndOffAmt"], 2) == v["TotInvVal"]
    assert p["SellerDtls"]["Gstin"] == DEMO_GSTINS["07"] and p["SellerDtls"]["Stcd"] == "07"
    assert payload(inv, [it], co, a, {**cfg, "sandbox": False})["SellerDtls"]["Gstin"] == "07AABCU9603R1ZP"

    road = payload({**inv, "transport_mode": 1, "vehicle_no": "hr26ab1234", "transport_distance": 40}, [it], co, a, cfg, True)["EwbDtls"]
    assert road == {"TransMode": "1", "Distance": 40, "VehNo": "HR26AB1234", "VehType": "R"}
    part_a = payload({**inv, "transport_mode": 1, "transporter_id": "06AABCU9603R1ZN", "transporter_name": "Ramesh Roadways"}, [it], co, a, cfg, True)["EwbDtls"]
    assert "VehNo" not in part_a and "VehType" not in part_a and "TransMode" not in part_a and part_a["TransId"] == "06AABCU9603R1ZN"
    assert not transport_errors({"transport_mode": 1, "vehicle_no": "HR26AB1234"}) and transport_errors({"transport_mode": 1})
    assert parse_dt("2026-11-09 12:30:00") == datetime(2026, 11, 9, 12, 30) and parse_dt("09/11/2026 01:05:00 PM").hour == 13 and parse_dt("x") is None
    assert saved_fields({"Irn": "A", "IrnStatus": "CAN"})["einvoice_status"] == "cancelled"
    assert validate_gstin(DEMO_GSTINS["07"])[0], "demo GSTIN format"
    print("gstzen ok")
