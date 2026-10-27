import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { ItemPicker, Stat, Table, Tabs, btnPri, btnSec, err, fmt, inp, useList } from './mfgShared';

const COLOR: Record<string, string> = { GREEN: 'bg-emerald-600', AMBER: 'bg-amber-500', RED: 'bg-rose-600' };
const ST: Record<string, string> = { Available: 'text-emerald-700', 'Awaiting Warehouse Transfer': 'text-sky-700', 'Awaiting Quality Approval': 'text-violet-700',
  'Awaiting Purchase': 'text-amber-700', 'Partially Available': 'text-orange-700', Short: 'text-rose-700 font-bold' };
const TYPE: Record<string, string> = { RM: 'Raw', PM: 'Packing', FG: 'Finished', SFG: 'Semi', CONS: 'Consumable', OTH: 'Other' };

const Overall = ({ o }: { o: any }) => o ? <span className={`px-3 py-1 rounded-full text-white text-xs font-bold ${COLOR[o.color]}`}>{o.color} · {o.label}</span> : null;

function Lines({ lines, onTransfer, onBuy }: { lines: any[]; onTransfer?: (l: any[]) => void; onBuy?: (l: any[]) => void }) {
  const tr = lines.filter((l) => l.transfer_suggested > 0);
  const buy = lines.filter((l) => l.purchase_suggested > 0);
  return (
    <div className="space-y-2">
      <Table rows={lines} cols={[
        ['Component', (l) => <>{l.item}<div className="text-[11px] text-slate-500">{l.item_code} · {TYPE[l.item_type] || l.item_type}</div></>],
        ['Required', (l) => <>{fmt(l.net_required)} {l.unit}{l.round_up && Number(l.theoretical) !== Number(l.required) && <div className="text-[11px] text-slate-500">theoretical {fmt(l.theoretical)}</div>}</>, 'text-right'],
        ['Plant stock', (l) => fmt(l.plant), 'text-right'], ['Reserved (others)', (l) => fmt(l.reserved_other), 'text-right'],
        ['Available', (l) => fmt(l.available), 'text-right'], ['Shortage', (l) => l.shortage > 0 ? <b className="text-rose-700">{fmt(l.shortage)}</b> : '—', 'text-right'],
        ['Warehouse', (l) => fmt(l.warehouse), 'text-right'], ['QC hold', (l) => fmt(l.qc_hold), 'text-right'],
        ['PO pending', (l) => l.pending_po > 0 ? <>{fmt(l.pending_po)}<div className="text-[11px] text-slate-500">{l.po_eta || ''}</div></> : '—', 'text-right'],
        ['Transfer', (l) => l.transfer_suggested > 0 ? fmt(l.transfer_suggested) : '—', 'text-right'],
        ['Buy', (l) => l.purchase_suggested > 0 ? fmt(l.purchase_suggested) : '—', 'text-right'],
        ['Status', (l) => <span className={`text-xs ${ST[l.status]}`}>{l.status}</span>],
      ]} />
      <div className="flex gap-2">
        {onTransfer && tr.length > 0 && <button className={btnSec} onClick={() => onTransfer(tr)}><i className="fas fa-truck mr-1" />Request warehouse transfer ({tr.length})</button>}
        {onBuy && buy.length > 0 && <button className={btnSec} onClick={() => onBuy(buy)}><i className="fas fa-cart-plus mr-1" />Create draft PO ({buy.length})</button>}
      </div>
    </div>
  );
}

async function requestTransfer(lines: any[], orderId?: number) {
  if (!confirm(`Raise a warehouse transfer request for ${lines.length} item(s)? Stock moves only after another person approves it.`)) return;
  try { const r = await api.post('/manufacturing/planning/transfer-request', { lines: lines.map((l) => ({ product_id: l.product_id, qty: l.transfer_suggested })), for_order_id: orderId });
    toast.success(`Transfer request ${r.data.transfers.join(', ')} sent for approval (Department Stores → Transfers)`); } catch (e) { err(e); }
}
async function draftPO(lines: any[]) {
  if (!confirm(`Create draft purchase order(s) for ${lines.length} item(s)? Nothing is sent to suppliers.`)) return;
  try { const r = await api.post('/manufacturing/planning/purchase', { lines: lines.map((l) => ({ product_id: l.product_id, qty: l.purchase_suggested })) });
    toast.success(`Draft PO ${r.data.purchase_orders.join(', ')} created — review it in Purchase Orders`); } catch (e) { err(e); }
}

export default function MfgPlanning() {
  const [tab, setTab] = useState('Check an order');
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-clipboard-check text-indigo-600 mr-2" />Material Planning</h1>
      <p className="text-xs text-slate-500 mb-4">BOM requirement vs usable plant stock (reserved, QC-hold, WIP and scrap never count). Warehouse stock and pending POs are shown separately — they are not in the plant yet.</p>
      <Tabs tabs={['Check an order', 'Open orders', 'All materials']} value={tab} onChange={setTab} />
      {tab === 'Check an order' && <Check />}
      {tab !== 'Check an order' && <Open consolidated={tab === 'All materials'} />}
    </div>
  );
}

function Check() {
  const [orders] = useList<any>('/manufacturing/sales-orders', { status: 'OPEN' });
  const [f, setF] = useState<any>({ qty: '' });
  const [r, setR] = useState<any>(null);
  const run = () => api.post('/manufacturing/planning/check', { product_id: f.product_id, sales_order_id: f.sales_order_id || null, qty: f.qty ? Number(f.qty) : null })
    .then((x) => setR(x.data)).catch(err);
  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-3 grid md:grid-cols-4 gap-3 items-end">
        <label className="text-xs font-semibold text-slate-600">Customer order (optional)<select className={inp} value={f.sales_order_id || ''} onChange={(e) => setF({ ...f, sales_order_id: Number(e.target.value) || null })}>
          <option value="">—</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.so_no} · {o.customer || o.brand} · {o.product} · {fmt(o.ordered_qty)}</option>)}</select></label>
        {!f.sales_order_id && <div className="text-xs font-semibold text-slate-600">Finished product<ItemPicker value={f.product_id} label={f.product_name} onPick={(p) => setF({ ...f, product_id: p?.id, product_name: p?.name })} /></div>}
        <label className="text-xs font-semibold text-slate-600">Quantity (finished units)<input type="number" className={inp} value={f.qty} placeholder={f.sales_order_id ? 'order qty' : ''} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        <button className={btnPri} onClick={run}>Check availability</button>
      </div>
      {r && <>
        <div className="flex items-center gap-3"><Overall o={r.overall} /><span className="text-xs text-slate-500">BOM {r.bom.bom_no} r{r.bom.revision} · {fmt(r.qty)} units</span></div>
        <Lines lines={r.lines} onTransfer={(l) => requestTransfer(l)} onBuy={draftPO} />
      </>}
    </div>
  );
}

function Open({ consolidated }: { consolidated: boolean }) {
  const [by, setBy] = useState('priority');
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { setD(null); api.get('/manufacturing/planning/open', { params: { order_by: by } }).then((r) => setD(r.data)).catch(err); };
  useEffect(load, [by]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="text-slate-500 p-4"><i className="fas fa-spinner fa-spin mr-2" />Checking every open order…</div>;
  const allocate = () => confirm(`Reserve materials for open production orders by ${by === 'date' ? 'production date' : 'priority'}?`) &&
    api.post('/manufacturing/planning/allocate', { order_by: by }).then((r) => { toast.success(`${r.data.length} order(s) allocated`); load(); }).catch(err);
  const c = d.orders;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Open orders" value={c.length} /><Stat label="Ready (GREEN)" value={c.filter((o: any) => o.overall.color === 'GREEN').length} tone="green" />
        <Stat label="Needs transfer / purchase (AMBER)" value={c.filter((o: any) => o.overall.color === 'AMBER').length} tone="amber" />
        <Stat label="Blocked by shortage (RED)" value={c.filter((o: any) => o.overall.color === 'RED').length} tone="red" />
      </div>
      <div className="flex gap-2 items-center">
        <select className={`${inp} w-56`} value={by} onChange={(e) => setBy(e.target.value)}><option value="priority">Allocate by priority</option><option value="date">Allocate by production date</option></select>
        <button className={btnSec} onClick={allocate}>Reserve materials</button>
        <button className={btnSec} onClick={load}><i className="fas fa-sync" /></button>
      </div>
      {consolidated ? <Table rows={d.consolidated} cols={[
        ['Material', (t) => <>{t.item}<div className="text-[11px] text-slate-500">{t.item_code} · {TYPE[t.item_type] || t.item_type}</div></>],
        ['Orders', (t) => t.orders, 'text-right'], ['Total required', (t) => `${fmt(t.required)} ${t.unit}`, 'text-right'], ['Plant stock', (t) => fmt(t.plant), 'text-right'],
        ['Order shortages', (t) => fmt(t.shortage), 'text-right'], ['Company shortage', (t) => fmt(t.company_shortage), 'text-right'],
        ['Warehouse', (t) => fmt(t.warehouse), 'text-right'], ['After warehouse', (t) => fmt(t.after_warehouse), 'text-right'],
        ['QC hold', (t) => fmt(t.qc_hold), 'text-right'], ['PO pending', (t) => fmt(t.pending_po), 'text-right'],
        ['Still to buy', (t) => t.to_buy > 0 ? <b className="text-rose-700">{fmt(t.to_buy)}</b> : '—', 'text-right'],
      ]} /> : c.map((o: any) => (
        <div key={`${o.kind}${o.id}`} className="bg-white border rounded-lg">
          <button className="w-full flex flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpen(open === `${o.kind}${o.id}` ? null : `${o.kind}${o.id}`)}>
            <Overall o={o.overall} />
            <b>{o.order_no}</b><span className="text-sm">{o.customer || 'Own stock'} · {o.product} · {fmt(o.qty)}</span>
            <span className="text-xs text-slate-500">due {o.need_by || '—'} · priority {o.priority} · {o.bom || ''}{o.kind === 'SO' && ' · not yet planned'}{o.released_at && ' · released'}</span>
          </button>
          {open === `${o.kind}${o.id}` && <div className="p-3 border-t">{o.error && <div className="text-rose-700 text-sm mb-2">{o.error}</div>}
            <Lines lines={o.lines} onTransfer={(l) => requestTransfer(l, o.kind === 'MO' ? o.id : undefined)} onBuy={draftPO} /></div>}
        </div>
      ))}
    </div>
  );
}
