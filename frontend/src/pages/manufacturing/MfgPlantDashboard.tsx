import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { Stat, err, fmt } from './mfgShared';

export default function MfgPlantDashboard() {
  const [d, setD] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => {
    const load = () => api.get('/manufacturing/plant-dashboard').then((r) => setD(r.data)).catch(err);
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="p-8 text-slate-500"><i className="fas fa-spinner fa-spin mr-2" />Loading plant dashboard…</div>;
  const c = d.cards, a = d.approvals;
  const go = (to: string) => () => nav(to);
  const section = (title: string, cards: any[]) => (
    <div><h2 className="text-sm font-bold text-slate-600 uppercase mb-2">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">{cards}</div></div>
  );
  return (
    <div className="p-4 max-w-7xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-800"><i className="fas fa-gauge-high text-indigo-600 mr-2" />Plant Dashboard</h1>
      {section('Stores', [
        <Stat key="1" label="Raw material" value={fmt(c.raw_material)} onClick={go('/manufacturing/stores')} />,
        <Stat key="2" label="Packaging material" value={fmt(c.packaging)} onClick={go('/manufacturing/stores')} />,
        <Stat key="3" label="Plain tin" value={fmt(c.plain_tin)} onClick={go('/manufacturing/stores')} />,
        <Stat key="4" label="Printed tin (accepted)" value={fmt(c.printed_tin)} tone="green" onClick={go('/manufacturing/stores')} />,
        <Stat key="5" label="Finished goods" value={fmt(c.finished_goods)} tone="green" onClick={go('/reports/r/mfg_fg_stock')} />,
        <Stat key="6" label="QC / quarantine" value={fmt(c.qc_pending)} tone="amber" />,
      ])}
      {section('Printing', [
        <Stat key="1" label="Printing jobs open" value={c.printing_jobs_open} tone="blue" onClick={go('/manufacturing/printing')} />,
        <Stat key="2" label="Printing WIP (tins)" value={fmt(c.printing_wip)} onClick={go('/reports/r/mfg_wip')} />,
        <Stat key="3" label="Pending from printer" value={fmt(c.printing_pending)} onClick={go('/reports/r/mfg_print_pending')} />,
        <Stat key="4" label="Overdue printing" value={a.overdue_printing} tone={a.overdue_printing ? 'red' : 'slate'} onClick={go('/reports/r/mfg_print_pending')} />,
      ])}
      {section('Production', [
        <Stat key="1" label="Orders pending" value={c.production_pending} onClick={go('/manufacturing/production')} />,
        <Stat key="2" label="In progress" value={c.production_in_progress} tone="blue" onClick={go('/manufacturing/production')} />,
        <Stat key="3" label="Material shortages" value={c.material_shortages} tone={c.material_shortages ? 'red' : 'slate'} onClick={go('/reports/r/mfg_material_req')} />,
        <Stat key="4" label="Production WIP" value={fmt(c.production_wip)} />,
        <Stat key="5" label="Today's good output" value={fmt(c.today_good)} tone="green" onClick={go('/reports/r/mfg_output')} />,
        <Stat key="6" label="Today's efficiency" value={c.today_efficiency == null ? '—' : `${c.today_efficiency}%`} sub={`rejected ${fmt(c.today_rejected)} · damage ${fmt(c.today_damage)}`} />,
        <Stat key="7" label="Today's damage" value={fmt(c.today_damage)} sub={c.today_over_tolerance ? `${c.today_over_tolerance} over tolerance` : undefined}
          tone={c.today_over_tolerance ? 'red' : 'slate'} onClick={go('/reports/r/mfg_damage_register')} />,
        <Stat key="8" label="Rejected / scrap stock" value={`${fmt(c.rejected)} / ${fmt(c.scrap)}`} />,
      ])}
      {section('Customer orders', [
        <Stat key="1" label="Orders pending" value={c.orders_pending} tone="blue" onClick={go('/manufacturing/customer-orders')} />,
        <Stat key="2" label="Ready for billing" value={c.orders_ready_billing} tone="amber" onClick={go('/manufacturing/customer-orders')} />,
        <Stat key="3" label="With billing / dispatch" value={fmt(c.dispatch_store)} />,
        <Stat key="4" label="Overdue orders" value={c.orders_overdue} tone={c.orders_overdue ? 'red' : 'slate'} onClick={go('/reports/r/mfg_pending_orders')} />,
      ])}
      {section('Waiting for approval', [
        <Stat key="1" label="Printing challans" value={a.print_jobs} tone={a.print_jobs ? 'amber' : 'slate'} onClick={go('/manufacturing/printing')} />,
        <Stat key="2" label="Store transfers" value={a.transfers} tone={a.transfers ? 'amber' : 'slate'} onClick={go('/manufacturing/stores')} />,
        <Stat key="3" label="Damage entries" value={a.damages} tone={a.damages ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
        <Stat key="4" label="Production orders" value={a.production_orders} tone={a.production_orders ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
        <Stat key="5" label="Finished goods QC" value={a.fg_qc} tone={a.fg_qc ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
      ])}
    </div>
  );
}
