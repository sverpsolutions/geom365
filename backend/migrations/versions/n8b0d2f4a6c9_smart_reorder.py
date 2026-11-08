"""Smart reorder (from NCG): per-item visit / safety / lead days, planning audit, supplier visit schedules, reorder planning sessions.

Additive. Reuses products.min_stock / reorder_level / max_stock_level / fixed_margin_percent / supplier_id.

Revision ID: n8b0d2f4a6c9
Revises: m7a9c1e3f5b8
Create Date: 2026-11-08 20:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'n8b0d2f4a6c9'
down_revision: Union[str, None] = 'm7a9c1e3f5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_visit_days INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS safety_stock_days INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER",
    """CREATE TABLE IF NOT EXISTS product_planning_log (
        id BIGSERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        field_name VARCHAR(40) NOT NULL,
        old_value VARCHAR(100),
        new_value VARCHAR(100),
        source VARCHAR(12) NOT NULL DEFAULT 'inline',
        changed_by INTEGER REFERENCES users(id),
        changed_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_product_planning_log_product ON product_planning_log (product_id, id DESC)",
    """CREATE TABLE IF NOT EXISTS supplier_visit_schedules (
        supplier_id INTEGER PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
        schedule_type VARCHAR(15) NOT NULL DEFAULT 'interval' CHECK (schedule_type IN ('interval','daily','weekly','monthly_dates')),
        interval_days INTEGER CHECK (interval_days BETWEEN 1 AND 365),
        weekdays JSONB,
        month_dates JSONB,
        lead_time_days INTEGER CHECK (lead_time_days BETWEEN 0 AND 60),
        last_visit_date DATE,
        next_visit_date DATE,
        assigned_buyer INTEGER REFERENCES users(id),
        notes TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_supplier_visit_next ON supplier_visit_schedules (next_visit_date)",
    """CREATE TABLE IF NOT EXISTS supplier_visit_logs (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        buyer_id INTEGER REFERENCES users(id),
        visit_date DATE NOT NULL,
        notes TEXT,
        po_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_supplier_visit_logs_supplier ON supplier_visit_logs (supplier_id, visit_date DESC)",
    """CREATE TABLE IF NOT EXISTS supplier_visit_audit (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        field_name VARCHAR(30) NOT NULL,
        old_value VARCHAR(120),
        new_value VARCHAR(120),
        reason VARCHAR(200),
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_supplier_visit_audit_supplier ON supplier_visit_audit (supplier_id, id DESC)",
    """CREATE TABLE IF NOT EXISTS purchase_reorder_sessions (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        outlet_id INTEGER,
        sales_days INTEGER NOT NULL,
        items_count INTEGER NOT NULL DEFAULT 0,
        total_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        po_no VARCHAR(30),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_reorder_sessions_supplier ON purchase_reorder_sessions (supplier_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reorder_sessions_po ON purchase_reorder_sessions (po_no)",
    """CREATE TABLE IF NOT EXISTS purchase_reorder_session_items (
        id BIGSERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES purchase_reorder_sessions(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        stock NUMERIC(14,3),
        avg_daily NUMERIC(14,4),
        min_q NUMERIC(14,3),
        max_q NUMERIC(14,3),
        reorder_level NUMERIC(14,3),
        pending_qty NUMERIC(14,3),
        incoming_qty NUMERIC(14,3),
        suggested_qty NUMERIC(14,3),
        final_qty NUMERIC(14,3),
        cost NUMERIC(12,2))""",
    "CREATE INDEX IF NOT EXISTS ix_reorder_session_items_session ON purchase_reorder_session_items (session_id)",
]


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)


def downgrade() -> None:
    pass
