import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { Badge, ItemPicker, Table, Tabs, btnPri, btnSec, err, fmt, inp, useList } from './mfgShared';

const TABS = ['Store Stock', 'Transfers', 'Stock Ledger', 'Opening Stock', 'Stores'];

export default function MfgStores() {
  const [tab, setTab] = useState(TABS[0]);
  const [stores, loadStores] = useList<any>('/manufacturing/stores');
  const [brands] = useList<any>('/manufacturing/brands');
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-warehouse text-indigo-600 mr-2" />Department Stores & Stock</h1>
      <p className="text-xs text-slate-500 mb-4">Every movement between departments is posted to the stock ledger; posted rows are never edited — a correction is a reversal.</p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'Store Stock' && <Stock stores={stores} brands={brands} />}
      {tab === 'Transfers' && <Transfers stores={stores} brands={brands} />}
      {tab === 'Stock Ledger' && <Ledger stores={stores} />}
      {tab === 'Opening Stock' && <Opening stores={stores} brands={brands} />}
      {tab === 'Stores' && <Stores stores={stores} reload={loadStores} />}
    </div>
  );
}

const StoreSelect = ({ stores, value, onChange, all }: any) => (
  <select className={inp} value={value || ''} onChange={(e) => onChange(Number(e.target.value) || null)}>
    <option value="">{all ? 'All stores' : 'Choose store…'}</option>
    {stores.filter((s: any) => s.is_active).map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
  </select>
);

function Stock({ stores, brands }: any) {
  const [store, setStore] = useState<number | null>(null);
  const [brand, setBrand] = useState('');
  const [q, setQ] = useState('');
  const [rows] = useList<any>('/manufacturing/stock', { store_id: store || undefined, brand_id: brand || undefined, search: q });
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="w-64"><StoreSelect stores={stores} value={store} onChange={setStore} all /></div>
        <select className={`${inp} w-52`} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option><option value="0">General (no brand)</option>
          {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className={`${inp} w-64`} placeholder="Search item / code / batch" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} empty="No stock in the selected store." cols={[
        ['Store', (r) => <span title={r.store}>{r.store_code}{!r.usable && <span className="ml-1 text-[10px] text-amber-700">{r.is_wip ? 'WIP' : 'not usable'}</span>}</span>],
        ['Item', (r) => <><span className="font-mono text-xs text-slate-500 mr-1">{r.item_code}</span>{r.item}</>],
        ['Batch', (r) => r.batch_no || '—'], ['Brand', (r) => r.brand || 'General'],
        ['Qty', (r) => <b>{fmt(r.qty)} {r.unit}</b>, 'text-right'],
        ['Cartons', (r) => r.units_per_carton > 1 ? `${r.cartons} ctn + ${fmt(r.loose)} loose` : '—', 'text-right'],
        ['Value', (r) => `₹${fmt(r.value)}`, 'text-right'],
      ]} />
    </>
  );
}

type Line = { product_id: number | null; name?: string; unit?: string; qty: string; entry_unit: string; batch_no: string; brand_id: number };
const newLine = (): Line => ({ product_id: null, qty: '', entry_unit: '', batch_no: '', brand_id: 0 });

function Lines({ lines, setLines, brands }: { lines: Line[]; setLines: (l: Line[]) => void; brands: any[] }) {
  const upd = (i: number, v: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...v } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-4"><ItemPicker value={l.product_id} label={l.name} onPick={(p) => upd(i, { product_id: p?.id ?? null, name: p?.name, unit: p?.unit })} /></div>
          <input type="number" className={`${inp} col-span-2`} placeholder="Qty" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} />
          <input className={`${inp} col-span-1`} placeholder={l.unit || 'Unit'} title="Blank = base unit; CTN = cartons; any unit set in Item Units" value={l.entry_unit} onChange={(e) => upd(i, { entry_unit: e.target.value.toUpperCase() })} />
          <input className={`${inp} col-span-2`} placeholder="Batch (optional)" value={l.batch_no} onChange={(e) => upd(i, { batch_no: e.target.value })} />
          <select className={`${inp} col-span-2`} value={l.brand_id} onChange={(e) => upd(i, { brand_id: Number(e.target.value) })}>
            <option value={0}>General</option>{brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="col-span-1 text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button>
        </div>
      ))}
      <button className={btnSec} onClick={() => setLines([...lines, newLine()])}><i className="fas fa-plus mr-1" />Add line</button>
    </div>
  );
}

const linesBody = (lines: Line[]) => lines.filter((l) => l.product_id && Number(l.qty) > 0)
  .map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit: l.entry_unit || undefined, batch_no: l.batch_no.trim(), brand_id: l.brand_id }));

function Transfers({ stores, brands }: any) {
  const [status, setStatus] = useState('PENDING');
  const [rows, load] = useList<any>('/manufacturing/transfers', { status: status || undefined });
  const [f, setF] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/transfers', { ...f, lines: linesBody(lines) });
      toast.success(`${r.data.transfer_no} sent for approval`); setF(null); setLines([newLine()]); load();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  const approve = (t: any) => api.post(`/manufacturing/transfers/${t.id}/approve`).then(() => { toast.success(`${t.transfer_no} approved & posted`); load(); }).catch(err);
  const reject = (t: any) => {
    const reason = prompt(`Reason for rejecting ${t.transfer_no}?`);
    if (reason) api.post(`/manufacturing/transfers/${t.id}/reject`, { reason }).then(() => { toast.success('Rejected'); load(); }).catch(err);
  };
  return (
    <>
      <div className="flex gap-2 mb-3">
        <select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button className={btnPri} onClick={() => setF({ from_store_id: null, to_store_id: null, remarks: '' })}><i className="fas fa-exchange-alt mr-1" />New Transfer</button>
      </div>
      <Table rows={rows} cols={[
        ['No.', (r) => <span className="font-mono">{r.transfer_no}</span>], ['Date', (r) => r.requested],
        ['From → To', (r) => `${r.from_store} → ${r.to_store}`],
        ['Items', (r) => r.lines?.map((l: any) => <div key={l.id} className="text-xs">{l.item}{l.batch_no && ` [${l.batch_no}]`}: <b>{fmt(l.qty)} {l.unit}</b>{l.brand && ` · ${l.brand}`}</div>)],
        ['Requested by', (r) => r.requested_by_name], ['Approved by', (r) => r.approved_by_name || '—'],
        ['Status', (r) => <><Badge s={r.status} />{r.reject_reason && <div className="text-xs text-rose-600">{r.reject_reason}</div>}</>],
        ['', (r) => r.status === 'PENDING' && <div className="flex gap-1 justify-end"><button className={btnPri} onClick={() => approve(r)}>Approve</button><button className={btnSec} onClick={() => reject(r)}>Reject</button></div>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title="New department transfer" width="max-w-4xl">
        {f && <div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">From store<StoreSelect stores={stores} value={f.from_store_id} onChange={(v: any) => setF({ ...f, from_store_id: v })} /></label>
            <label className="text-xs font-semibold text-slate-600">To store<StoreSelect stores={stores} value={f.to_store_id} onChange={(v: any) => setF({ ...f, to_store_id: v })} /></label>
          </div>
          <Lines lines={lines} setLines={setLines} brands={brands} />
          <input className={inp} placeholder="Remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          <p className="text-xs text-slate-500">Stock moves only when another user approves the transfer.</p>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} disabled={busy} onClick={create}>Send for approval</button></div>
        </div>}
      </Modal>
    </>
  );
}

function Ledger({ stores }: any) {
  const today = new Date().toISOString().slice(0, 10);
  const [p, setP] = useState<any>({ store_id: null, from_date: today.slice(0, 8) + '01', to_date: today, search: '' });
  const [rows, load] = useList<any>('/manufacturing/ledger', { ...p, store_id: p.store_id || undefined });
  const reverse = (r: any) => {
    const reason = prompt(`Reverse ${r.doc_no} (${fmt(r.qty)} ${r.unit} ${r.item})? Reason:`);
    if (reason) api.post(`/manufacturing/stock/txns/${r.id}/reverse`, { reason }).then((x) => { toast.success(`Reversed as ${x.data.doc_no}`); load(); }).catch(err);
  };
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="w-64"><StoreSelect stores={stores} value={p.store_id} onChange={(v: any) => setP({ ...p, store_id: v })} all /></div>
        <input type="date" className={`${inp} w-40`} value={p.from_date} onChange={(e) => setP({ ...p, from_date: e.target.value })} />
        <input type="date" className={`${inp} w-40`} value={p.to_date} onChange={(e) => setP({ ...p, to_date: e.target.value })} />
        <input className={`${inp} w-64`} placeholder="Doc / item / batch / ref" value={p.search} onChange={(e) => setP({ ...p, search: e.target.value })} />
      </div>
      <Table rows={rows} empty="No movements in this period." cols={[
        ['Doc', (r) => <span className="font-mono text-xs">{r.doc_no}</span>], ['When', (r) => r.posted], ['Type', (r) => r.txn_type],
        ['Item', (r) => r.item], ['Batch', (r) => r.batch_no || '—'], ['Brand', (r) => r.brand || '—'],
        ['From', (r) => r.from_store || '—'], ['To', (r) => r.to_store || '—'],
        ['Qty', (r) => <b>{fmt(r.qty)} {r.unit}</b>, 'text-right'],
        ['Entered', (r) => r.unit_entered ? `${fmt(r.qty_entered)} ${r.unit_entered}` : '—'],
        ['Ref', (r) => r.ref_no || '—'], ['By', (r) => r.posted_by], ['Remarks', (r) => <span className="text-xs">{r.remarks}</span>],
        ['', (r) => r.reversed_by ? <span className="text-xs text-slate-500">reversed by {r.reversed_by}</span>
          : !r.reversal_of && <button className={btnSec} title="Post a reversal" onClick={() => reverse(r)}><i className="fas fa-undo" /></button>, 'text-right'],
      ]} />
    </>
  );
}

function Opening({ stores, brands }: any) {
  const [store, setStore] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [remarks, setRemarks] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!store) return toast.error('Choose the store');
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/stock/opening', { store_id: store, lines: linesBody(lines), remarks, request_key: key });
      toast.success(`Opening stock posted: ${r.data.doc_no}`); setLines([newLine()]); setRemarks(''); setKey(crypto.randomUUID());
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3 max-w-5xl">
      <p className="text-sm text-slate-600">Stock already physically in a department when this module starts. Managers / administrators only.</p>
      <div className="w-72"><StoreSelect stores={stores} value={store} onChange={setStore} /></div>
      <Lines lines={lines} setLines={setLines} brands={brands} />
      <input className={inp} placeholder="Remarks (e.g. physical count 27-Oct)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="flex justify-end"><button className={btnPri} disabled={busy} onClick={post}>Post opening stock</button></div>
    </div>
  );
}

function Stores({ stores, reload }: any) {
  const [f, setF] = useState<any>(null);
  const save = () => api.put(`/manufacturing/stores/${f.id}`, f).then(() => { toast.success('Store saved'); setF(null); reload(); }).catch(err);
  return (
    <>
      <Table rows={stores} cols={[
        ['Code', (r) => <span className="font-mono">{r.code}</span>], ['Store', (r) => r.name], ['Kind', (r) => r.kind],
        ['Usable stock', (r) => r.is_wip ? 'Work in progress' : r.usable ? 'Yes' : 'No'],
        ['Items in stock', (r) => r.items, 'text-right'], ['Total qty', (r) => fmt(r.qty), 'text-right'],
        ['Active', (r) => r.is_active ? 'Yes' : 'No'],
        ['', (r) => <button className={btnSec} onClick={() => setF({ ...r })}>Edit</button>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={`Store ${f?.code}`}>
        {f && <div className="space-y-3">
          <input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.usable} onChange={(e) => setF({ ...f, usable: e.target.checked })} />Stock here is usable (available for issue / sale)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
    </>
  );
}
