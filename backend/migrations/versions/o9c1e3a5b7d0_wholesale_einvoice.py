"""Wholesale billing + GST e-invoice / e-way bill (GSTZen, same API as Gupta Bros).

Additive. A wholesale bill stays a row in unit_wise_invoices (invoice_type='wholesale'); franchise outlets and suppliers
are billed through a linked customers row so receivables, receipts and ledgers keep one source.

Revision ID: o9c1e3a5b7d0
Revises: n8b0d2f4a6c9
Create Date: 2026-11-09 10:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'o9c1e3a5b7d0'
down_revision: Union[str, None] = 'n8b0d2f4a6c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INV = [
    "einvoice_status VARCHAR(12)", "einvoice_sandbox BOOLEAN NOT NULL DEFAULT FALSE", "einvoice_irn VARCHAR(64)", "einvoice_ack_no VARCHAR(30)",
    "einvoice_ack_date TIMESTAMP", "einvoice_qr_data TEXT",
    "ewb_status VARCHAR(12)", "ewb_no VARCHAR(20)", "ewb_date TIMESTAMP", "ewb_valid_until TIMESTAMP",
    "transport_mode SMALLINT", "vehicle_no VARCHAR(20)", "vehicle_type VARCHAR(1)", "transporter_id VARCHAR(15)", "transporter_name VARCHAR(100)",
    "transport_doc_no VARCHAR(30)", "transport_doc_date DATE", "transport_distance INTEGER",
    "ship_to_different BOOLEAN NOT NULL DEFAULT FALSE", "ship_name VARCHAR(100)", "ship_gstin VARCHAR(15)", "ship_address VARCHAR(200)",
    "ship_place VARCHAR(100)", "ship_pincode VARCHAR(6)", "ship_state_code VARCHAR(2)",
]

STATEMENTS = [
    *[f"ALTER TABLE unit_wise_invoices ADD COLUMN IF NOT EXISTS {c}" for c in _INV],
    "CREATE INDEX IF NOT EXISTS ix_invoices_wholesale ON unit_wise_invoices (invoice_date DESC) WHERE invoice_type = 'wholesale'",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_outlet_id INTEGER REFERENCES outlets(id) ON DELETE SET NULL",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS linked_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_linked_outlet ON customers (linked_outlet_id) WHERE linked_outlet_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_linked_supplier ON customers (linked_supplier_id) WHERE linked_supplier_id IS NOT NULL",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS allow_wholesale_bill BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstzen_token TEXT",
    "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstzen_sandbox BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gstzen_sandbox_gstin VARCHAR(15)",
    "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS wholesale_invoice_prefix VARCHAR(8) NOT NULL DEFAULT 'WS'",
    """CREATE TABLE IF NOT EXISTS einvoice_api_logs (
        id BIGSERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES unit_wise_invoices(id) ON DELETE SET NULL,
        action VARCHAR(20) NOT NULL,
        sandbox BOOLEAN NOT NULL,
        http_code INTEGER,
        ok BOOLEAN NOT NULL DEFAULT FALSE,
        message TEXT,
        request JSONB,
        response JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_einvoice_logs_invoice ON einvoice_api_logs (invoice_id, id DESC)",
]


ACTS = ("view", "create", "edit", "cancel", "print")
ROLE_GRANTS = {"manager": [f"wholesale.{a}" for a in ACTS], "accounts_manager": ["wholesale.view"]}


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for a in ACTS:
        conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES ('wholesale', :n, :s) ON CONFLICT (slug) DO NOTHING"),
                     {"n": f"Wholesale Billing & E-Invoice — {a}", "s": f"wholesale.{a}"})
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    pass
