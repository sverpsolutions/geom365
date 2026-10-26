import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { products_api, type product_search_item } from '../../api/products';

export const err = (e: any) => toast.error(e?.response?.data?.detail?.toString?.() || 'Something went wrong');
export const inp = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300';
export const btn = 'px-3 py-1.5 rounded-md text-xs font-semibold';
export const btnPri = `${btn} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`;
export const btnSec = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${value === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', SUPERSEDED: 'bg-slate-200 text-slate-600',
  INACTIVE: 'bg-rose-100 text-rose-700', PENDING: 'bg-amber-100 text-amber-800', REJECTED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-200 text-slate-600',
};
export const Badge = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATUS[s] || 'bg-slate-100'}`}>{s}</span>;

export function Table({ cols, rows, empty = 'Nothing here yet.' }: { cols: [string, (r: any) => any, string?][]; rows: any[]; empty?: string }) {
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>{cols.map(([h, , cls]) => <th key={h} className={`px-3 py-2 text-left font-semibold ${cls || ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-400">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="border-t border-slate-100 hover:bg-slate-50">
              {cols.map(([h, f, cls]) => <td key={h} className={`px-3 py-2 ${cls || ''}`}>{f(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Type-ahead item picker over /products/search. */
export function ItemPicker({ value, label, onPick }: { value?: number | null; label?: string; onPick: (p: product_search_item | null) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<product_search_item[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => products_api.search(q, 15).then((r) => setRes(r.data)).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="flex items-center gap-2 border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-slate-50">
      <span className="flex-1 truncate">{label || `Item #${value}`}</span>
      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => onPick(null)}><i className="fas fa-times" /></button>
    </div>
  );
  return (
    <div className="relative">
      <input className={inp} placeholder="Search item name / code…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-auto bg-white border border-slate-200 rounded-md shadow-lg">
          {res.map((p) => (
            <button type="button" key={p.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50"
              onClick={() => { onPick(p); setQ(''); setRes([]); }}>
              <span className="font-mono text-xs text-slate-500 mr-2">{p.item_code || p.id}</span>{p.name} <span className="text-slate-400">({p.unit})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const useList = <T,>(url: string, params?: any): [T[], () => void] => {
  const [rows, setRows] = useState<T[]>([]);
  const key = JSON.stringify(params || {});
  const load = () => { api.get(url, { params }).then((r) => setRows(r.data)).catch(err); };
  useEffect(load, [url, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [rows, load];
};

export const fmt = (n: any) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
