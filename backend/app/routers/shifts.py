from datetime import date
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.services import shift_service as svc

router = APIRouter(prefix="/shifts", tags=["day & shift"])
manager = require_role(*svc.MANAGER_ROLES)


class day_open_in(BaseModel):
    outlet_id: int = 0
    business_date: date = Field(default_factory=date.today)
    remarks: Optional[str] = None


class day_close_in(BaseModel):
    remarks: Optional[str] = None
    safe_counted: Optional[Decimal] = Field(None, ge=0)  # physical count of the safe after all shifts are closed
    force: bool = False  # auto-close open shifts at system figures (emergency day close)


class shift_open_in(BaseModel):
    outlet_id: int = 0
    opening_cash: Decimal = Field(Decimal("0"), ge=0)
    shift_name: str = "General"
    terminal_no: Optional[str] = None
    remarks: Optional[str] = None


class shift_close_in(BaseModel):
    actual: dict[str, Decimal] = {}         # counted amount per payment mode
    denominations: Optional[dict] = None    # {"500": n, ..., "coins": x}; overrides actual["cash"]
    remarks: Optional[str] = None


async def _run(coro):
    try:
        return await coro
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/status")
async def status(outlet_id: int = Query(0), db: AsyncSession = Depends(get_db),
                 user: current_user_dep = Depends(get_current_user)):
    """What the POS / Day & Shift screen needs: the outlet's open day and my open shift."""
    day = await svc.open_day(db, outlet_id)
    mine = await svc.open_shift_of(db, user.user_id)
    last_closed = (await db.execute(text("""
        SELECT business_date FROM business_days WHERE outlet_id = :loc AND status = 'closed'
        ORDER BY business_date DESC LIMIT 1"""), {"loc": outlet_id})).scalar()
    return {
        "outlet_id": outlet_id,
        "outlet_name": await svc.outlet_name(db, outlet_id),
        "day": await svc.get_day(db, day["id"]) if day else None,
        "my_shift": await svc.get_shift(db, mine["id"]) if mine else None,
        "suggested_opening": await svc.suggested_opening(db, outlet_id),
        "last_closed_date": last_closed,
        "can_manage_day": user.role in svc.MANAGER_ROLES,
    }


@router.post("/day/open")
async def day_open(body: day_open_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(manager)):
    return await _run(svc.day_open(db, body.outlet_id, body.business_date, body.remarks, user))


@router.post("/day/reopen")
async def day_reopen(outlet_id: int = Query(0), db: AsyncSession = Depends(get_db),
                     user: current_user_dep = Depends(manager)):
    return await _run(svc.day_reopen(db, outlet_id, user))


@router.get("/days")
async def list_days(outlet_id: Optional[int] = Query(None), from_date: Optional[date] = None, to_date: Optional[date] = None,
                    limit: int = Query(60, le=200), db: AsyncSession = Depends(get_db),
                    user: current_user_dep = Depends(get_current_user)):
    sp: dict = {}
    sf = access.outlet_filter("d.outlet_id", sp)
    rows = (await db.execute(text(f"""
        SELECT d.id, d.outlet_id, COALESCE(o.outlet_name, 'Head Office') AS outlet_name, d.business_date, d.status,
               d.opened_at, d.closed_at, ou.name AS opened_by_name, cu.name AS closed_by_name,
               d.total_bills, d.net_sales, d.total_collected, d.total_cash, d.total_shortage, d.total_excess
        FROM business_days d LEFT JOIN outlets o ON o.id = d.outlet_id
        LEFT JOIN users ou ON ou.id = d.opened_by LEFT JOIN users cu ON cu.id = d.closed_by
        WHERE (CAST(:loc AS INT) IS NULL OR d.outlet_id = :loc) {sf}
          AND (CAST(:fd AS DATE) IS NULL OR d.business_date >= :fd) AND (CAST(:td AS DATE) IS NULL OR d.business_date <= :td)
        ORDER BY d.business_date DESC, d.id DESC LIMIT :lim"""),
        {"loc": outlet_id, "fd": from_date, "td": to_date, "lim": limit, **sp})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/day/{day_id}")
async def get_day(day_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.get_day(db, day_id))


@router.post("/day/{day_id}/close")
async def day_close(day_id: int, body: day_close_in, db: AsyncSession = Depends(get_db),
                    user: current_user_dep = Depends(manager)):
    return await _run(svc.day_close(db, day_id, body.remarks, body.force, user, body.safe_counted))


@router.post("/open")
async def shift_open(body: shift_open_in, db: AsyncSession = Depends(get_db),
                     user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.shift_open(db, body.outlet_id, body.opening_cash, body.shift_name,
                                     body.terminal_no, body.remarks, user))


@router.get("")
async def list_shifts(outlet_id: Optional[int] = Query(None), day_id: Optional[int] = None,
                      cashier_id: Optional[int] = None, from_date: Optional[date] = None, to_date: Optional[date] = None,
                      limit: int = Query(100, le=500), db: AsyncSession = Depends(get_db),
                      user: current_user_dep = Depends(get_current_user)):
    sp: dict = {}
    sf = access.outlet_filter("s.outlet_id", sp)
    rows = (await db.execute(text(f"""
        SELECT s.id, s.business_day_id, s.outlet_id, COALESCE(o.outlet_name, 'Head Office') AS outlet_name,
               s.business_date, s.shift_name, s.terminal_no, s.status, s.opened_at, s.closed_at,
               u.name AS cashier_name, s.opening_cash, s.total_bills, s.total_sales,
               s.expected_cash, s.actual_cash, s.short_amount, s.excess_amount
        FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id LEFT JOIN outlets o ON o.id = s.outlet_id
        WHERE (CAST(:loc AS INT) IS NULL OR s.outlet_id = :loc) {sf} AND (CAST(:day AS INT) IS NULL OR s.business_day_id = :day)
          AND (CAST(:cid AS INT) IS NULL OR s.cashier_id = :cid)
          AND (CAST(:fd AS DATE) IS NULL OR s.business_date >= :fd) AND (CAST(:td AS DATE) IS NULL OR s.business_date <= :td)
        ORDER BY s.opened_at DESC LIMIT :lim"""),
        {"loc": outlet_id, "day": day_id, "cid": cashier_id, "fd": from_date, "td": to_date, "lim": limit, **sp})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{shift_id}")
async def get_shift(shift_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.get_shift(db, shift_id))


@router.post("/{shift_id}/close")
async def shift_close(shift_id: int, body: shift_close_in, db: AsyncSession = Depends(get_db),
                      user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.shift_close(db, shift_id, body.actual, body.denominations, body.remarks, user))
