// Wholesale billing (from NCG / Gupta Bros): GST bills to wholesale customers, franchise outlets and cleared suppliers, with e-invoice, e-way bill, receipts and party ledger.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api from '../../api/axios';
import { products_api, type product_search_item } from '../../api/products';
import Modal from '../../components/ui/Modal';
import { Table, btnPri, btnSec, err, fmt, inp } from '../manufacturing/mfgShared';

const inr = (v: any) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dt = (v?: string | null) => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const sel = `${inp} !w-auto`;
const num = `${inp} text-right`;
const KIND: Record<string, [string, string]> = { customer: ['Customer', 'bg-slate-100 text-slate-700'], franchise: ['Franchise', 'bg-violet-100 text-violet-700'], supplier: ['Supplier', 'bg-amber-100 text-amber-800'] };
const Kind = ({ k }: { k: string }) => <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${KIND[k]?.[1]}`}>{KIND[k]?.[0]}</span>;

function fyStart(today: string) {
  const [y, m] = today.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}
const todayIst = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

const Title = ({ icon, title, sub, children }: any) => (
  <div className="flex flex-wrap items-start justify-between gap-2 mb-3 print:hidden">
    <div>
      <h1 className="text-xl font-bold text-slate-800"><i className={`fas ${icon} text-indigo-600 mr-2`} />{title}</h1>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
const Field = ({ label, children, className = '' }: any) => <label className={`block ${className}`}><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>;
const showError = (e: any) => { const d = e?.response?.data?.detail; if (typeof d === 'string' && d.includes('\n')) toast.error(d, { duration: 9000, style: { whiteSpace: 'pre-line', maxWidth: 520 } }); else err(e); };

const eiChip = (r: any) => {
  if (r.einvoice_status === 'generated') return <span className="text-emerald-700 font-semibold text-xs"><i className="fas fa-check-circle mr-1" />IRN{r.einvoice_sandbox ? ' (test)' : ''}</span>;
  if (r.einvoice_status === 'cancelled') return <span className="text-red-600 text-xs">IRN cancelled</span>;
  return (r.gst_number || '').trim().length === 15 && r.status !== 'cancelled' ? <span className="text-amber-700 text-xs">Pending</span> : <span className="text-slate-400 text-xs">—</span>;
};
const stChip: Record<string, string> = { paid: 'bg-emerald-100 text-emerald-700', partial: 'bg-amber-100 text-amber-800', unpaid: 'bg-red-100 text-red-700', cancelled: 'bg-slate-200 text-slate-600' };
const St = ({ s }: { s: string }) => <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${stChip[s] || 'bg-slate-100'}`}>{s}</span>;

/* ── Bills ── */
export function WholesaleBills() {
  const today = todayIst();
  const [f, setF] = useState({ from_date: today.slice(0, 8) + '01', to_date: today, q: '', kind: '', einvoice: '', status: '' });
  const [data, setData] = useState<any>({ rows: [], totals: {} });
  const load = () => api.get('/wholesale', { params: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).then(r => setData(r.data)).catch(err);
  useEffect(() => { load(); }, [f.from_date, f.to_date, f.kind, f.einvoice, f.status]);
  const set = (k: string) => (e: any) => setF(x => ({ ...x, [k]: e.target.value }));
  const t = data.totals;
  return (
    <div className="p-4">
      <Title icon="fa-file-invoice-dollar" title="Wholesale Bills" sub="GST bills to wholesale customers, franchise outlets and suppliers">
        <Link to="/wholesale/new" className={btnPri}><i className="fas fa-plus mr-1" />New Wholesale Bill</Link>
      </Title>
      <div className="flex flex-wrap gap-2 mb-3 items-end bg-white border border-slate-200 rounded-lg p-3">
        <Field label="From"><input type="date" className={inp} value={f.from_date} onChange={set('from_date')} /></Field>
        <Field label="To"><input type="date" className={inp} value={f.to_date} onChange={set('to_date')} /></Field>
        <Field label="Party type"><select className={sel} value={f.kind} onChange={set('kind')}><option value="">All</option><option value="customer">Customer</option><option value="franchise">Franchise</option><option value="supplier">Supplier</option></select></Field>
        <Field label="E-Invoice"><select className={sel} value={f.einvoice} onChange={set('einvoice')}><option value="">All</option><option value="pending">Pending</option><option value="generated">Generated</option><option value="cancelled">Cancelled</option></select></Field>
        <Field label="Status"><select className={sel} value={f.status} onChange={set('status')}><option value="">All</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></Field>
        <Field label="Search" className="flex-1 min-w-[180px]"><input className={inp} placeholder="Bill no, party or GSTIN" value={f.q} onChange={set('q')} onKeyDown={e => e.key === 'Enter' && load()} /></Field>
        <button className={btnSec} onClick={load}>Search</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        {[['Bills', fmt(t.bills)], ['Taxable', inr(t.taxable)], ['GST', inr(t.gst)], ['Total', inr(t.total)], ['Due', inr(t.due)]].map(([l, v]) => (
          <div key={l} className="bg-white border border-slate-200 rounded-lg p-3"><div className="text-xs text-slate-500">{l}</div><div className="font-bold text-slate-800">{v}</div></div>
        ))}
      </div>
      <Table empty="No wholesale bills for these filters." rows={data.rows} cols={[
        ['Bill No', (r: any) => <Link className="text-indigo-600 font-semibold" to={`/wholesale/${r.id}`}>{r.invoice_no}</Link>],
        ['Date', (r: any) => dmy(r.invoice_date)],
        ['Party', (r: any) => <div><div className="font-medium">{r.party} <Kind k={r.kind} /></div><div className="text-[11px] text-slate-400">{r.gst_number || 'No GSTIN'}</div></div>],
        ['Dispatch', (r: any) => r.outlet_name],
        ['Tax', (r: any) => r.is_interstate ? 'IGST' : 'CGST+SGST'],
        ['Total', (r: any) => inr(r.total_amount), 'text-right'],
        ['Due', (r: any) => inr(r.due_amount), 'text-right'],
        ['Status', (r: any) => <St s={r.status} />],
        ['E-Invoice', eiChip],
        ['E-Way', (r: any) => r.ewb_status === 'generated' ? <span className="text-xs text-emerald-700">{r.ewb_no}</span> : <span className="text-slate-400 text-xs">—</span>],
      ]} />
    </div>
  );
}

/** Up / Down moves through a search list, Enter picks the highlighted row. */
function useListKeys<T>(list: T[], pick: (row: T) => void) {
  const [hi, setHi] = useState(0);
  useEffect(() => setHi(0), [list]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => (i + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => (i - 1 + list.length) % list.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[Math.min(hi, list.length - 1)]); }
  };
  const rowProps = (i: number) => ({
    onMouseEnter: () => setHi(i),
    ref: i === hi ? (el: HTMLButtonElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined,
  });
  return { hi, onKeyDown, rowProps };
}

/* ── Party picker ── */
function PartyPicker({ kind, onPick, autoFocus }: { kind?: string; onPick: (p: any) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(''), [hits, setHits] = useState<any[]>([]), [open, setOpen] = useState(false);
  const choose = (p: any) => { onPick(p); setQ(''); setOpen(false); };
  const keys = useListKeys(open ? hits : [], choose);
  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => api.get('/wholesale/parties', { params: { q: q.trim(), kind: kind || undefined } }).then(r => setHits(r.data)).catch(err), 200);
    return () => clearTimeout(h);
  }, [q, kind, open]);
  return (
    <div className="relative">
      <input autoFocus={autoFocus} className={inp} placeholder="Search customer, franchise outlet or supplier" value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={e => setQ(e.target.value)} onKeyDown={keys.onKeyDown} />
      {open && (
        <div className="absolute z-30 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {hits.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No party found. Franchise outlets need Store Type = Franchise; suppliers need "Allow wholesale bill".</div>}
          {hits.map((p, i) => (
            <button key={p.kind + p.id} type="button" {...keys.rowProps(i)} onMouseDown={() => choose(p)} className={`block w-full text-left px-3 py-1.5 border-b border-slate-100 text-sm ${i === keys.hi ? 'bg-indigo-100' : ''}`}>
              {p.name} <Kind k={p.kind} /> <span className="text-[11px] text-slate-400 ml-1">{p.gst_number || 'No GSTIN'}{p.city ? ` · ${p.city}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Line = { product_id: number; name: string; code: string | null; unit: string; hsn: string; gst: number; stock: number; qty: string; rate: string; disc: string };
const emptyShip = { ship_to_different: false, ship_name: '', ship_gstin: '', ship_address: '', ship_place: '', ship_pincode: '', ship_state_code: '' };

function ShipFields({ ship, setShip, states }: any) {
  const s = (k: string) => (e: any) => setShip((x: any) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <Field label="Name *"><input className={inp} maxLength={100} value={ship.ship_name} onChange={s('ship_name')} /></Field>
      <Field label="GSTIN (if any)"><input className={inp} maxLength={15} value={ship.ship_gstin} onChange={e => setShip((x: any) => ({ ...x, ship_gstin: e.target.value.toUpperCase() }))} /></Field>
      <Field label="State *"><select className={inp} value={ship.ship_state_code} onChange={s('ship_state_code')}><option value="">Select</option>{states.map((x: any) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}</select></Field>
      <Field label="Address *" className="md:col-span-3"><input className={inp} maxLength={200} value={ship.ship_address} onChange={s('ship_address')} /></Field>
      <Field label="City / place *"><input className={inp} maxLength={100} value={ship.ship_place} onChange={s('ship_place')} /></Field>
      <Field label="PIN code *"><input className={inp} maxLength={6} inputMode="numeric" value={ship.ship_pincode} onChange={s('ship_pincode')} /></Field>
    </div>
  );
}

/* ── New bill ── */
export function WholesaleNew() {
  const nav = useNavigate();
  const [o, setO] = useState<any>({ stores: [], payment_modes: [], states: [] });
  const [party, setParty] = useState<any>(null);
  const [outlet, setOutlet] = useState<number | ''>('');
  const [date, setDate] = useState(todayIst());
  const [mode, setMode] = useState('credit');
  const [incl, setIncl] = useState(true);
  const [notes, setNotes] = useState('');
  const [approval, setApproval] = useState('');
  const [ship, setShip] = useState(emptyShip);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState(''), [hits, setHits] = useState<product_search_item[]>([]);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.get('/wholesale/options').then(r => { setO(r.data); if (r.data.stores.length === 1) setOutlet(r.data.stores[0].id); setDate(r.data.today); }).catch(err); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(() => products_api.search(q.trim(), 20, outlet || undefined).then(r => setHits(r.data)).catch(() => {}), 220);
    return () => clearTimeout(h);
  }, [q, outlet]);

  function add(p: product_search_item) {
    const rate = Number(p.wsp) > 0 ? Number(p.wsp) : Number(p.selling_price);
    setLines(ls => ls.some(l => l.product_id === p.id) ? ls.map(l => l.product_id === p.id ? { ...l, qty: String(Number(l.qty) + 1) } : l)
      : [...ls, { product_id: p.id, name: p.name, code: p.item_code, unit: p.unit, hsn: p.hsn_code || '', gst: Number(p.gst_percent || 0), stock: Number(p.stock_qty || 0), qty: '1', rate: String(rate), disc: '0' }]);
    setQ(''); setHits([]); searchRef.current?.focus();
  }
  const itemKeys = useListKeys(hits, add);
  const edit = (i: number, k: 'qty' | 'rate' | 'disc', v: string) => setLines(ls => ls.map((l, n) => n === i ? { ...l, [k]: v } : l));

  const totals = useMemo(() => {
    let taxable = 0, gst = 0;
    const rows = lines.map(l => {
      const g = l.gst, r = Number(l.rate) || 0, ex = incl ? r / (1 + g / 100) : r;
      const tx = +(Number(l.qty || 0) * ex * (1 - (Number(l.disc) || 0) / 100)).toFixed(2), t = +(tx * g / 100).toFixed(2);
      taxable += tx; gst += t; return tx + t;
    });
    const raw = taxable + gst, total = Math.round(raw);
    return { taxable, gst, round: total - raw, total, rows };
  }, [lines, incl]);

  async function save() {
    if (!party) return toast.error('Choose the party');
    if (!outlet) return toast.error('Choose the dispatch store');
    if (!lines.length) return toast.error('Add at least one item');
    if (lines.some(l => !(Number(l.qty) > 0))) return toast.error('Every item needs a quantity');
    setBusy(true);
    try {
      const r = await api.post('/wholesale', {
        party_type: party.kind, party_id: party.id, outlet_id: outlet, invoice_date: date, rates_incl_gst: incl, payment_mode: mode, notes: notes.trim() || undefined,
        discount_approval_no: approval.trim() || undefined, ...(ship.ship_to_different ? ship : { ship_to_different: false }),
        items: lines.map(l => ({ product_id: l.product_id, qty: Number(l.qty), rate: Number(l.rate) || 0, disc_pct: Number(l.disc) || 0 })),
      });
      toast.success(`Saved ${r.data.invoice_no}`);
      nav(`/wholesale/${r.data.id}`);
    } catch (e) { showError(e); } finally { setBusy(false); }
  }

  return (
    <div className="p-4">
      <Title icon="fa-plus-circle" title="New Wholesale Bill" sub="IGST or CGST+SGST is set automatically from the seller GSTIN and place of supply">
        <Link to="/wholesale" className={btnSec}>Back to bills</Link>
      </Title>
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Bill to *" className="md:col-span-2">
          {party ? (
            <div className="flex items-start justify-between border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <div>
                <div className="font-semibold">{party.name} <Kind k={party.kind} /></div>
                <div className="text-[11px] text-slate-500">{party.gst_number || 'No GSTIN: normal tax bill, no e-invoice'}{party.city ? ` · ${party.city}` : ''}{party.pincode ? ` ${party.pincode}` : ''}</div>
              </div>
              <button type="button" aria-label="Change party" className="text-slate-400 hover:text-red-600 px-1" onClick={() => setParty(null)}><i className="fas fa-times" /></button>
            </div>
          ) : <PartyPicker onPick={setParty} autoFocus />}
        </Field>
        <Field label="Dispatch from *"><select className={inp} value={outlet} onChange={e => setOutlet(Number(e.target.value) || '')}><option value="">Select store</option>{o.stores.map((s: any) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}</select></Field>
        <Field label="Bill date *"><input type="date" className={inp} max={o.today} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Payment"><select className={inp} value={mode} onChange={e => setMode(e.target.value)}><option value="credit">Credit</option>{o.payment_modes.map((m: any) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
        <Field label="Rates entered"><select className={inp} value={incl ? '1' : '0'} onChange={e => setIncl(e.target.value === '1')}><option value="1">Including GST</option><option value="0">Excluding GST</option></select></Field>
        <Field label="Notes / customer PO" className="md:col-span-2"><input className={inp} maxLength={250} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3">
        <div className="relative mb-2">
          <input ref={searchRef} className={inp} placeholder="Search item by name, code or barcode. Up / Down to choose, Enter to add" value={q} onChange={e => setQ(e.target.value)} onKeyDown={itemKeys.onKeyDown} />
          {hits.length > 0 && (
            <div className="absolute z-30 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
              {hits.map((p, i) => <button key={p.id} type="button" {...itemKeys.rowProps(i)} onClick={() => add(p)} className={`flex justify-between w-full text-left px-3 py-1.5 border-b border-slate-100 text-sm ${i === itemKeys.hi ? 'bg-indigo-100' : ''}`}><span>{p.name} <span className="text-[11px] text-slate-400">{p.item_code}</span></span><span className="text-[11px] text-slate-500">Stock {fmt(p.stock_qty)} · WSP {inr(p.wsp)} · MRP {inr(p.mrp)}</span></button>)}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr>{['Item', 'HSN', 'Stock', 'Qty', `Rate (${incl ? 'incl' : 'excl'} GST)`, 'Disc %', 'GST %', 'Amount', ''].map(h => <th key={h} className="px-2 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-6">Search above to add items.</td></tr>}
              {lines.map((l, i) => (
                <tr key={l.product_id} className="border-t border-slate-100">
                  <td className="px-2 py-1"><div className="font-medium">{l.name}</div><div className="text-[11px] text-slate-400">{l.code} · {l.unit}</div></td>
                  <td className={`px-2 py-1 text-xs ${/^(\d{4}|\d{6}|\d{8})$/.test(l.hsn) ? '' : 'text-red-600 font-semibold'}`}>{l.hsn || 'Missing'}</td>
                  <td className={`px-2 py-1 text-xs ${l.stock < Number(l.qty) ? 'text-red-600 font-semibold' : ''}`}>{fmt(l.stock)}</td>
                  <td className="px-2 py-1 w-24"><input aria-label={`Quantity of ${l.name}`} type="number" min="0" step="any" className={num} value={l.qty} onChange={e => edit(i, 'qty', e.target.value)} /></td>
                  <td className="px-2 py-1 w-28"><input aria-label={`Rate of ${l.name}`} type="number" min="0" step="any" className={num} value={l.rate} onChange={e => edit(i, 'rate', e.target.value)} /></td>
                  <td className="px-2 py-1 w-20"><input aria-label={`Discount on ${l.name}`} type="number" min="0" max="99" step="any" className={num} value={l.disc} onChange={e => edit(i, 'disc', e.target.value)} /></td>
                  <td className="px-2 py-1 text-right">{l.gst}</td>
                  <td className="px-2 py-1 text-right font-semibold">{inr(totals.rows[i])}</td>
                  <td className="px-2 py-1"><button type="button" aria-label={`Remove ${l.name}`} className="text-slate-400 hover:text-red-600" onClick={() => setLines(ls => ls.filter((_, n) => n !== i))}><i className="fas fa-trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 bg-white border border-slate-200 rounded-lg p-3">
          <label className="flex items-center gap-2 text-sm font-semibold mb-2"><input type="checkbox" checked={ship.ship_to_different} onChange={e => setShip(s => ({ ...s, ship_to_different: e.target.checked }))} />Deliver to a different address</label>
          {ship.ship_to_different && <ShipFields ship={ship} setShip={setShip} states={o.states} />}
          <Field label="High-discount approval no (only if asked)" className="max-w-xs mt-2"><input className={inp} value={approval} onChange={e => setApproval(e.target.value)} /></Field>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Taxable</span><span>{inr(totals.taxable)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>{inr(totals.gst)}</span></div>
          <div className="flex justify-between"><span>Round off</span><span>{inr(totals.round)}</span></div>
          <div className="flex justify-between text-lg font-bold border-t pt-1"><span>Total</span><span>{inr(totals.total)}</span></div>
          <button className={`${btnPri} w-full !py-2 mt-2`} disabled={busy} onClick={save}><i className="fas fa-save mr-1" />{busy ? 'Saving…' : 'Save Bill'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Amount in words ── */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
function words(v: any) {
  let n = Math.floor(Number(v || 0));
  if (!n) return 'Zero Rupees Only';
  const out: string[] = [];
  for (const [d, w] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']] as [number, string][]) {
    const q = Math.floor(n / d);
    if (q) { out.push(`${q >= 100 ? words(q).replace(' Rupees Only', '') : two(q)} ${w}`); n %= d; }
  }
  if (n) out.push(two(n));
  return `${out.join(' ')} Rupees Only`;
}

/* ── Bill sheet (screen + print) ── */
function Sheet({ d }: { d: any }) {
  const { bill: b, items, company: c, party: p, outlet: o } = d;
  const hsn = useMemo(() => {
    const m: Record<string, any> = {};
    for (const i of items) {
      const k = `${i.hsn_code || '—'}|${i.gst_percent}`;
      m[k] ||= { hsn: i.hsn_code || '—', rate: i.gst_percent, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      m[k].taxable += +i.taxable_amt; m[k].cgst += +i.cgst_amount; m[k].sgst += +i.sgst_amount; m[k].igst += +i.igst_amount;
    }
    return Object.values(m);
  }, [items]);
  const th = 'border border-slate-400 px-1 py-0.5 text-left bg-slate-100', td = 'border border-slate-400 px-1 py-0.5', tr = `${td} text-right`;
  const hasIrn = b.einvoice_status === 'generated';
  return (
    <div id="wh-sheet" className="relative bg-white border border-slate-300 p-5 text-[11px] text-black max-w-[210mm] mx-auto">
      {b.status === 'cancelled' && <div className="absolute inset-0 flex items-center justify-center text-7xl font-black text-red-500/20 -rotate-[30deg] pointer-events-none">CANCELLED</div>}
      <div className="flex justify-between gap-3 border-b-2 border-black pb-2">
        <div className="flex gap-3">
          {c.logo_path && <img src={c.logo_path} alt="" className="max-h-14 max-w-[110px] object-contain" />}
          <div>
            <div className="text-lg font-bold">{c.legal_name || c.brand_name}</div>
            <div>{o.address}{o.city ? `, ${o.city}` : ''}{o.pincode ? ` - ${o.pincode}` : ''}</div>
            <div>{c.ho_phone ? `Ph: ${c.ho_phone}` : ''}{c.ho_email ? ` | ${c.ho_email}` : ''}</div>
            <div><b>GSTIN: {d.seller_gstin}</b>{c.company_pan ? ` | PAN: ${c.company_pan}` : ''}{c.fssai_no ? ` | FSSAI: ${c.fssai_no}` : ''}</div>
          </div>
        </div>
        <div className="text-right"><div className="text-base font-bold">TAX INVOICE</div><div>{b.is_interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</div><div>Original for Recipient</div></div>
      </div>

      {hasIrn && (
        <div className="flex justify-between gap-3 border-b border-black py-2">
          <div className="break-all">
            {b.einvoice_sandbox && <div className="font-bold text-red-600">TEST E-INVOICE (SANDBOX): NOT VALID FOR GST</div>}
            <div><b>IRN:</b> {b.einvoice_irn}</div>
            <div><b>Ack No:</b> {b.einvoice_ack_no} &nbsp; <b>Ack Date:</b> {dt(b.einvoice_ack_date)}</div>
            {b.ewb_status === 'generated' && <div><b>E-Way Bill:</b> {b.ewb_no} &nbsp; <b>Valid till:</b> {dt(b.ewb_valid_until)}{b.vehicle_no ? ` | Vehicle ${b.vehicle_no}` : ''}</div>}
          </div>
          {b.einvoice_qr_data && <QRCodeSVG value={b.einvoice_qr_data} size={104} level="L" className="shrink-0" />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-b border-black py-2">
        <div>
          <div className="font-bold">Bill To</div>
          <div className="font-semibold">{p.name}</div>
          <div>{p.address}</div><div>{p.city} {p.state} {p.pincode}</div>
          <div><b>GSTIN:</b> {p.gst_number || 'Unregistered'}</div>
          {b.ship_to_different && <div className="mt-1"><div className="font-bold">Ship To</div><div>{b.ship_name}</div><div>{b.ship_address}, {b.ship_place} {b.ship_pincode}</div>{b.ship_gstin && <div>GSTIN: {b.ship_gstin}</div>}</div>}
        </div>
        <div>
          <div><b>Bill No:</b> {b.invoice_no}</div><div><b>Date:</b> {dmy(b.invoice_date)}</div>
          <div><b>Place of Supply:</b> {d.place_of_supply_name} ({d.place_of_supply})</div>
          <div><b>Payment:</b> {b.payment_mode}{p.credit_days ? ` (${p.credit_days} days)` : ''}</div>
          {b.notes && <div><b>Notes:</b> {b.notes}</div>}
        </div>
      </div>

      <table className="w-full border-collapse mt-2">
        <thead><tr>{['#', 'Item', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc', 'Taxable', 'GST %', 'GST', 'Total'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {items.map((i: any, n: number) => (
            <tr key={i.id}><td className={td}>{n + 1}</td><td className={td}>{i.name}{i.batch_no ? ` (${i.batch_no})` : ''}</td><td className={td}>{i.hsn_code}</td><td className={tr}>{fmt(i.qty)}</td><td className={td}>{i.unit}</td>
              <td className={tr}>{Number(i.rate).toFixed(2)}</td><td className={tr}>{+i.disc_val ? `${+i.disc_val}${i.disc_type === '%' ? '%' : ''}` : ''}</td><td className={tr}>{Number(i.taxable_amt).toFixed(2)}</td>
              <td className={tr}>{+i.gst_percent}</td><td className={tr}>{(+i.cgst_amount + +i.sgst_amount + +i.igst_amount).toFixed(2)}</td><td className={tr}>{Number(i.total).toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-between gap-3 mt-2">
        <table className="border-collapse self-start">
          <thead><tr>{['HSN', 'Taxable', 'Rate', ...(b.is_interstate ? ['IGST'] : ['CGST', 'SGST'])].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{hsn.map((h: any) => <tr key={h.hsn + h.rate}><td className={td}>{h.hsn}</td><td className={tr}>{h.taxable.toFixed(2)}</td><td className={tr}>{+h.rate}%</td>{b.is_interstate ? <td className={tr}>{h.igst.toFixed(2)}</td> : <><td className={tr}>{h.cgst.toFixed(2)}</td><td className={tr}>{h.sgst.toFixed(2)}</td></>}</tr>)}</tbody>
        </table>
        <table className="border-collapse w-56 self-start">
          <tbody>
            <tr><td className={td}>Taxable</td><td className={tr}>{Number(b.taxable_amount).toFixed(2)}</td></tr>
            {b.is_interstate ? <tr><td className={td}>IGST</td><td className={tr}>{Number(b.igst_amount).toFixed(2)}</td></tr> : <><tr><td className={td}>CGST</td><td className={tr}>{Number(b.cgst_amount).toFixed(2)}</td></tr><tr><td className={td}>SGST</td><td className={tr}>{Number(b.sgst_amount).toFixed(2)}</td></tr></>}
            <tr><td className={td}>Round off</td><td className={tr}>{Number(b.round_off).toFixed(2)}</td></tr>
            <tr className="font-bold"><td className={td}>Total</td><td className={tr}>{inr(b.total_amount)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2"><b>In words:</b> {words(b.total_amount)}</div>
      <div className="flex justify-between gap-3 mt-3 border-t border-black pt-2">
        <div className="max-w-[60%]">
          {c.bank_account_no && <div><b>Bank:</b> {c.bank_account_name || c.legal_name}, {c.bank_name}, A/c {c.bank_account_no}, IFSC {c.bank_ifsc}{c.upi_id ? `, UPI ${c.upi_id}` : ''}</div>}
          <div className="whitespace-pre-line mt-1">{c.invoice_terms || 'Goods once sold will not be taken back.'}</div>
        </div>
        <div className="text-center"><div className="font-semibold">For {c.legal_name || c.brand_name}</div><div className="h-10" /><div className="border-t border-dotted border-black px-4">{c.authorized_signatory || 'Authorised Signatory'}</div></div>
      </div>
      {c.invoice_footer && <div className="text-center mt-2">{c.invoice_footer}</div>}
    </div>
  );
}

const PRINT = '@media print { body * { visibility: hidden !important; } #wh-sheet, #wh-sheet *, #wh-ledger, #wh-ledger * { visibility: visible !important; } #wh-sheet, #wh-ledger { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: 0; } @page { size: A4; margin: 8mm; } }';

/* ── Bill view ── */
export function WholesaleView() {
  const { id } = useParams();
  const [d, setD] = useState<any>(null);
  const [o, setO] = useState<any>({ payment_modes: [], states: [] });
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState<null | 'ewb' | 'pay' | 'ship' | 'cancel' | 'irn-x' | 'ewb-x'>(null);
  const [ship, setShip] = useState(emptyShip);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({ amount: '', payment_date: todayIst(), payment_mode: 'cash', reference_no: '' });
  const [t, setT] = useState({ transport_mode: '1', vehicle_no: '', vehicle_type: 'R', transporter_id: '', transporter_name: '', transport_doc_no: '', transport_doc_date: '', transport_distance: '0' });
  const load = () => api.get(`/wholesale/${id}`).then(r => setD(r.data)).catch(err);
  useEffect(() => { load(); api.get('/wholesale/options').then(r => setO(r.data)).catch(err); }, [id]);

  async function act(path: string, body?: any) {
    setBusy(true);
    try {
      const r = await api.post(`/wholesale/${id}/${path}`, body);
      toast.success(r.data.message || 'Done');
      setPop(null); setReason('');
      await load();
    } catch (e) { showError(e); await load(); } finally { setBusy(false); }
  }
  if (!d) return <div className="p-8 text-center text-slate-400">Loading…</div>;
  const b = d.bill, active = b.status !== 'cancelled', irn = b.einvoice_status === 'generated', ewb = b.ewb_status === 'generated';
  const gst = (d.party.gst_number || '').trim().length === 15;
  const reasonPop = pop === 'cancel' || pop === 'irn-x' || pop === 'ewb-x';
  const reasonGo = () => act(pop === 'cancel' ? 'cancel' : pop === 'irn-x' ? 'irn/cancel' : 'ewb/cancel', { reason });
  const stt = (k: string) => (e: any) => setT(x => ({ ...x, [k]: e.target.value }));
  return (
    <div className="p-4">
      <style>{PRINT}</style>
      <Title icon="fa-file-invoice" title={`Bill ${b.invoice_no}`} sub={`${d.party.name} · ${dmy(b.invoice_date)}`}>
        <Link to="/wholesale" className={btnSec}>Back</Link>
        <button className={btnSec} onClick={() => window.print()}><i className="fas fa-print mr-1" />Print</button>
        {active && +b.due_amount > 0 && <button className={btnPri} onClick={() => { setPay(p => ({ ...p, amount: String(b.due_amount) })); setPop('pay'); }}><i className="fas fa-rupee-sign mr-1" />Receive Payment</button>}
        {active && !irn && !ewb && <button className={btnSec} onClick={() => { setShip({ ...emptyShip, ...Object.fromEntries(Object.keys(emptyShip).map(k => [k, b[k] ?? (k === 'ship_to_different' ? false : '')])) } as any); setPop('ship'); }}>Delivery Address</button>}
        {active && !irn && <button className="px-3 py-1.5 rounded-md text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50" onClick={() => setPop('cancel')}>Cancel Bill</button>}
      </Title>

      {active && gst && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm text-slate-700 mr-2">E-Invoice &amp; E-Way Bill</span>
            {d.sandbox && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold">Sandbox mode: test only</span>}
            {!irn && <button className={btnPri} disabled={busy || !d.can_einvoice} onClick={() => act('irn')}><i className="fas fa-bolt mr-1" />{busy ? 'Sending…' : b.einvoice_status === 'cancelled' ? 'Generate Again' : 'Generate E-Invoice'}</button>}
            {irn && b.einvoice_sandbox && !d.sandbox && <button className={btnPri} disabled={busy} onClick={() => act('irn')}>Generate Real E-Invoice</button>}
            {irn && !ewb && <button className={btnPri} disabled={busy} onClick={() => setPop('ewb')}><i className="fas fa-truck mr-1" />Generate E-Way Bill</button>}
            {irn && <button className={btnSec} disabled={busy} onClick={() => act('irn/recheck')}>Check with Portal</button>}
            {ewb && <button className={btnSec} disabled={busy} onClick={() => setPop('ewb-x')}>Cancel E-Way Bill</button>}
            {irn && !ewb && <button className={btnSec} disabled={busy} onClick={() => setPop('irn-x')}>Cancel E-Invoice</button>}
          </div>
          {!d.has_token && <p className="text-xs text-red-600 mt-2">The GSTZen token is not set. Add it in <Link className="underline" to="/wholesale/settings">E-Invoice Settings</Link>.</p>}
          {!d.can_einvoice && d.problems.length > 0 && <ul className="text-xs text-red-600 mt-2 list-disc ml-4">{d.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 print:hidden">
        {[['Total', inr(b.total_amount)], ['Received', inr(b.paid_amount)], ['Due', inr(b.due_amount)]].map(([l, v]) => <div key={l} className="bg-white border border-slate-200 rounded-lg p-3"><div className="text-xs text-slate-500">{l}</div><div className="font-bold">{v}</div></div>)}
        <div className="bg-white border border-slate-200 rounded-lg p-3"><div className="text-xs text-slate-500">Status</div><St s={b.status} /> <Kind k={d.party.kind} /></div>
      </div>
      {(d.payments.length > 0 || d.credit_notes.length > 0) && (
        <div className="grid md:grid-cols-2 gap-3 mb-3 print:hidden">
          {d.payments.length > 0 && <Table rows={d.payments} cols={[['Receipt', (r: any) => r.payment_no], ['Date', (r: any) => dmy(r.payment_date)], ['Mode', (r: any) => `${r.payment_mode} ${r.reference_no || ''}`], ['Amount', (r: any) => inr(r.amount), 'text-right']]} />}
          {d.credit_notes.length > 0 && <Table rows={d.credit_notes} cols={[['Credit Note', (r: any) => r.invoice_no], ['Date', (r: any) => dmy(r.invoice_date)], ['Status', (r: any) => r.status], ['Amount', (r: any) => inr(r.total_amount), 'text-right']]} />}
        </div>
      )}
      <Sheet d={d} />

      <Modal open={pop === 'pay'} onClose={() => setPop(null)} title="Receive Payment">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><input type="number" className={num} value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} /></Field>
          <Field label="Date"><input type="date" className={inp} value={pay.payment_date} onChange={e => setPay(p => ({ ...p, payment_date: e.target.value }))} /></Field>
          <Field label="Mode"><select className={inp} value={pay.payment_mode} onChange={e => setPay(p => ({ ...p, payment_mode: e.target.value }))}>{o.payment_modes.map((m: any) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
          <Field label="Reference"><input className={inp} maxLength={50} value={pay.reference_no} onChange={e => setPay(p => ({ ...p, reference_no: e.target.value }))} /></Field>
        </div>
        <div className="text-right mt-3"><button className={btnPri} disabled={busy} onClick={() => act('receipt', { ...pay, amount: Number(pay.amount), reference_no: pay.reference_no || undefined })}>Save Receipt</button></div>
      </Modal>

      <Modal open={pop === 'ewb'} onClose={() => setPop(null)} title="Generate E-Way Bill" width="max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Field label="Transport mode"><select className={inp} value={t.transport_mode} onChange={stt('transport_mode')}><option value="1">Road</option><option value="2">Rail</option><option value="3">Air</option><option value="4">Ship</option></select></Field>
          <Field label="Distance in KM (0 = portal works it out)"><input type="number" min="0" max="4000" className={inp} value={t.transport_distance} onChange={stt('transport_distance')} /></Field>
          <Field label="Vehicle No"><input className={inp} placeholder="HR26AB1234" value={t.vehicle_no} onChange={e => setT(x => ({ ...x, vehicle_no: e.target.value.toUpperCase() }))} /></Field>
          <Field label="Vehicle type"><select className={inp} value={t.vehicle_type} onChange={stt('vehicle_type')}><option value="R">Regular</option><option value="O">Over-dimensional</option></select></Field>
          <Field label="Transporter ID (15 characters)"><input className={inp} maxLength={15} value={t.transporter_id} onChange={e => setT(x => ({ ...x, transporter_id: e.target.value.toUpperCase() }))} /></Field>
          <Field label="Transporter name"><input className={inp} maxLength={100} value={t.transporter_name} onChange={stt('transporter_name')} /></Field>
          <Field label="Transport doc no (Rail / Air / Ship)"><input className={inp} maxLength={30} value={t.transport_doc_no} onChange={stt('transport_doc_no')} /></Field>
          <Field label="Transport doc date"><input type="date" className={inp} value={t.transport_doc_date} onChange={stt('transport_doc_date')} /></Field>
        </div>
        <div className="text-right mt-3"><button className={btnPri} disabled={busy} onClick={() => act('ewb', { ...t, transport_mode: Number(t.transport_mode), transport_distance: Number(t.transport_distance) || 0, transport_doc_date: t.transport_doc_date || undefined })}>{busy ? 'Sending…' : 'Generate'}</button></div>
      </Modal>

      <Modal open={pop === 'ship'} onClose={() => setPop(null)} title="Delivery Address" width="max-w-2xl">
        <label className="flex items-center gap-2 text-sm font-semibold mb-2"><input type="checkbox" checked={ship.ship_to_different} onChange={e => setShip(s => ({ ...s, ship_to_different: e.target.checked }))} />Deliver to a different address</label>
        {ship.ship_to_different && <ShipFields ship={ship} setShip={setShip} states={o.states} />}
        <div className="text-right mt-3"><button className={btnPri} disabled={busy} onClick={async () => { setBusy(true); try { await api.put(`/wholesale/${id}/ship`, ship); toast.success('Saved'); setPop(null); await load(); } catch (e) { showError(e); } finally { setBusy(false); } }}>Save</button></div>
      </Modal>

      <Modal open={reasonPop} onClose={() => setPop(null)} title={pop === 'cancel' ? 'Cancel Bill' : pop === 'irn-x' ? 'Cancel E-Invoice' : 'Cancel E-Way Bill'}>
        <p className="text-sm text-slate-600 mb-2">{pop === 'cancel' ? 'Stock goes back to the store and the bill leaves the ledger.' : 'The GST portal allows this only within 24 hours, and it cannot be undone.'}</p>
        <Field label="Reason (at least 5 letters)"><input className={inp} maxLength={100} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <div className="text-right mt-3"><button className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white disabled:opacity-50" disabled={busy || reason.trim().length < 5} onClick={reasonGo}>Confirm Cancel</button></div>
      </Modal>
    </div>
  );
}

/* ── Ledger ── */
export function WholesaleLedger() {
  const today = todayIst();
  const [party, setParty] = useState<any>(null);
  const [from, setFrom] = useState(fyStart(today)), [to, setTo] = useState(today);
  const [L, setL] = useState<any>(null);
  useEffect(() => {
    if (!party) { setL(null); return; }
    api.get('/wholesale/ledger', { params: { kind: party.kind, party_id: party.id, from_date: from, to_date: to } }).then(r => setL(r.data)).catch(err);
  }, [party, from, to]);
  const receivable = L?.side === 'receivable';
  const side = (v: any) => `${inr(Math.abs(Number(v)))} ${Number(v) === 0 ? '' : (Number(v) > 0) === receivable ? 'Dr' : 'Cr'}`;
  return (
    <div className="p-4">
      <style>{PRINT}</style>
      <Title icon="fa-book" title="Party Ledger" sub="Bills, receipts and credit notes. A supplier's ledger also carries GRNs and payments, so it shows the net position">
        {L && <button className={btnSec} onClick={() => window.print()}><i className="fas fa-print mr-1" />Print</button>}
      </Title>
      <div className="flex flex-wrap gap-2 mb-3 items-end bg-white border border-slate-200 rounded-lg p-3 print:hidden">
        <Field label="Party" className="flex-1 min-w-[260px]">
          {party ? <div className="flex justify-between border border-slate-300 rounded-md px-2 py-1.5 text-sm"><span>{party.name} <Kind k={party.kind} /></span><button type="button" aria-label="Change party" onClick={() => setParty(null)} className="text-slate-400 hover:text-red-600 px-1"><i className="fas fa-times" /></button></div> : <PartyPicker onPick={setParty} autoFocus />}
        </Field>
        <Field label="From"><input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>
      {!L ? <div className="text-center text-slate-400 py-10">Choose a party to see its ledger.</div> : (
        <div id="wh-ledger" className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="font-bold text-slate-800">{party.name}{party.gst_number ? ` · ${party.gst_number}` : ''}</div>
          <div className="text-xs text-slate-500 mb-2">{dmy(from)} to {dmy(to)} · {receivable ? 'Dr = party owes us' : 'Cr = we owe the supplier'}</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr>{['Date', 'Type', 'Ref', 'Detail', 'Debit', 'Credit', 'Balance'].map(h => <th key={h} className={`px-2 py-2 font-semibold ${['Debit', 'Credit', 'Balance'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              <tr className="border-t border-slate-100 font-semibold"><td className="px-2 py-1" colSpan={6}>Opening balance</td><td className="px-2 py-1 text-right">{side(L.opening)}</td></tr>
              {L.lines.map((r: any, i: number) => (
                <tr key={i} className="border-t border-slate-100"><td className="px-2 py-1">{dmy(r.d)}</td><td className="px-2 py-1">{r.type}</td><td className="px-2 py-1">{r.ref}</td><td className="px-2 py-1 text-xs text-slate-500">{r.doc}</td>
                  <td className="px-2 py-1 text-right">{+r.debit ? inr(r.debit) : ''}</td><td className="px-2 py-1 text-right">{+r.credit ? inr(r.credit) : ''}</td><td className="px-2 py-1 text-right">{side(r.balance)}</td></tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-bold"><td className="px-2 py-1" colSpan={6}>Closing balance</td><td className="px-2 py-1 text-right">{side(L.closing)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Settings ── */
export function EinvoiceSettings() {
  const [s, setS] = useState<any>(null);
  const [token, setToken] = useState('');
  const [logs, setLogs] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const logsLoad = () => api.get('/wholesale/logs').then(r => setLogs(r.data)).catch(err);
  useEffect(() => { api.get('/wholesale/settings').then(r => setS(r.data)).catch(err); logsLoad(); }, []);
  if (!s) return <div className="p-8 text-center text-slate-400">Loading…</div>;
  async function save() {
    setBusy(true);
    try { const r = await api.put('/wholesale/settings', { token: token || undefined, sandbox: s.sandbox, sandbox_gstin: s.sandbox_gstin || undefined, prefix: s.prefix }); setS(r.data); setToken(''); toast.success('Saved'); } catch (e) { showError(e); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { const r = await api.post('/wholesale/settings/test'); (r.data.ok ? toast.success : toast.error)(r.data.message, { duration: 7000 }); logsLoad(); } catch (e) { showError(e); } finally { setBusy(false); }
  }
  return (
    <div className="p-4 max-w-5xl">
      <Title icon="fa-plug" title="E-Invoice Settings" sub="GSTZen: one token for both E-Invoice and E-Way Bill" />
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="GSTZen token"><input type="password" autoComplete="new-password" className={inp} value={token} placeholder={s.has_token ? 'Saved. Leave blank to keep it' : 'Paste the token'} onChange={e => setToken(e.target.value)} />
          <span className="text-[11px] text-slate-500">In your GSTZen account: click your GSTIN, then E-Invoicing, then Tally/SAP Integration.</span></Field>
        <Field label="Bill number prefix"><input className={inp} maxLength={8} value={s.prefix} onChange={e => setS({ ...s, prefix: e.target.value.toUpperCase() })} /><span className="text-[11px] text-slate-500">Next series looks like {s.prefix}{s.sample_no.replace(/^.*?(\d{8})$/, '$1')}</span></Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={s.sandbox} onChange={e => setS({ ...s, sandbox: e.target.checked })} /><span><b>Sandbox (test) mode</b><br /><span className="text-xs text-slate-500">Bills go to the government test portal with a demo seller GSTIN. Those IRNs are not valid for GST. Turn off only when the real token is saved.</span></span></label>
        <Field label="Sandbox seller GSTIN (optional)"><input className={inp} maxLength={15} value={s.sandbox_gstin || ''} onChange={e => setS({ ...s, sandbox_gstin: e.target.value.toUpperCase() })} /><span className="text-[11px] text-slate-500">Blank uses GSTZen's demo GSTIN for your state.</span></Field>
        <div className="md:col-span-2 text-sm">Seller GSTIN: <b>{s.company_gstin || 'Not set'}</b> <span className="text-xs text-slate-500">(Company Settings; a store with its own GSTIN in Outlet Master uses that one)</span>
          {s.missing.length > 0 && <div className="text-xs text-red-600">Missing: {s.missing.join(', ')}</div>}</div>
        <div className="md:col-span-2 flex gap-2"><button className={btnPri} disabled={busy} onClick={save}>Save</button><button className={btnSec} disabled={busy} onClick={test}>Test Connection</button></div>
      </div>
      <h2 className="font-bold text-slate-700 mb-2">API log (last 100)</h2>
      <Table empty="No calls yet." rows={logs} cols={[
        ['When', (r: any) => dt(r.created_at)], ['Action', (r: any) => r.action], ['Bill', (r: any) => r.invoice_no || '—'], ['Mode', (r: any) => r.sandbox ? 'Sandbox' : 'Live'],
        ['Result', (r: any) => <span className={r.ok ? 'text-emerald-700' : 'text-red-600'}>{r.message}</span>], ['', (r: any) => <button className="text-indigo-600 text-xs" onClick={() => setOpen(r)}>View</button>],
      ]} />
      <Modal open={!!open} onClose={() => setOpen(null)} title={`${open?.action ?? ''} ${open?.invoice_no ?? ''}`} width="max-w-3xl">
        <pre className="text-[11px] bg-slate-50 p-2 max-h-[60vh] overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ request: open?.request, response: open?.response }, null, 2)}</pre>
      </Modal>
    </div>
  );
}
