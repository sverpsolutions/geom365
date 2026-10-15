# Changelog

Versions follow `MAJOR.MINOR.PATCH`. New work lands on the `testing` branch as `-beta.N` tags; once verified it is merged to `main` and tagged without the suffix.

## Unreleased — 2026-10-15 (main) — VPS deployment, PO status fix

### Added
- **Docker deployment** for the Hostinger VPS (`deploy/`, `backend/Dockerfile`): private PostgreSQL 16, FastAPI backend (runs `alembic upgrade head` on start), Caddy web container routed by the server's Traefik with Let's Encrypt. Security headers (HSTS, nosniff, frame, referrer, permissions), login rate limit 10/min per IP, nightly `pg_dump` (14 days). Live at https://geom365.sverpsolutions.com. Runbook: `deploy/README.md`.

### Fixed
- **PO creation failed** with `po_headers_status_check`: the PO screen saves `pending_approval`, which the database did not allow. Migration `a1b3c5d7e9f1` allows `pending_approval` and `completed`.

## v1.5.0-beta.2 — 2026-10-03 (testing) — cash management, accounts payable, users & locations, company profile

Run `alembic upgrade head` (4 migrations: `c6e8a0b2d4f5`, `d7f9b1c3e5a6`, `e8a0c2d4f6b7`, `f9b1d3e5a7c8`).

### Added
- **Cash Management** (`/accounts/cash`, ported + tightened from NCG cash management): one cash book where every rupee sits in a drawer, branch safe, a person, in transit or the bank. Opening float comes out of the safe and counted shift cash goes back into it; drawer pickup; expenses (category approval limits, a different manager approves, bill no + photo where required); pay-ins; handovers stay in transit until the **receiver** accepts; bank deposits need slip no + slip photo and stay unverified until accounts matches the bank statement (not the depositor). No overdraw, row locks per custody, no edits; void only by admin on the same open day. Day Close requires a physical safe count; variance posted and flagged. HO Cash Control: cash by branch, people, banks, days since last deposit.
- **Accounts** (`/accounts/dashboard`, `/accounts/bills`, `/accounts/payments`, replacing mock pages): Bill Entry (SPS) matches the supplier bill to its GRN (±₹1, else disputed until accepted with a reason; verifier ≠ GRN maker; duplicate supplier bill blocked). Supplier payments from the bank (UTR/cheque unique), split across verified bills + cash discount, advance and later adjustment, **maker-checker** approval, pending payments reserve the bill, void reverses. Supplier aging, ledger, bank book, customer receivables, live dashboard.
- **Users & Locations** (`/settings/users`): create users, role, branch, reset password, activate/deactivate. A user with an open shift or cash in hand cannot be moved or deactivated; no self-demotion; superadmin only by superadmin.
- **Company Profile** (`/settings/company`, fields from bombayfishries settings / sps_company / hr_company_settings): legal name, company type, GSTIN (check digit → state & code), PAN (must match GSTIN), CIN/LLPIN, TAN, FSSAI, Udyam, IEC, registered + head office address, bank details, UPI, signatory, invoice terms/footer, FY start, logo upload. Compliance documents checklist with numbers, expiry tracking and version history. Receipt prints legal name, FSSAI, terms and footer.

### Changed
- CD discount applies on the selling price: taken off each line before GST, so taxable value and GST drop with it (was % of taxable with GST unchanged).
- Shift report header: logo, brand, store address/phone/GSTIN (HO fallback).
- `staff` is the billing role that must work inside an open shift (no `cashier` role exists).
- Company settings can only be changed by admin; every change is audit-logged.
- Walk-in dues (unreconciled synced bills) are excluded from receivables and flagged on the dashboard.

### Fixed
- `users.outlet_id` pointed at the empty legacy `outlet_master`, so no user could be tied to a branch; now references `outlets`.
- User API accepted roles the database rejects and unknown locations (500 errors); could not move a user back to Head Office.

## v1.5.0-beta.1 — 2026-10-02 (testing) — customer master, day & shift control

### Added
- **Customer Master** (`/masters/customers`, was "coming soon"): auto customer code, type (retail / wholesale / hotel / institution), contact person, alt phone, GST registration type, GSTIN (format + state code + checksum, live check), PAN and state taken from GSTIN, billing + shipping address, credit limit / days, default discount %, opening balance, notes. KPI cards, search, type / B2B-B2C / active filters, over-limit flag, ledger, deactivate / reactivate, CSV export. One active customer per GSTIN. Migration `a9c3e5f7b1d2`.
- **Day & Shift** (`/billing/day-shift`, ported from NCG Shifts): per location (HO = 0) Day Open → Shift Open (float) → billing → Shift Close (denomination count, system vs actual for every payment mode, shortage / excess, remark required on variance, 80mm report) → Day Close (blocked while shifts are open, totals frozen; emergency force-close; same-day reopen). Day and shift registers. Migration `b4d6f8a0c2e3` adds `business_days`, `cashier_shifts`, `shift_id` on invoices and payments.
- POS header shows business day / shift; bill date locked to the open business day.

### Changed
- HO billing actions (invoice, collection, estimate → invoice, sales return, cancel) need the location's business day open and must be dated on it; role `cashier` also needs an open shift. Synced outlet bills are not affected.

### Fixed
- New Invoice / New Estimate customer dropdown was always empty (`per_page: 500` over the API limit, read `.items` instead of `.data`).

### Removed
- Unused `pages/customers/CustomerList|CustomerForm|CustomerLedger.tsx`.

## v1.4.2 — 2026-10-01 (main)

### Security
- `npm audit fix` (no major upgrades): 18 → 6 vulnerable frontend packages; all high-severity issues fixed except vite's dev-server one (axios 1.20.0, postcss 8.5.28, form-data, nanoid, brace-expansion, tmp, browserslist, react-router-dom 6.30.6).
- Remaining 6 need major upgrades and do not affect the built site: vite/esbuild (dev server only), react-router v7, uuid inside exceljs.

## v1.4.1 — 2026-10-01 (main)

### Fixed
- Hosting build failed: `npm run build` ran `tsc -b` first and stopped on 212 existing type errors. `build` is now `vite build`; the type check is `npm run typecheck`.

## v1.4.0 — 2026-10-01 (main)

Stable release of v1.4.0-beta.1.

## v1.4.0-beta.1 — 2026-10-01 (testing) — live dashboard, store health, receive, dark mode, owner app

### Added
- **Live Dashboard** (`/dashboard/summary`): today/yesterday/month sales, bills, avg bill, returns, receivables; 7/30-day chart; top items; store performance; recent bills; pending transfers; **best sellers out of stock** (sold in 30 days, stock ≤ 0 at that outlet). Refreshes every minute. Synced outlet lines carry the outlet item code in `product_id`, so items are matched on `item_code`.
- **Store Health** (`/stores/health`): per outlet online / sync late / unreachable / no POS link, last sync, last bill, today's sales; live parallel ping of every outlet's VPN host (~2 s), rechecks every 2 min.
- **Receive transfer** on Stock Transfer IN: scan to jump to a line, received qty per line, difference highlighted, remark required on a difference; status `received` / `received_short`. Migration `f2a5b8c1d3e4` adds `received_qty`, `received_at`, `received_by`.
- Stock moves with transfers: dispatch from a location without a POS (HO) lowers `products.stock_qty`; receiving into it raises it; `transfer_out` / `transfer_in` rows in `stock_ledger` for every location.
- **Dark mode**: header toggle (and Settings → Theme) on `html.dark-mode`; dark token set; Tailwind `dark:` variants follow the toggle instead of the OS; common light utilities on older pages mapped to dark tokens.
- **Owner phone view** (`/owner`), installable (web manifest + icons): today's sales, month, receivables, stores online, per-store bars, stock-outs, pending transfers.

### Changed
- 15 mock-up screens (Customers, Schemes, Bulk Discount, Accounts ×3, HR ×5, Processing ×4) show a "coming soon" page; Stock Status opens the Stock Report.
- Item photos are resized in the browser to fit 800 × 800 and saved as WebP.
- Shared Modal uses theme tokens.

### Fixed
- Stock sync scheduler: first run 5 min after start (was immediately on every reload) and skips outlets that do not answer ping, so an unreachable outlet can no longer hang the backend.

## v1.3.0 — 2026-10-01 (main)

Stable release of everything from v1.1.0-beta.1 to v1.3.0-beta.2.

## v1.3.0-beta.2 — 2026-10-01 (testing) — redesign, stock transfers, logistics fixes

### Changed
- **New look**: deep-teal brand, IBM Plex Sans/Mono, dark navy sidebar, taller header, rounded tabs, light table headers, 40px controls. Tailwind `blue-*`/`indigo-*` now map to the brand scale so every page follows; yellow admin theme removed.
- **Inventory → Stock Transfer OUT / IN** are real registers (were mock-up pages): location (default HO), date, status and number filters; summary of transfers, qty, cost value, MRP value; expand a row for item lines with subtotal; print per transfer. **New Transfer Out** opens the create screen.
- **New Transfer Out** (multi-branch): real Source Location picker (was hard-coded location 1); lines get cost/MRP/value from the item master (were 0); A4 **Stock Transfer Out** note prints after confirm, per card, Print All, or by number (Reprint).
- **Logistics → New Transfer**: item search shows stock at source, MRP and SP; ↑/↓/Enter; scanner Enter adds the item and jumps to its Qty, Enter in Qty returns to scan.
- Product search accepts `outlet_id` and returns `stock_qty` there.
- Item photo boxes show the recommended size (800 × 800 px, square, ≤ 200 KB).
- POS: split payment (several payment rows per invoice), outlet tagged on the bill.

### Fixed
- Shipment list 500, create transfer 500 (after save), list/detail 500 once a transfer existed: async lazy-loads on logistic transfer relationships.
- Next Step on step 1 created a duplicate transfer every time; reopened drafts start at step 2.
- Create box / dispatch details rejected empty L/W/H and ETA.
- Multi-branch Save Draft crashed (lazy-load); Confirm response dropped the transfer numbers and blanked the page.
- Migration `e1f4a7b2c9d0`: columns the models write but the DB lacked (`logistic_transfers.source_transfer_id`, stock transfer type/remarks/unit/cost/mrp/value, PO vendor invoice fields, item packaging UOM/shelf-life/storage fields).

## v1.3.0-beta.1 — 2026-10-01 (testing) — POS billing (NCG v2 style)

### Changed
- **Billing → New Invoice** is a new POS screen modelled on NCG `billing/create_v2.php` (POS beta): navy top bar (invoice/cashier/clock), customer phone/name search, Retail/Wholesale, date, **Search & Scan** (barcode/item code exact match adds instantly; word search dropdown with ↑/↓/Enter; same item again = qty + 1), dense items grid (Qty, MRP struck through, Disc%, Rate, EAN, GST%, Total), fixed totals footer (Items, Qty, MRP Total, You Save, Grand Total, **Pay & Save F4**), shortcut bar F1 Search · F2 Qty · F3 Price Check · F4 Pay · F5 Hold · F6 Recall · F7 Reprint · F8 Price · F11 Fullscreen, and a two-column Pay & Save dialog ([Cash] [Card] [UPI] [Credit], CD %, round off, cash received → change).
- Prices are GST-inclusive shelf prices (`selling_price` = MRP); sent to the API as GST-exclusive rates; new `round_off` flag on invoice create keeps the bill total equal to the shelf total.
- After save: 80 mm thermal receipt, port of NCG `billing/print.php` (thermal-3in): MRP / S.D per line, You Saved, cash tendered / change, GST summary, PAID stamp.

### Removed
- Old `Billing.tsx` "New Invoice" page — it used hard-coded mock products/customers and never saved.

### Notes
- Held bills (F5) are kept per counter in the browser.
- Split payment is not offered: the invoice API records one payment mode per bill.

## v1.2.0-beta.2 — 2026-10-01 (testing) — Purchase Return Phase 2

### Added
- **Purchase Return / Debit Note** (Purchases → Purchase Return), two modes:
  - *Against GRN*: qty limited to received − already returned (row-locked, HTTP 409); rate = GRN taxable per unit incl. line + header discount; GRN payable reduced by the debit note.
  - *Direct (no GRN)*, NCG's default flow: supplier + items (word search), rate defaults to item-master purchase/cost price.
  - NCG rules: GST-exclusive rate, GST on top; CGST+SGST vs IGST from company state vs supplier state; stock leaves HO with `stock_ledger` `purchase_return`; number `DN-HO-YYYY-NNNN`; cancel reverses stock and GRN payable; admin/manager only.
  - HO stock is not enforced (all products show 0 HO stock today) — the screen warns when a return takes it negative.
- **Debit Notes** list (Purchases → Debit Notes): HO debit notes + outlet PRNs, filters, print, cancel.
- **Debit note print**: port of NCG `purchase_returns/print.php` — landscape "PURCHASE RETURN NOTE", supplier/return boxes, MRP/SP columns, GST summary, ITC-reversal note (GSTR-3B 4(B)(2)), amount in words, supplier acknowledgement + signatory.
- GRN now writes `stock_ledger` `purchase` rows.

### Fixed
- **GRN Inward could never save**: ORM wrote `total_qty` / item `basic_amount…` columns missing in the DB (0 GRNs ever recorded). Migration `d5e8f2a3c6b7` adds them.
- `unit_wise_purchase_returns` tables had an old shape matching neither outlet PRN sync nor debit notes (empty) — rebuilt to one schema; HO numbers unique, outlet PRN numbers may repeat across outlets.
- Pages under paths with no `App.tsx` route (Purchase Return, Physical Audit, Barcode Printing) rendered blank: added a catch-all inside the app shell so `routes/config.tsx` decides.

### Known
- GRN computes GST before the header discount, so GRN GST is slightly overstated when a header discount is used (debit notes use the discounted value).

## v1.2.0-beta.1 — 2026-10-01 (testing) — Sales Return Phase 1

### Added
- **Sales Return / Credit Note** (Billing → Sales Return): find any bill (outlet POS or HO), enter return qty per item, reason, refund method (cash / adjust against bill due). Rules follow NCG `SalesReturns`: stock back to HO + `stock_ledger` `sale_return`, credit note `CN-HO-YYYY-NNNN`, GST-inclusive rate with taxable/GST extracted backwards.
- Hardening beyond NCG: server computes all amounts (client sends only product + qty); returnable qty = sold − already returned, row-locked (HTTP 409 on over-return); refunds never exceed what was paid; cancel reverses stock via ledger and restores bill due; admin/manager only for create/cancel.
- **Credit Notes** list (Billing → Credit Notes): HO credit notes + 123 synced outlet POS returns, date/source/search filters, print, cancel (HO only).
- **Credit note print**: port of NCG `sales_returns/print.php` — A4 "Refund Bill", against-bill bar, reason, parties, HSN-wise GST summary, amount in words (Lakh/Crore), signatory stamp.
- Company Profile: **GSTIN** and **State** fields (printed on credit notes).
- Migration `c3d9e1a2b4f5`: `unit_wise_invoices.ref_invoice_no / return_reason / refund_method / adjusted_amount`; `company_settings.gstin / company_state`.

### Fixed
- Creating invoices, payments, invoice cancel, delete requests and estimate create/convert/close crashed: routers read `current_user.id`, which did not exist (`core/dependencies.py`).

### Notes
- Outlet POS lines store the outlet item code in `product_id`; HO stock is resolved by `item_code` (99% match). Unmatched lines get a credit note but no stock movement (flagged on screen).
- Outlet POS returns (`RTN_*`) carry no original bill number, so a bill returned at the outlet cannot be detected — the screen warns the user.

## v1.1.0-beta.4 — 2026-10-01 (testing)

### Tooling
- Added SuperCharge v4 project skill (`.claude/skills/supercharge/`); runs only on `supercharge ...` / `/supercharge ...`.

## v1.1.0-beta.3 — 2026-10-01 (testing)

### Fixed
- 15 sidebar links did nothing because pages open as tabs and the tab table (`routes/config.tsx`) lacked them: GRN — Inward, Bill Entry, Schemes, Bulk Discount, Processing, Receive Lot, BOM Recipes, Production Batches, HR Dashboard, Leave Requests, Salary Slips, and all 5 Online Shop pages.
- 5 sidebar links point to modules that were never built (Sales Return, Credit Notes, Purchase Return, Physical Audit, Barcode Printing); they now show a "not built yet" page instead of nothing.

## v1.1.0-beta.2 — 2026-10-01 (testing)

### Changed
- All searches are word-based: every word must match, in any order ("maggi noodles" finds "MAGGI ATTA NOODLES"). One helper each side — `backend/app/utils/search.py` (`word_match`, `word_match_sql`) and `frontend/src/utils/search.ts` (`matchesSearch`) — used by products, shop, customers, suppliers, users, states, HSN, stock & channel reports, billing product picker, all masters pages, vendor pages, logistics list, command palette, help.

### Fixed
- HSN master search was ignored unless a code type was also selected.

## v1.1.0-beta.1 — 2026-10-01 (testing)

### Security
- Login required on `/reports`, `/sync`, `/wms`, `/outlets`, `/shop/admin/*`, `/shop/reports/*`, `/shop/customers*`, `/stock-reports/email`; DB backup is admin-only.

### Fixed
- 28 pages called `axios` directly with no token and a hard-coded `http://localhost:8000`; all now use the shared client (`api/axios.ts`) with token refresh.
- WMS pages called `/api/wms/*` (404); now `/api/v1/wms/*`.
- `/shop/banners` 500: added migration `b7e2c4d1f0a3` creating `shop_banners`.
- Outlet Excel import sends `multipart/form-data`.

### Removed
- Duplicate API client `frontend/src/services/api.ts`; unused `createOrGetCustomer` / `searchCustomers` wrappers.

### Docs
- `ARCHITECTURE.md` generated from the graphify code graph.

## v1.0.0 — 2026-10-01

- Initial import: FastAPI backend, React frontend, fmcg_reports; secrets moved to `.env` / `db_config.json`.
