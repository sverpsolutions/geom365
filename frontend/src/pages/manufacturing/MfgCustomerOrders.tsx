import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { Badge, CartonQty, Stat, Table, btnPri, btnSec, ctnText, err, fmt, inp, key, printDoc, useList } from './mfgShared';

const L = ({ label, children }: { label: string; children: any }) => (
  <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>
);
const both = (units: any, upc: any) => <>{fmt(units)}<div className="text-[11px] text-slate-500">{ctnText(units, upc)}</div></>;

export default function MfgCustomerOrders() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, load] = useList<any>('/manufacturing/sales-orders', { status: status || undefined, search: q });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const live = rows.filter((r) => ['OPEN', 'PARTIAL'].includes(r.status));
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex-1"><i className="fas fa-file-signature text-indigo-600 mr-2" />Customer Orders & Dispatch</h1>
        <button className={btnPri} onClick={() => setCreating(true)}><i className="fas fa-plus mr-1" />New Customer Order</button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Reserve approved finished goods (stock does not move) → issue to Billing / Dispatch → dispatch with invoice / challan. Dispatch is the only posting that takes goods out, so nothing is deducted twice.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Stat label="Open orders" value={live.length} tone="blue" />
        <Stat label="Ready for billing" value={live.filter((r) => r.ready_for_billing_qty > 0).length} tone="amber" sub="goods handed to dispatch, not yet dispatched" />
        <Stat label="Pending production" value={live.filter((r) => r.pending_production_qty > 0).length} />
        <Stat label="Overdue" value={live.filter((r) => r.delivery_date && r.delivery_date < new Date().toISOString().slice(0, 10)).length} tone="red" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['OPEN', 'PARTIAL', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={`${inp} w-72`} placeholder="Order / customer PO / customer / brand / product" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} cols={[
        ['Order', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => setOpen(r.id)}>{r.so_no}</button>],
        ['Customer / brand', (r) => <>{r.customer || 'Own brand'}<div className="text-[11px] text-slate-500">{r.brand}</div></>],
        ['Product', (r) => <>{r.product}<div className="text-[11px] text-slate-500">{r.units_per_carton}/carton {r.spec_code && `· ${r.spec_code}`}</div></>],
        ['Ordered', (r) => both(r.ordered_qty, r.units_per_carton), 'text-right'], ['QC approved', (r) => both(r.qc_approved_qty, r.units_per_carton), 'text-right'],
        ['Reserved', (r) => fmt(r.reserved_qty), 'text-right'], ['Issued', (r) => both(r.issued_qty, r.units_per_carton), 'text-right'],
        ['Dispatched', (r) => both(r.dispatched_qty, r.units_per_carton), 'text-right'], ['Pending', (r) => <b>{both(r.pending_qty, r.units_per_carton)}</b>, 'text-right'],
        ['Due', (r) => r.delivery_date || '—'], ['Priority', (r) => r.priority], ['Status', (r) => <Badge s={r.status === 'OPEN' ? 'PENDING' : r.status === 'COMPLETED' ? 'APPROVED' : r.status} />],
      ]} />
      {creating && <NewOrder onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpen(id); }} />}
      {open && <OrderDetail id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function NewOrder({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [specs] = useList<any>('/manufacturing/master/specs', { status: 'APPROVED' });
  const [f, setF] = useState<any>({ qty: '', unit: 'CTN', priority: 'NORMAL' });
  const s = specs.find((x) => x.id === f.spec_id);
  const save = async () => {
    try {
      const r = await api.post('/manufacturing/sales-orders', { ...f, qty: Number(f.qty), unit: f.unit === 'CTN' ? 'CTN' : null, delivery_date: f.delivery_date || null });
      toast.success(`${r.data.so_no}: ${fmt(r.data.ordered_qty)} units`); onDone(r.data.id);
    } catch (e) { err(e); }
  };
  return (
    <Modal open onClose={onClose} title="New customer order" width="max-w-3xl">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2"><L label="Product & packaging (approved spec — fixes brand, design, cap and carton size)">
          <select className={inp} value={f.spec_id || ''} onChange={(e) => setF({ ...f, spec_id: Number(e.target.value) || null })}>
            <option value="">Choose…</option>{specs.map((x) => <option key={x.id} value={x.id}>{x.customer_name || 'Own brand'} · {x.brand_name} — {x.product_name} · {x.spec_code} r{x.revision} · {x.units_per_carton}/ctn</option>)}
          </select></L></div>
        {s && <div className="md:col-span-2 text-xs bg-indigo-50 border border-indigo-200 rounded p-2 flex gap-3 items-center">
          {s.photos?.[0] && <img src={s.photos[0]} className="h-14 w-14 object-cover rounded border" />}
          <div><b>{s.brand_name}</b> ({s.customer_name || 'own brand'}) · customer item {s.customer_item_code || '—'} · internal {s.item_code}<br />
            tin {s.tin_size || '—'} · cap {s.cap_type || ''} {s.cap_colour || ''} · printing {s.printing_colour || '—'} · tin artwork <b>{s.tin_artwork || '—'}</b> · <b>{s.units_per_carton} per carton</b></div>
        </div>}
        <L label="Ordered quantity"><CartonQty value={f.qty} unit={f.unit} upc={s?.units_per_carton || 1} onChange={(v, u) => setF({ ...f, qty: v, unit: u })} /></L>
        <L label="Customer PO number"><input className={inp} value={f.customer_po_no || ''} onChange={(e) => setF({ ...f, customer_po_no: e.target.value })} /></L>
        <L label="Required delivery date"><input type="date" className={inp} value={f.delivery_date || ''} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></L>
        <L label="Priority"><select className={inp} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select></L>
        <L label="Billing requirement"><input className={inp} value={f.billing_requirement || ''} onChange={(e) => setF({ ...f, billing_requirement: e.target.value })} /></L>
        <L label="Dispatch instructions"><input className={inp} value={f.dispatch_instructions || ''} onChange={(e) => setF({ ...f, dispatch_instructions: e.target.value })} /></L>
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btnSec} onClick={onClose}>Cancel</button><button className={btnPri} onClick={save}>Create order</button></div>
    </Modal>
  );
}

function OrderDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [o, setO] = useState<any>(null);
  const [form, setForm] = useState<'' | 'handover' | 'dispatch'>('');
  const [h, setH] = useState<any>({ qty: '', unit: 'CTN', received_by: '' });
  const [d, setD] = useState<any>({ qty: '', unit: 'CTN' });
  const [outlets, setOutlets] = useState<any[]>([]);
  const load = () => api.get(`/manufacturing/sales-orders/${id}`).then((r) => setO(r.data)).catch(err);
  useEffect(() => { load(); api.get('/outlets').then((r) => setOutlets(r.data?.data || r.data || [])).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const upc = o.units_per_carton;
  const post = async (path: string, body?: any, msg = 'Done') => {
    try { const r = await api.post(`/manufacturing/sales-orders/${id}/${path}`, body); toast.success(msg); load(); return r.data; } catch (e) { err(e); }
  };
  const live = ['OPEN', 'PARTIAL'].includes(o.status);
  const meta: [string, any][] = [['Customer', o.customer || 'Own brand'], ['Brand', o.brand], ['Customer PO', o.customer_po_no || '—'], ['Product', o.product],
    ['Customer item code', o.customer_item_code || '—'], ['Internal code', o.item_code], ['Packaging', `${o.spec_code || '—'} · artwork ${o.artwork_code ? `${o.artwork_code} r${o.artwork_rev}` : '—'} · cap ${o.cap_colour || '—'}`],
    ['Ordered', `${fmt(o.ordered_qty)} (${ctnText(o.ordered_qty, upc) || '-'})`]];
  const doHandover = async () => {
    const r = await post('handover', { ...h, unit: h.unit === 'CTN' ? 'CTN' : null, qty: Number(h.qty), request_key: key() }, 'Issued to Billing / Dispatch');
    if (!r?.handover_no) return;
    printDoc(`Store Handover Slip ${r.handover_no}`, [...meta, ['Issued now', `${fmt(r.qty)} = ${r.cartons} ctn + ${fmt(r.loose)} loose @ ${upc}`],
      ['Pending after this', fmt(r.pending_qty)], ['Received by', h.received_by]], ['From', 'To', 'Units', 'Cartons', 'Loose'],
      [['Finished Goods Store', 'Billing / Dispatch', fmt(r.qty), r.cartons, fmt(r.loose)]], ['Issued by (FG store)', 'Checked by', 'Received by (billing)']);
    setForm('');
  };
  const doDispatch = async () => {
    const r = await post('dispatch', { ...d, unit: d.unit === 'CTN' ? 'CTN' : null, qty: Number(d.qty), to_outlet_id: Number(d.to_outlet_id) || null, request_key: key() }, 'Dispatched');
    if (!r?.dispatch_no) return;
    const units = d.unit === 'CTN' ? Number(d.qty) * upc : Number(d.qty);
    printDoc(`Dispatch Note ${r.dispatch_no}`, [...meta, ['Invoice', d.invoice_no || '—'], ['Delivery challan', d.challan_no || '—'], ['E-way bill', d.eway_bill || '—'],
      ['Vehicle', d.vehicle_no || '—'], ['Transporter', d.transporter || '—'], ['LR no', d.lr_no || '—'], ['Pending after this', fmt(r.pending_qty)]],
      ['Product', 'Units', 'Cartons + loose'], [[o.product, fmt(units), ctnText(units, upc)]], ['Dispatched by', 'Driver', 'Customer acknowledgement']);
    setForm('');
  };
  return (
    <Modal open onClose={onClose} title={`Customer order ${o.so_no}`} width="max-w-6xl">
      <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-2 items-center"><Badge s={o.status === 'OPEN' ? 'PENDING' : o.status} />
          <span className="text-sm">{o.customer || 'Own brand'} / <b>{o.brand}</b> · {o.product} · <b>{upc} per carton</b> {o.customer_po_no && `· PO ${o.customer_po_no}`} {o.delivery_date && `· due ${o.delivery_date}`}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2">
          <Stat label="Ordered" value={fmt(o.ordered_qty)} sub={ctnText(o.ordered_qty, upc)} tone="blue" />
          <Stat label="In production" value={fmt(o.production_qty)} /><Stat label="Finished" value={fmt(o.finished_qty)} />
          <Stat label="QC approved" value={fmt(o.qc_approved_qty)} sub={ctnText(o.qc_approved_qty, upc)} tone="green" />
          <Stat label="Reserved" value={fmt(o.reserved_qty)} /><Stat label="Issued to dispatch" value={fmt(o.issued_qty)} sub={ctnText(o.issued_qty, upc)} />
          <Stat label="Billed" value={fmt(o.billed_qty)} /><Stat label="Dispatched" value={fmt(o.dispatched_qty)} sub={ctnText(o.dispatched_qty, upc)} tone="green" />
          <Stat label="Pending" value={fmt(o.pending_qty)} sub={ctnText(o.pending_qty, upc)} tone={o.pending_qty > 0 ? 'amber' : 'green'} />
        </div>
        {o.pending_production_qty > 0 && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Pending production: <b>{fmt(o.pending_production_qty)}</b> more units need to be produced and QC-approved for this order (create a production order for it under Production).</div>}
        {live && <div className="flex flex-wrap gap-2">
          <button className={btnSec} onClick={() => post('reserve', {}, 'Reserved available finished goods')}>Reserve finished goods</button>
          {o.reserved_qty > 0 && <button className={btnSec} onClick={() => post('release', undefined, 'Reservations released')}>Release reservation</button>}
          <button className={btnPri} onClick={() => setForm('handover')}>Issue to billing / dispatch</button>
          {o.ready_for_billing_qty > 0 && <button className={btnPri} onClick={() => setForm('dispatch')}>Dispatch ({fmt(o.ready_for_billing_qty)} ready)</button>}
          {o.ready_for_billing_qty > 0 && <button className={btnSec} onClick={() => { const qty = prompt('Units to bring back to Finished Goods'); const reason = qty && prompt('Reason');
            if (qty && reason) post('return-from-dispatch', { qty: Number(qty), unit: null, reason }, 'Returned to Finished Goods'); }}>Return from dispatch</button>}
          <div className="flex-1" />
          {o.dispatched_qty > 0 ? <button className={btnSec} onClick={() => { const r = prompt('Short-close reason'); if (r) post('finalize', { reason: r }, 'Order closed'); }}>Short-close</button>
            : <button className={btnSec} onClick={() => { const r = prompt('Cancel reason'); if (r) post('cancel', { reason: r }, 'Order cancelled'); }}>Cancel order</button>}
        </div>}
        {form === 'handover' && <div className="border rounded-lg p-3 bg-slate-50 flex flex-wrap gap-3 items-end">
          <L label="Quantity to hand over"><CartonQty value={h.qty} unit={h.unit} upc={upc} onChange={(v, u) => setH({ ...h, qty: v, unit: u })} /></L>
          <L label="Received by (billing)"><input className={`${inp} w-48`} value={h.received_by} onChange={(e) => setH({ ...h, received_by: e.target.value })} /></L>
          <L label="Remarks"><input className={`${inp} w-56`} value={h.remarks || ''} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></L>
          <span className="text-xs text-slate-500">Still to issue: {fmt(o.ordered_qty - o.issued_qty)} ({ctnText(o.ordered_qty - o.issued_qty, upc)})</span>
          <div className="flex-1" /><button className={btnSec} onClick={() => setForm('')}>Cancel</button><button className={btnPri} onClick={doHandover}>Post & print slip</button>
        </div>}
        {form === 'dispatch' && <div className="border rounded-lg p-3 bg-slate-50 grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><L label={`Quantity (ready ${fmt(o.ready_for_billing_qty)})`}><CartonQty value={d.qty} unit={d.unit} upc={upc} onChange={(v, u) => setD({ ...d, qty: v, unit: u })} /></L></div>
          {[['invoice_no', 'Invoice no'], ['challan_no', 'Delivery challan'], ['eway_bill', 'E-way bill'], ['vehicle_no', 'Vehicle no'], ['transporter', 'Transporter'], ['lr_no', 'LR / consignment no']].map(([k, l]) => (
            <L key={k} label={l}><input className={inp} value={d[k] || ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></L>))}
          {o.is_own_brand && <L label="Into retail outlet stock (own brand)"><select className={inp} value={d.to_outlet_id || ''} onChange={(e) => setD({ ...d, to_outlet_id: e.target.value })}>
            <option value="">— customer delivery —</option>{outlets.map((x: any) => <option key={x.id} value={x.id}>{x.outlet_name || x.name}</option>)}</select></L>}
          <L label="Remarks"><input className={inp} value={d.remarks || ''} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></L>
          <div className="md:col-span-4 flex justify-end gap-2"><button className={btnSec} onClick={() => setForm('')}>Cancel</button><button className={btnPri} onClick={doDispatch}>Dispatch & print note</button></div>
        </div>}
        <h3 className="font-semibold text-sm">Approved finished goods of this brand (Finished Goods store)</h3>
        <Table rows={o.fg_stock} empty="No approved finished goods of this product & brand." cols={[['Batch', (r) => r.batch_no], ['Expiry', (r) => r.exp_date || '—'],
          ['Physical', (r) => both(r.qty, upc), 'text-right'], ['Free (unreserved)', (r) => both(r.free, upc), 'text-right']]} />
        <h3 className="font-semibold text-sm">Store issues to billing / dispatch</h3>
        <Table rows={o.handovers} empty="Nothing issued yet." cols={[['Issue no', (r) => r.handover_no], ['When', (r) => r.issued], ['Batch', (r) => r.batch_no],
          ['Issued', (r) => both(r.qty, upc), 'text-right'], ['Dispatched', (r) => fmt(r.dispatched_qty), 'text-right'], ['Returned', (r) => fmt(r.returned_qty), 'text-right'],
          ['By / received', (r) => `${r.issued_by_name || ''} → ${r.received_by || ''}`]]} />
        <h3 className="font-semibold text-sm">Dispatches</h3>
        <Table rows={o.dispatches} empty="Nothing dispatched yet." cols={[['Dispatch', (r) => r.dispatch_no], ['Date', (r) => r.dispatch_date], ['Batch', (r) => r.batch_no],
          ['Qty', (r) => both(r.qty, upc), 'text-right'], ['Invoice / challan', (r) => `${r.invoice_no || '—'} / ${r.challan_no || '—'}`], ['E-way', (r) => r.eway_bill || '—'],
          ['Vehicle / LR', (r) => `${r.vehicle_no || '—'} / ${r.lr_no || '—'}`], ['To outlet', (r) => r.outlet_name || '—'],
          ['Acknowledgement', (r) => r.ack_status === 'PENDING' ? <select className={`${inp} w-32`} defaultValue="" onChange={(e) => e.target.value &&
            api.put(`/manufacturing/sales-orders/dispatches/${r.dispatch_no}/ack`, { ack_status: e.target.value, ack_note: prompt('Note (optional)') || null }).then(load).catch(err)}>
            <option value="">Pending…</option><option>RECEIVED</option><option>SHORT</option><option>DAMAGED</option></select> : r.ack_status]]} />
        {(o.production_orders.length > 0 || o.print_jobs.length > 0) && <div className="text-xs text-slate-600">
          Production: {o.production_orders.map((p: any) => `${p.order_no} (${fmt(p.planned_qty)} planned, ${fmt(p.approved_qty)} approved, ${p.status})`).join('; ') || '—'}<br />
          Printing: {o.print_jobs.map((p: any) => `${p.job_no} (${fmt(p.qty_issued)} issued, ${fmt(p.accepted_qty)} accepted, ${p.status})`).join('; ') || '—'}
        </div>}
      </div>
    </Modal>
  );
}
