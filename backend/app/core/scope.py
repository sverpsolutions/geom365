"""Enterprise Role-Based Data Scope Engine.
Enforces multi-region, multi-zone, multi-store and multi-category data isolation at the database query layer.
"""
from dataclasses import dataclass, field
from typing import Optional, List, Set, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import user as UserModel


@dataclass
class UserScope:
    user_id: int
    username: str
    role: str
    role_id: Optional[int] = None
    is_unrestricted: bool = False
    region_ids: List[int] = field(default_factory=list)
    region_names: Dict[int, str] = field(default_factory=dict)
    zone_ids: List[int] = field(default_factory=list)
    zone_names: Dict[int, str] = field(default_factory=dict)
    outlet_ids: List[int] = field(default_factory=list)
    outlet_names: Dict[int, str] = field(default_factory=dict)
    category_ids: List[int] = field(default_factory=list)
    category_names: Dict[int, str] = field(default_factory=dict)
    subcategory_ids: List[int] = field(default_factory=list)
    default_template_id: Optional[int] = None

    def can_access_region(self, region_id: Optional[int]) -> bool:
        if self.is_unrestricted or region_id is None:
            return True
        return region_id in self.region_ids

    def can_access_zone(self, zone_id: Optional[int]) -> bool:
        if self.is_unrestricted or zone_id is None:
            return True
        return zone_id in self.zone_ids

    def can_access_outlet(self, outlet_id: Optional[int]) -> bool:
        if self.is_unrestricted or outlet_id is None:
            return True
        return outlet_id in self.outlet_ids

    def can_access_category(self, category_id: Optional[int]) -> bool:
        if self.is_unrestricted or category_id is None:
            return True
        return category_id in self.category_ids

    def validate_outlet_access(self, outlet_id: Optional[int]) -> Optional[int]:
        """Validates requested outlet against permitted scope. Raises HTTP 403 if forbidden."""
        if outlet_id is None:
            return None
        if not self.can_access_outlet(outlet_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: You are not authorized to view store #{outlet_id}."
            )
        return outlet_id

    def validate_category_access(self, category_id: Optional[int]) -> Optional[int]:
        """Validates requested category against permitted scope. Raises HTTP 403 if forbidden."""
        if category_id is None:
            return None
        if not self.can_access_category(category_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: You are not authorized to view category #{category_id}."
            )
        return category_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "role": self.role,
            "is_unrestricted": self.is_unrestricted,
            "permitted_regions": [
                {"id": rid, "name": self.region_names.get(rid, f"Region {rid}")}
                for rid in self.region_ids
            ],
            "permitted_zones": [
                {"id": zid, "name": self.zone_names.get(zid, f"Zone {zid}")}
                for zid in self.zone_ids
            ],
            "permitted_outlets": [
                {"id": oid, "name": self.outlet_names.get(oid, f"Store {oid}")}
                for oid in self.outlet_ids
            ],
            "permitted_categories": [
                {"id": cid, "name": self.category_names.get(cid, f"Category {cid}")}
                for cid in self.category_ids
            ],
            "default_template_id": self.default_template_id
        }


async def get_user_scope(db: AsyncSession, current_user: UserModel) -> UserScope:
    """Computes effective data boundaries for the current authenticated user.
    - superadmin / admin: Unrestricted access across all regions, zones, stores and categories.
    - Regional Manager: scoped to assigned regions (all zones and stores inside).
    - Zonal Manager / ASM: scoped to assigned zones (all stores inside).
    - Store Manager / Staff: strictly bounded by user_store_assignments or single outlet_id.
    - Category Manager: scoped to user_category_assignments.
    """
    user_role = (current_user.role or "").lower()
    is_unrestricted = user_role in ("admin", "superadmin")
    
    if is_unrestricted:
        # Fetch all active regions, zones, outlets and categories
        reg_res = await db.execute(text("SELECT id, name FROM regions WHERE is_active ORDER BY name"))
        region_map = {r[0]: r[1] for r in reg_res.fetchall()}

        zone_res = await db.execute(text("SELECT id, name FROM outlet_zones WHERE is_active ORDER BY name"))
        zone_map = {r[0]: r[1] for r in zone_res.fetchall()}

        outlets_res = await db.execute(text("SELECT id, outlet_name FROM outlets WHERE is_active ORDER BY outlet_name"))
        outlet_map = {r[0]: r[1] for r in outlets_res.fetchall()}
        
        cat_res = await db.execute(text("SELECT id, name FROM item_categories WHERE is_active ORDER BY name"))
        cat_map = {r[0]: r[1] for r in cat_res.fetchall()}

        return UserScope(
            user_id=current_user.id,
            username=current_user.username,
            role=current_user.role,
            role_id=current_user.role_id,
            is_unrestricted=True,
            region_ids=list(region_map.keys()),
            region_names=region_map,
            zone_ids=list(zone_map.keys()),
            zone_names=zone_map,
            outlet_ids=list(outlet_map.keys()),
            outlet_names=outlet_map,
            category_ids=list(cat_map.keys()),
            category_names=cat_map,
            default_template_id=getattr(current_user, "default_dashboard_template_id", None)
        )

    # 1. Fetch Region Assignments
    reg_sql = """
        SELECT r.id, r.name
        FROM user_region_assignments ura
        JOIN regions r ON r.id = ura.region_id
        WHERE ura.user_id = :uid AND r.is_active
        ORDER BY r.name
    """
    reg_rows = (await db.execute(text(reg_sql), {"uid": current_user.id})).fetchall()
    region_map = {r[0]: r[1] for r in reg_rows}

    # 2. Fetch Zone Assignments (explicit + zones belonging to assigned regions)
    zone_sql = """
        SELECT z.id, z.name
        FROM user_zone_assignments uza
        JOIN outlet_zones z ON z.id = uza.zone_id
        WHERE uza.user_id = :uid AND z.is_active
    """
    zone_rows = (await db.execute(text(zone_sql), {"uid": current_user.id})).fetchall()
    zone_map = {r[0]: r[1] for r in zone_rows}

    if region_map:
        reg_zones = await db.execute(
            text("SELECT id, name FROM outlet_zones WHERE region_id = ANY(:rids) AND is_active"),
            {"rids": list(region_map.keys())}
        )
        for r in reg_zones.fetchall():
            zone_map[r[0]] = r[1]

    # 3. Fetch Store Assignments (direct + stores in assigned regions/zones + single outlet_id)
    outlet_map: Dict[int, str] = {}
    store_sql = """
        SELECT o.id, o.outlet_name
        FROM user_store_assignments usa
        JOIN outlets o ON o.id = usa.outlet_id
        WHERE usa.user_id = :uid AND o.is_active
        ORDER BY o.outlet_name
    """
    store_rows = (await db.execute(text(store_sql), {"uid": current_user.id})).fetchall()
    for r in store_rows:
        outlet_map[r[0]] = r[1]

    if region_map:
        reg_stores = await db.execute(
            text("SELECT id, outlet_name FROM outlets WHERE region_id = ANY(:rids) AND is_active"),
            {"rids": list(region_map.keys())}
        )
        for r in reg_stores.fetchall():
            outlet_map[r[0]] = r[1]

    if zone_map:
        zone_stores = await db.execute(
            text("SELECT id, outlet_name FROM outlets WHERE zone_id = ANY(:zids) AND is_active"),
            {"zids": list(zone_map.keys())}
        )
        for r in zone_stores.fetchall():
            outlet_map[r[0]] = r[1]

    # Fallback to single outlet_id on user record if no explicit assignments
    if not outlet_map and current_user.outlet_id:
        single_res = await db.execute(
            text("SELECT id, outlet_name FROM outlets WHERE id = :oid AND is_active"),
            {"oid": current_user.outlet_id}
        )
        s_row = single_res.first()
        if s_row:
            outlet_map[s_row[0]] = s_row[1]

    # 4. Fetch category assignments
    cat_sql = """
        SELECT c.id, c.name
        FROM user_category_assignments uca
        JOIN item_categories c ON c.id = uca.category_id
        WHERE uca.user_id = :uid AND c.is_active
        ORDER BY c.name
    """
    cat_rows = (await db.execute(text(cat_sql), {"uid": current_user.id})).fetchall()
    cat_map = {r[0]: r[1] for r in cat_rows}

    # Fetch child subcategory ids if any categories assigned
    subcat_ids: List[int] = []
    if cat_map:
        subcat_res = await db.execute(
            text("SELECT id FROM item_subcategories WHERE category_id = ANY(:cids) AND is_active"),
            {"cids": list(cat_map.keys())}
        )
        subcat_ids = [r[0] for r in subcat_res.fetchall()]

    return UserScope(
        user_id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        role_id=current_user.role_id,
        is_unrestricted=False,
        region_ids=list(region_map.keys()),
        region_names=region_map,
        zone_ids=list(zone_map.keys()),
        zone_names=zone_map,
        outlet_ids=list(outlet_map.keys()),
        outlet_names=outlet_map,
        category_ids=list(cat_map.keys()),
        category_names=cat_map,
        subcategory_ids=subcat_ids,
        default_template_id=getattr(current_user, "default_dashboard_template_id", None)
    )
