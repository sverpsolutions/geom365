// Smart reorder (from NCG): Stock Planning (min / max / reorder), Supplier Visits, supplier-wise reorder -> draft PO, planning reports.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { Table, btnPri, btnSec, err, fmt, inp } from '../manufacturing/mfgShared';

const inr = (v: any) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const sel = `${inp} !w-auto`;
const clean = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

async function download(url: string, params: any, name: string) {
  try {
    const r = await api.get(url, { params: clean(params), responseType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { err(e); }
}

type Opts = { outlets: any[]; suppliers: any[]; categories: string[]; brands: string[]; buyers: any[]; sales_days: number[] };
function useOpts() {
  const [o, setO] = useState<Opts>({ outlets: [], suppliers: [], categories: [], brands: [], buyers: [], sales_days: [15, 30, 60, 90] });
  useEffect(() => { api.get('/reorder/filters').then(r => setO(r.data)).catch(err); }, []);
  return o;
}

const Title = ({ icon, title, sub, children }: any) => (
  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
    <div>
      <h1 className="text-xl font-bold text-slate-800"><i className={`fas ${icon} text-indigo-600 mr-2`} />{title}</h1>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
const Card = ({ k, v, tone = 'text-slate-800', on, onClick }: any) => (
  <button onClick={onClick} disabled={!onClick} className={`border rounded-lg p-3 text-left bg-white ${on ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-slate-200'}`}>
    <div className="text-[11px] text-slate-500">{k}</div><div className={`text-xl font-bold ${tone}`}>{v}</div>
  </button>
);
const SupplierSelect = ({ o, value, onChange, all = 'All suppliers' }: any) => (
  <select className={sel} value={value} onChange={e => onChange(e.target.value)} aria-label="Supplier">
    <option value="">{all}</option>{o.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
  </select>
);

// ── Stock Planning ────────────────────────────────────────────────────────────
const FIELDS: [string, string][] = [['min_stock', 'Min'], ['max_stock_level', 'Max'], ['reorder_level', 'Reorder'], ['fixed_margin_percent', 'Margin %'],
  ['supplier_visit_days', 'Visit days'], ['safety_stock_days', 'Safety days'], ['lead_time_days', 'Lead days']];

function Cell({ row, field, canSave }: { row: any; field: string; canSave: boolean }) {
  const [v, setV] = useState(row[field] ?? '');
  useEffect(() => setV(row[field] ?? ''), [row, field]);
  const save = async () => {
    if (String(v) === String(row[field] ?? '')) return;
    try { const r = await api.put('/reorder/planning/save', { id: row.id, field, value: String(v) }); row[field] = r.data.value; setV(r.data.value ?? ''); }
    catch (e) { err(e); setV(row[field] ?? ''); }
  };
  return <input aria-label={field} disabled={!canSave} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-right text-xs" value={v} onChange={e => setV(e.target.value)} onBlur={save}
    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function StockPlanning() {
  const o = useOpts();
  const [f, setF] = useState({ supplier_id: '', category: '', brand: '', q: '', flag: '' });
  const [data, setData] = useState<{ rows: any[]; capped: boolean }>({ rows: [], capped: false });
  const [fill, setFill] = useState<any>(null);
  const [hist, setHist] = useState<any[] | null>(null);
  const load = () => api.get('/reorder/planning', { params: clean(f) }).then(r => setData(r.data)).catch(err);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const runFill = async (apply: boolean) => {
    try {
      const r = await api.put('/reorder/planning/smart-fill', { ...f, supplier_id: f.supplier_id ? Number(f.supplier_id) : null, days: fill.days, overwrite: fill.overwrite, apply });
      setFill({ ...fill, res: r.data });
      if (apply) { toast.success(`${r.data.applied} item(s) updated`); load(); }
    } catch (e) { err(e); }
  };
  const importFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data: r } = await api.put('/reorder/planning/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${r.updated} updated, ${r.unchanged} unchanged`);
      if (r.unknown_count || r.bad_count) toast.error([r.unknown_count ? `Unknown codes: ${r.unknown.join(', ')}` : '', r.bad_count ? `Skipped: ${r.bad.join('; ')}` : ''].filter(Boolean).join(' · '), { duration: 10000 });
      load();
    } catch (e) { err(e); }
  };

  return (
    <div className="p-4 max-w-[1500px] mx-auto">
      <Title icon="fa-sliders-h" title="Stock Planning" sub="Minimum, Maximum, Reorder level, margin and visit / safety / lead days per item. Edits save when you leave the box.">
        <button className={btnPri} onClick={() => setFill({ days: 60, overwrite: false })}><i className="fas fa-magic mr-1" />Smart Fill</button>
        <button className={btnSec} onClick={() => download('/reorder/planning/export', f, 'Stock_Planning.xlsx')}><i className="fas fa-file-excel mr-1" />Export</button>
        <label className={`${btnSec} cursor-pointer`}><i className="fas fa-upload mr-1" />Import<input type="file" accept=".xlsx" className="hidden" onChange={e => { if (e.target.files?.[0]) importFile(e.target.files[0]); e.target.value = ''; }} /></label>
        <button className={btnSec} onClick={() => api.get('/reorder/planning/history').then(r => setHist(r.data)).catch(err)}>History</button>
      </Title>
      <div className="flex flex-wrap gap-2 mb-3">
        <SupplierSelect o={o} value={f.supplier_id} onChange={(v: string) => setF({ ...f, supplier_id: v })} />
        <select className={sel} value={f.category} onChange={set('category')} aria-label="Category"><option value="">All categories</option>{o.categories.map(c => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={f.brand} onChange={set('brand')} aria-label="Brand"><option value="">All brands</option>{o.brands.map(c => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={f.flag} onChange={set('flag')} aria-label="Show">
          <option value="">All items</option><option value="below_min">Below Minimum</option><option value="below_reorder">At / below Reorder</option><option value="above_max">Above Maximum</option><option value="not_set">Levels not set</option>
        </select>
        <input className={`${inp} !w-56`} placeholder="Search name or code" value={f.q} onChange={set('q')} />
      </div>
      {data.capped && <p className="text-xs text-amber-700 mb-2">Showing the first 500 items — use the filters, or Export for everything.</p>}
      <Table rows={data.rows} cols={[
        ['Code', r => <span className="font-mono text-xs">{r.item_code}</span>],
        ['Item', r => r.name],
        ['Supplier', r => <span className="text-xs">{r.supplier || '—'}</span>],
        ['Stock', r => <span className={r.min_stock > 0 && r.stock < r.min_stock ? 'text-rose-600 font-bold' : r.max_stock_level > 0 && r.stock > r.max_stock_level ? 'text-amber-600 font-bold' : ''}>{fmt(r.stock)}</span>, 'text-right'],
        ...FIELDS.map(([k, h]) => [h, (r: any) => <Cell row={r} field={k} canSave />, 'text-right'] as [string, (r: any) => any, string]),
      ]} empty="No items match." />

      <Modal open={!!fill} onClose={() => setFill(null)} title="Smart Fill — Min / Reorder / Max from real sales" width="max-w-4xl">
        {fill && <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500"><b>Min</b> = daily sale × (lead + safety) · <b>Max</b> = daily sale × (visit + lead + safety) · <b>Reorder</b> = halfway. Applies to the items in the current filter; items with no sales are left alone.</p>
          <div className="flex flex-wrap gap-3 items-center">
            <label>Sales period <select className={sel} value={fill.days} onChange={e => setFill({ ...fill, days: Number(e.target.value), res: null })}>{[30, 60, 90, 120].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={fill.overwrite} onChange={e => setFill({ ...fill, overwrite: e.target.checked, res: null })} />Also overwrite items that already have levels</label>
            <button className={btnSec} onClick={() => runFill(false)}>Preview</button>
          </div>
          {fill.res && <>
            <p>{fill.res.fill} of {fill.res.total} item(s) will be set · {fill.res.skipped_set} already set · {fill.res.skipped_nosales} no sales{fill.res.applied ? ` · ${fill.res.applied} saved` : ''}</p>
            <div className="max-h-80 overflow-y-auto"><Table rows={fill.res.rows} cols={[['Item', r => r.name], ['Avg/day', r => r.avg, 'text-right'], ['Visit+Lead+Safety', r => `${r.visit}+${r.lead}+${r.safety}`, 'text-right'],
              ['Min', r => <>{fmt(r.old[0])} → <b>{r.new[0]}</b></>, 'text-right'], ['Max', r => <>{fmt(r.old[1])} → <b>{r.new[1]}</b></>, 'text-right'], ['Reorder', r => <>{fmt(r.old[2])} → <b>{r.new[2]}</b></>, 'text-right']]} /></div>
            {fill.res.fill > 60 && <p className="text-xs text-slate-500">Preview shows the first 60.</p>}
            <div className="flex justify-end"><button className={btnPri} disabled={!fill.res.fill || !!fill.res.applied} onClick={() => confirm(`Update levels on ${fill.res.fill} item(s)?`) && runFill(true)}>Apply to {fill.res.fill} item(s)</button></div>
          </>}
        </div>}
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title="Stock planning — change history" width="max-w-4xl">
        <div className="max-h-[70vh] overflow-y-auto"><Table rows={hist || []} cols={[['When', r => new Date(r.changed_at).toLocaleString('en-IN')], ['Item', r => r.name], ['Field', r => r.field_name], ['Old', r => r.old_value ?? '—'], ['New', r => r.new_value ?? '—'], ['By', r => r.user_name || '—'], ['Source', r => r.source]]} /></div>
      </Modal>
    </div>
  );
}

// ── Supplier Visits ───────────────────────────────────────────────────────────
const STATE: Record<string, [string, string]> = { overdue: ['Overdue', 'bg-rose-100 text-rose-700'], today: ['Today', 'bg-amber-100 text-amber-800'], soon: ['This week', 'bg-sky-100 text-sky-800'], later: ['Later', 'bg-slate-100 text-slate-600'], none: ['Not set', 'bg-slate-100 text-slate-500'] };

export function SupplierVisits() {
  const o = useOpts();
  const [f, setF] = useState({ status: '', q: '', buyer: '' });
  const [d, setD] = useState<any>({ rows: [], cards: {}, remind: [], remind_days: 3 });
  const [edit, setEdit] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const load = () => api.get('/reorder/visits', { params: clean(f) }).then(r => setD(r.data)).catch(err);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]);
  const list = (s: string) => s.split(',').map(x => parseInt(x.trim())).filter(n => !isNaN(n));
  const save = async () => {
    try {
      const { data } = await api.put('/reorder/visits/save', { supplier_id: edit.id, schedule_type: edit.schedule_type, interval_days: edit.schedule_type === 'interval' ? Number(edit.interval_days) || null : null,
        weekdays: edit.schedule_type === 'weekly' ? edit.days : [], month_dates: edit.schedule_type === 'monthly_dates' ? list(edit.dates) : [], lead_time_days: edit.lead_time_days === '' ? null : Number(edit.lead_time_days),
        last_visit_date: edit.last_visit_date || null, next_visit_date: edit.next_visit_date || null, assigned_buyer: edit.assigned_buyer ? Number(edit.assigned_buyer) : null, remarks: edit.remarks || null, reason: edit.reason || null });
      toast.success(`Saved · next visit ${dmy(data.next)}`); setEdit(null); load();
    } catch (e) { err(e); }
  };
  const record = async () => {
    try { const { data } = await api.put('/reorder/visits/record', { supplier_id: rec.id, visit_date: rec.date, notes: rec.notes || null, po_value: Number(rec.po || 0) }); toast.success(`Recorded · next visit ${dmy(data.next)}`); setRec(null); load(); }
    catch (e) { err(e); }
  };
  const openEdit = (r: any) => setEdit({ ...r, schedule_type: r.schedule_type || 'interval', interval_days: r.interval_days ?? 7, days: r.weekdays || [], dates: (r.month_dates || []).join(','), lead_time_days: r.lead_time_days ?? '', last_visit_date: r.last_visit_date || '', next_visit_date: '', assigned_buyer: r.assigned_buyer || '', remarks: r.remarks || '', reason: '' });
  const set = (k: string) => (e: any) => setEdit({ ...edit, [k]: e.target.value });
  const c = d.cards;
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <Title icon="fa-calendar-check" title="Supplier Visits" sub="Each supplier's visit cycle and lead time. These drive the Smart Reorder quantities." />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <Card k="Suppliers" v={c.total ?? 0} on={!f.status} onClick={() => setF({ ...f, status: '' })} />
        <Card k="Overdue" v={c.overdue ?? 0} tone="text-rose-600" on={f.status === 'overdue'} onClick={() => setF({ ...f, status: 'overdue' })} />
        <Card k="Today" v={c.today ?? 0} tone="text-amber-600" on={f.status === 'today'} onClick={() => setF({ ...f, status: 'today' })} />
        <Card k="Next 7 days" v={c.soon ?? 0} tone="text-sky-700" on={f.status === 'soon'} onClick={() => setF({ ...f, status: 'soon' })} />
        <Card k="Not set" v={c.none ?? 0} on={f.status === 'none'} onClick={() => setF({ ...f, status: 'none' })} />
      </div>
      {d.remind.length > 0 && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"><i className="fas fa-bell mr-1" />Due within {d.remind_days} days: {d.remind.map((r: any) => `${r.name} (${r.days_to === 0 ? 'today' : dmy(r.next_visit_date)})`).join(', ')}</div>}
      <div className="flex flex-wrap gap-2 mb-3">
        <input className={`${inp} !w-56`} placeholder="Supplier or phone" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <select className={sel} value={f.buyer} onChange={e => setF({ ...f, buyer: e.target.value })} aria-label="Purchase manager"><option value="">All purchase managers</option>{o.buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </div>
      <Table rows={d.rows} cols={[
        ['Supplier', r => <><div className="font-semibold">{r.name}</div><div className="text-xs text-slate-500">{r.contact_name || ''} {r.phone}</div></>],
        ['Frequency', r => r.freq], ['Lead', r => r.lead_time_days ?? '—', 'text-right'], ['Last visit', r => dmy(r.last_visit_date)],
        ['Next visit', r => <>{dmy(r.next_visit_date)} <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATE[r.state][1]}`}>{STATE[r.state][0]}</span></>],
        ['To order', r => r.need_items || '—', 'text-right'], ['Manager', r => r.buyer_name || '—'],
        ['', r => <div className="flex gap-1 justify-end"><button className={btnPri} onClick={() => setRec({ ...r, date: new Date().toLocaleDateString('en-CA'), notes: '', po: '' })}>Visited</button><button className={btnSec} onClick={() => openEdit(r)}>Edit</button>
          <button className={btnSec} onClick={() => api.get(`/reorder/visits/${r.id}/history`).then(x => setHist({ ...x.data, name: r.name })).catch(err)}>History</button></div>, 'text-right'],
      ]} empty="No suppliers." />

      <Modal open={!!rec} onClose={() => setRec(null)} title={`Record visit • ${rec?.name ?? ''}`} width="max-w-md">
        {rec && <div className="space-y-3 text-sm">
          <label className="block">Visit date<input type="date" className={inp} value={rec.date} max={new Date().toLocaleDateString('en-CA')} onChange={e => setRec({ ...rec, date: e.target.value })} /></label>
          <label className="block">PO value discussed<input type="number" min={0} className={inp} value={rec.po} onChange={e => setRec({ ...rec, po: e.target.value })} /></label>
          <label className="block">Notes<input className={inp} value={rec.notes} onChange={e => setRec({ ...rec, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setRec(null)}>Cancel</button><button className={btnPri} onClick={record}>Save</button></div>
        </div>}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Visit schedule • ${edit?.name ?? ''}`} width="max-w-xl">
        {edit && <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <label className="block">Frequency<select className={inp} value={edit.schedule_type} onChange={set('schedule_type')}><option value="interval">Every N days</option><option value="daily">Daily</option><option value="weekly">Weekly on days</option><option value="monthly_dates">Monthly on dates</option></select></label>
          {edit.schedule_type === 'interval' && <label className="block">Days between visits<input type="number" min={1} max={365} className={inp} value={edit.interval_days} onChange={set('interval_days')} /></label>}
          {edit.schedule_type === 'monthly_dates' && <label className="block">Dates (e.g. 5,20)<input className={inp} value={edit.dates} onChange={set('dates')} /></label>}
          {edit.schedule_type === 'weekly' && <div className="sm:col-span-2 flex flex-wrap gap-3">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => <label key={n} className="flex items-center gap-1"><input type="checkbox" checked={edit.days.includes(i + 1)} onChange={e => setEdit({ ...edit, days: e.target.checked ? [...edit.days, i + 1] : edit.days.filter((x: number) => x !== i + 1) })} />{n}</label>)}</div>}
          <label className="block">Lead time (days)<input type="number" min={0} max={60} className={inp} value={edit.lead_time_days} onChange={set('lead_time_days')} /></label>
          <label className="block">Last visit<input type="date" className={inp} value={edit.last_visit_date} onChange={set('last_visit_date')} /></label>
          <label className="block">Next visit (blank = work it out)<input type="date" className={inp} value={edit.next_visit_date} onChange={set('next_visit_date')} /></label>
          <label className="block">Purchase manager<select className={inp} value={edit.assigned_buyer} onChange={set('assigned_buyer')}><option value="">—</option>{o.buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block sm:col-span-2">Remarks<input className={inp} value={edit.remarks} onChange={set('remarks')} /></label>
          <label className="block sm:col-span-2">Reason for change<input className={inp} value={edit.reason} onChange={set('reason')} /></label>
          <div className="sm:col-span-2 flex justify-end gap-2"><button className={btnSec} onClick={() => setEdit(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title={`Visit history • ${hist?.name ?? ''}`} width="max-w-4xl">
        {hist && <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <Table rows={hist.visits} cols={[['Date', r => dmy(r.visit_date)], ['By', r => r.user_name || '—'], ['PO value', r => inr(r.po_value), 'text-right'], ['Notes', r => r.notes || '—']]} empty="No visits recorded." />
          <Table rows={hist.audit} cols={[['When', r => new Date(r.created_at).toLocaleString('en-IN')], ['Field', r => r.field_name], ['Old', r => r.old_value ?? '—'], ['New', r => r.new_value ?? '—'], ['Reason', r => r.reason || '—'], ['By', r => r.user_name || '—']]} empty="No changes." />
        </div>}
      </Modal>
    </div>
  );
}

// ── Smart Reorder ─────────────────────────────────────────────────────────────
export function SmartReorder() {
  const o = useOpts();
  const nav = useNavigate();
  const [f, setF] = useState({ supplier_id: '', outlet_id: '', days: '30', category: '', brand: '', mode: 'reorder' });
  const [res, setRes] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [item, setItem] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/reorder/smart/dashboard').then(r => setDash(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!f.supplier_id) { setRes(null); return; }
    const { supplier_id, ...q } = f;
    api.get(`/reorder/smart/${supplier_id}`, { params: clean(q) }).then(r => {
      setRes(r.data);
      setPicked(Object.fromEntries(r.data.rows.filter((x: any) => x.sug > 0).map((x: any) => [x.id, String(x.sug)])));
    }).catch(err);
  }, [f]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const rows = res?.rows || [];
  const chosen = useMemo(() => rows.filter((r: any) => picked[r.id] !== undefined && Number(picked[r.id]) > 0), [rows, picked]);
  const value = chosen.reduce((a: number, r: any) => a + Number(picked[r.id]) * r.cost, 0);
  const toggle = (r: any, on: boolean) => setPicked(p => { const n = { ...p }; if (on) n[r.id] = String(r.sug || 1); else delete n[r.id]; return n; });
  const create = async (force = false): Promise<void> => {
    setBusy(true);
    try {
      const { data } = await api.post('/reorder/smart/create-po', { supplier_id: Number(f.supplier_id), outlet_id: f.outlet_id ? Number(f.outlet_id) : null, days: Number(f.days), force,
        items: chosen.map((r: any) => ({ product_id: r.id, qty: Number(picked[r.id]) })) });
      toast.success(`Draft PO ${data.po_no} created with ${data.items} item(s)`);
      nav(`/purchases/po/${data.po_id}`);
    } catch (e: any) {
      if (e?.response?.status === 409 && confirm(`${e.response.data.detail} Create another?`)) { setBusy(false); return create(true); }
      if (e?.response?.status !== 409) err(e);
    } finally { setBusy(false); }
  };
  const open = (r: any) => api.get(`/reorder/item/${r.id}`, { params: clean({ outlet_id: f.outlet_id }) }).then(x => setItem(x.data)).catch(err);
  const c = res?.cards;
  return (
    <div className="p-4 max-w-[1500px] mx-auto">
      <Title icon="fa-robot" title="Smart Supplier Reorder" sub="Pick a supplier: how much to order from sales, stock, open POs and the visit cycle. You review it; a draft PO is made only when you ask.">
        {f.supplier_id && <button className={btnSec} onClick={() => { const { supplier_id, ...q } = f; download('/reorder/smart/export', { ...q, supplier_id }, 'Smart_Reorder.xlsx'); }}><i className="fas fa-file-excel mr-1" />Export</button>}
      </Title>
      <div className="flex flex-wrap gap-2 mb-3">
        <SupplierSelect o={o} value={f.supplier_id} onChange={(v: string) => setF({ ...f, supplier_id: v })} all="Choose a supplier…" />
        <select className={sel} value={f.outlet_id} onChange={set('outlet_id')} aria-label="Location"><option value="">All my locations</option>{o.outlets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className={sel} value={f.days} onChange={set('days')} aria-label="Sales period">{o.sales_days.map(d => <option key={d} value={d}>Sales: last {d} days</option>)}</select>
        <select className={sel} value={f.mode} onChange={set('mode')} aria-label="Show"><option value="reorder">Items to order</option><option value="all">All items</option><option value="below_min">Below Minimum</option><option value="above_max">Above Maximum</option></select>
        <select className={sel} value={f.category} onChange={set('category')} aria-label="Category"><option value="">All categories</option>{o.categories.map(x => <option key={x}>{x}</option>)}</select>
        <select className={sel} value={f.brand} onChange={set('brand')} aria-label="Brand"><option value="">All brands</option>{o.brands.map(x => <option key={x}>{x}</option>)}</select>
      </div>
      {!f.supplier_id && dash && <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card k="Active suppliers" v={dash.suppliers} /><Card k="Visits next 7 days" v={dash.visits} tone="text-sky-700" /><Card k="Visits overdue" v={dash.overdue} tone="text-rose-600" />
        <Card k="At / below Reorder" v={dash.below_reorder} tone="text-amber-600" /><Card k="Below Minimum" v={dash.below_min} tone="text-rose-600" /><Card k="Low-margin GRN lines (30d)" v={dash.low_margin} />
      </div>}
      {res && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <Card k="Items" v={c.items} /><Card k="To order" v={c.reorder} tone="text-indigo-700" /><Card k="Below Minimum" v={c.below_min} tone="text-rose-600" /><Card k="Above Maximum" v={c.above_max} tone="text-amber-600" /><Card k="Suggested value" v={inr(c.value)} />
        </div>
        <p className="text-xs text-slate-500 mb-2">Next visit: <b>{dmy(res.schedule?.next_visit_date)}</b> · visit every {res.sup_visit} days · lead {res.sup_lead} days · sales period {res.days} days</p>
        <Table rows={rows} cols={[
          ['', r => <input type="checkbox" aria-label={`Select ${r.name}`} checked={picked[r.id] !== undefined} onChange={e => toggle(r, e.target.checked)} />],
          ['Item', r => <button className="text-left text-indigo-700 hover:underline" onClick={() => open(r)}>{r.name}<div className="text-[11px] font-mono text-slate-400">{r.item_code}</div></button>],
          ['Stock', r => <span className={r.below_min ? 'text-rose-600 font-bold' : ''}>{fmt(r.stock)}</span>, 'text-right'],
          ['Avg/day', r => r.avg, 'text-right'], ['15d', r => fmt(r.sales_15), 'text-right'], ['Min', r => fmt(r.min), 'text-right'], ['Max', r => fmt(r.max), 'text-right'], ['Reorder', r => fmt(r.rl), 'text-right'],
          ['Cover days', r => <span title={`visit ${r.visit} + lead ${r.lead} + safety ${r.safety}`}>{r.cover}</span>, 'text-right'], ['Pending PO', r => fmt(r.pend), 'text-right'], ['Incoming', r => fmt(r.inc), 'text-right'],
          ['Suggested', r => <>{fmt(r.sug)}{r.capped && <span className="text-[10px] text-amber-700 block">capped at Max</span>}</>, 'text-right'],
          ['Order qty', r => <input aria-label={`Quantity for ${r.name}`} type="number" min={0} className="w-20 border border-slate-300 rounded px-1 py-0.5 text-right" disabled={picked[r.id] === undefined} value={picked[r.id] ?? ''} onChange={e => setPicked({ ...picked, [r.id]: e.target.value })} />, 'text-right'],
          ['Cost', r => inr(r.cost), 'text-right'],
        ]} empty="Nothing to order from this supplier." />
        <div className="sticky bottom-0 mt-3 bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm">{chosen.length} item(s) selected · <b>{inr(value)}</b> before GST</span>
          <button className={btnPri} disabled={busy || !chosen.length} onClick={() => create()}><i className="fas fa-file-invoice mr-1" />Create draft PO</button>
        </div>
      </>}
      <Modal open={!!item} onClose={() => setItem(null)} title={item?.item.name ?? ''} width="max-w-2xl">
        {item && <div className="space-y-3 text-sm">
          <p>Supplier: <b>{item.item.supplier || '—'}</b> · Stock <b>{fmt(item.item.stock)}</b> · Min {fmt(item.item.min_stock)} · Reorder {fmt(item.item.reorder_level)} · Max {fmt(item.item.max_stock_level)} · On open POs <b>{fmt(item.pending)}</b></p>
          <div className="grid grid-cols-5 gap-2">{[['7 days', 'd7'], ['15 days', 'd15'], ['30 days', 'd30'], ['60 days', 'd60'], ['90 days', 'd90']].map(([l, k]) => <Card key={k} k={`Sold ${l}`} v={fmt(item.sales[k])} />)}</div>
          <p className="text-xs text-slate-500">Average {item.avg} a day (last 30 days)</p>
          <Table rows={item.trend} cols={[['Week', r => r.wk], ['Sold', r => fmt(r.q), 'text-right']]} empty="No sales in the last 8 weeks." />
          <Table rows={item.purchases} cols={[['Last purchases', r => dmy(r.invoice_date)], ['Supplier', r => r.supplier], ['Qty', r => fmt(r.qty), 'text-right'], ['Rate', r => inr(r.price), 'text-right']]} empty="No purchases yet." />
        </div>}
      </Modal>
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────
export function ReorderReports() {
  const o = useOpts();
  const [key, setKey] = useState('supplier_reorder');
  const [f, setF] = useState({ from_date: '', to_date: '', supplier_id: '', outlet_id: '' });
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api.get(`/reorder/reports/${key}`, { params: clean(f) }).then(r => setD(r.data)).catch(err); }, [key, f]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const money = (v: any) => (typeof v === 'number' ? fmt(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? dmy(v) : v ?? '—');
  return (
    <div className="p-4 max-w-[1500px] mx-auto">
      <Title icon="fa-chart-pie" title="Reorder Reports" sub={d ? `${d.title} · ${dmy(d.from)} to ${dmy(d.to)}` : 'Loading…'}>
        <button className={btnSec} onClick={() => download(`/reorder/reports/${key}/export`, f, `${key}.xlsx`)}><i className="fas fa-file-excel mr-1" />Export</button>
      </Title>
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={sel} value={key} onChange={e => setKey(e.target.value)} aria-label="Report">{Object.entries(d?.titles || { supplier_reorder: 'Supplier-wise Reorder' }).map(([k, t]) => <option key={k} value={k}>{t as string}</option>)}</select>
        <input type="date" className={sel} value={f.from_date} onChange={set('from_date')} aria-label="From" /><input type="date" className={sel} value={f.to_date} onChange={set('to_date')} aria-label="To" />
        <SupplierSelect o={o} value={f.supplier_id} onChange={(v: string) => setF({ ...f, supplier_id: v })} />
        <select className={sel} value={f.outlet_id} onChange={set('outlet_id')} aria-label="Location"><option value="">All my locations</option>{o.outlets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
      {d && <Table rows={d.rows.map((r: any[], i: number) => Object.assign([...r], { id: i }))} cols={d.head.map((h: string, i: number) => [h, (r: any[]) => money(r[i])])} empty="Nothing in this report." />}
    </div>
  );
}
