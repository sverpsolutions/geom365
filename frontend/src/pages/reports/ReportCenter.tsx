import React from 'react';
import { EngineReportList } from './ReportRunner';
import { useNavigate } from 'react-router-dom';

const reports = [
  {
    id: 'sales',
    title: 'Sales Report',
    icon: '📈',
    desc: 'Invoices, GST collected, payments',
    color: 'bg-green-50 text-green-600 group-hover:bg-green-100',
    path: '/reports/sales',
    badge: 'LIVE',
    badgeColor: 'bg-green-500',
  },
  {
    id: 'purchases',
    title: 'Purchase Report',
    icon: '🛒',
    desc: 'All GRNs, GST input, supplier dues',
    color: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    path: '/reports/purchases',
    badge: 'LIVE',
    badgeColor: 'bg-blue-500',
  },
  {
    id: 'stock',
    title: 'Stock Report',
    icon: '📦',
    desc: 'Current inventory QOH & valuation',
    color: 'bg-slate-50 text-slate-600 group-hover:bg-slate-100',
    path: '/reports/stock',
    badge: 'LIVE',
    badgeColor: 'bg-slate-500',
  },
  {
    id: 'profit_loss',
    title: 'Profit & Loss',
    icon: '💰',
    desc: 'Revenue, COGS, gross margin analysis',
    color: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
    path: '/reports/pl',
    badge: 'LIVE',
    badgeColor: 'bg-indigo-500',
  },
  {
    id: 'gst',
    title: 'GST Report',
    icon: '🧾',
    desc: 'GSTR-1 slab-wise: B2B / B2C output tax',
    color: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
    path: '/reports/gst',
    badge: 'LIVE',
    badgeColor: 'bg-orange-500',
  },
  {
    id: 'outstanding',
    title: 'Outstanding Dues',
    icon: '⚠️',
    desc: 'Pending receivables & aging analysis',
    color: 'bg-red-50 text-red-600 group-hover:bg-red-100',
    path: '/reports/outstanding',
    badge: 'LIVE',
    badgeColor: 'bg-red-500',
  },
  {
    id: 'payment_collection',
    title: 'Payment Collection',
    icon: '💳',
    desc: 'Cash, UPI, Card, Wallet mode stats',
    color: 'bg-cyan-50 text-cyan-600 group-hover:bg-cyan-100',
    path: '/reports/payments',
    badge: 'LIVE',
    badgeColor: 'bg-cyan-500',
  },
  {
    id: 'hourly',
    title: 'Hourly Sales Analysis',
    icon: '🕒',
    desc: 'Peak business hour tracking & trends',
    color: 'bg-purple-50 text-purple-600 group-hover:bg-purple-100',
    path: '/reports/hourly',
    badge: 'LIVE',
    badgeColor: 'bg-purple-500',
  },
  {
    id: 'hierarchy',
    title: 'Hierarchy Sales Analysis',
    icon: '📊',
    desc: 'Outlet-wise drill-down comparison',
    color: 'bg-blue-50 text-blue-700 group-hover:bg-blue-100',
    path: '/reports/hierarchy',
    badge: 'LIVE',
    badgeColor: 'bg-blue-600',
  },
  {
    id: 'ledger',
    title: 'Stock Ledger',
    icon: '📓',
    desc: 'Item balance, running stock & valuation',
    color: 'bg-rose-50 text-rose-600 group-hover:bg-rose-100',
    path: '/reports/ledger',
    badge: 'LIVE',
    badgeColor: 'bg-rose-500',
  },
  {
    id: 'stock_as_at',
    title: 'Stock as at Time',
    icon: '⏱️',
    desc: 'Stock on any date at any time, e.g. today 2:10 pm',
    color: 'bg-teal-50 text-teal-600 group-hover:bg-teal-100',
    path: '/reports/stock-as-at',
    badge: 'NEW',
    badgeColor: 'bg-teal-500',
  },
  {
    id: 'channel_margin',
    title: 'Channel Margins',
    icon: '🌐',
    desc: 'Swiggy/Zomato margin & settlement analysis',
    color: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    path: '/reports/channel-margin',
    badge: 'NEW',
    badgeColor: 'bg-blue-500',
  },
  {
    id: 'low_margin',
    title: 'Low Margin Alert',
    icon: '⚠️',
    desc: 'Items falling below target profitability',
    color: 'bg-rose-50 text-rose-600 group-hover:bg-rose-100',
    path: '/reports/low-margin',
    badge: 'CRITICAL',
    badgeColor: 'bg-rose-600',
  },
  {
    id: 'markdown_audit',
    title: 'Markdown Audit',
    icon: '📉',
    desc: 'Tracking MRP-based markdown pricing',
    color: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    path: '/reports/markdown-items',
    badge: 'NEW',
    badgeColor: 'bg-amber-500',
  },
  {
    id: 'unit_dashboard',
    title: 'Unit Dashboard',
    icon: '📊',
    desc: 'Live outlet wise KPIs, trends & top metrics',
    color: 'bg-yellow-50 text-yellow-600 group-hover:bg-yellow-100',
    path: '/reports/unit-dashboard',
    badge: 'LIVE',
    badgeColor: 'bg-yellow-500',
  },
  {
    id: 'sales_trend',
    title: 'Sales Trend Analysis',
    icon: '📈',
    desc: 'Daily, weekly sales trend analysis with charts',
    color: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
    path: '/reports/sales-trend',
    badge: 'LIVE',
    badgeColor: 'bg-emerald-500',
  },
  {
    id: 'top_items',
    title: 'Top Selling Items',
    icon: '🏆',
    desc: 'Top performing products by revenue & qty',
    color: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    path: '/reports/top-items',
    badge: 'LIVE',
    badgeColor: 'bg-amber-500',
  },
  {
    id: 'category_sales',
    title: 'Category-Wise Sales',
    icon: '🏷️',
    desc: 'Doughnut chart analysis of category sales',
    color: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    path: '/reports/category-sales',
    badge: 'LIVE',
    badgeColor: 'bg-blue-500',
  },
  {
    id: 'profitability',
    title: 'Profitability Analysis',
    icon: '🪙',
    desc: 'Drilldown by category/item revenue & margin',
    color: 'bg-green-50 text-green-600 group-hover:bg-green-100',
    path: '/reports/profitability',
    badge: 'LIVE',
    badgeColor: 'bg-green-500',
  },
  {
    id: 'sales_vs_purchase',
    title: 'Sales vs Purchase',
    icon: '⚖️',
    desc: 'Monthly side-by-side sales & GRN comparison',
    color: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
    path: '/reports/sales-vs-purchase',
    badge: 'LIVE',
    badgeColor: 'bg-indigo-500',
  },
  {
    id: 'item_velocity',
    title: 'Item Velocity',
    icon: '⚡',
    desc: 'Fast / Medium / Slow / Dead stock tracking',
    color: 'bg-violet-50 text-violet-600 group-hover:bg-violet-100',
    path: '/reports/item-velocity',
    badge: 'LIVE',
    badgeColor: 'bg-violet-500',
  },
  {
    id: 'customer_analytics',
    title: 'Customer Analytics',
    icon: '👥',
    desc: 'Top customer spends, visits & behavior metrics',
    color: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
    path: '/reports/customer-analytics',
    badge: 'LIVE',
    badgeColor: 'bg-orange-500',
  },
  {
    id: 'tax_breakup',
    title: 'Tax Breakup Report',
    icon: '🧾',
    desc: 'GST tax slab breakdown by outlet & date',
    color: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100',
    path: '/reports/tax-breakup',
    badge: 'NEW',
    badgeColor: 'bg-indigo-500',
  },
  {
    id: 'master_po',
    title: 'Master PO Distribution',
    icon: '🏢',
    desc: 'Multi-outlet purchase order allocations',
    color: 'bg-teal-50 text-teal-600 group-hover:bg-teal-100',
    path: '/reports/master-po',
    badge: 'NEW',
    badgeColor: 'bg-teal-500',
  },
];

const ReportCenter = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-slate-800 text-white p-1 rounded"><i className="fas fa-chart-pie"></i></span>
            Report Center
            <span className="text-[10px] font-black bg-green-500 text-white px-2 py-0.5 rounded-full uppercase tracking-widest">BI</span>
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Business Intelligence · Financial Audits · {reports.length} Reports Active</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-200">
            <i className="fas fa-circle text-green-500 mr-1" style={{ fontSize: '6px' }}></i>
            All Reports Live
          </span>
        </div>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {reports.map((report) => (
          <div
            key={report.id}
            onClick={() => navigate(report.path)}
            className="group bg-white p-5 rounded-xl shadow-sm border border-slate-100 cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-200 flex items-start space-x-4 relative overflow-hidden"
          >
            {/* Active badge */}
            <span className={`absolute top-2 right-2 text-[8px] font-black text-white px-1.5 py-0.5 rounded-full ${report.badgeColor}`}>
              {report.badge}
            </span>
            <div className={`text-3xl p-3 rounded-xl transition-all ${report.color}`}>
              {report.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-slate-800 text-sm mb-0.5 flex items-center pr-6">
                {report.title}
              </h3>
              <p className="text-[10px] text-slate-400 leading-relaxed">{report.desc}</p>
            </div>
            <i className="fas fa-chevron-right absolute bottom-4 right-4 text-slate-200 group-hover:text-slate-400 group-hover:translate-x-1 transition-all text-xs"></i>
          </div>
        ))}
      </div>

      <EngineReportList />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: 'fa-chart-line', label: 'Sales Reports', val: '3 types', color: 'text-green-600 bg-green-50' },
          { icon: 'fa-file-invoice', label: 'GST Ready', val: 'GSTR-1', color: 'text-orange-600 bg-orange-50' },
          { icon: 'fa-boxes', label: 'Inventory', val: '2 reports', color: 'text-slate-600 bg-slate-50' },
          { icon: 'fa-sync', label: 'Data Source', val: 'Real-time', color: 'text-blue-600 bg-blue-50' },
        ].map((s, i) => (
          <div key={i} className={`${s.color} rounded-xl p-4 flex items-center gap-3`}>
            <i className={`fas ${s.icon} text-lg`}></i>
            <div>
              <div className="text-[10px] font-bold uppercase">{s.label}</div>
              <div className="text-xs font-black">{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Enterprise Banner */}
      <div className="card border-0 shadow-lg bg-gradient-to-r from-slate-900 to-slate-800 text-white overflow-hidden">
        <div className="card-body p-8 relative">
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black italic uppercase tracking-tighter">Enterprise Intelligence Dashboard</h2>
              <span className="text-[10px] font-black bg-green-500 text-white px-2 py-0.5 rounded-full uppercase">10 ACTIVE</span>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl">
              Access real-time data synchronized from all outlets. Comprehensive reporting engine with drill-down capabilities,
              GST compliance (GSTR-1), P&amp;L statements, stock valuation, and payment mode analytics.
            </p>
            <div className="flex space-x-3 pt-1 flex-wrap gap-2">
              <button onClick={() => navigate('/reports/pl')} className="bg-[#ff6b35] text-white px-5 py-2 rounded-full font-bold text-xs uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-colors">
                <i className="fas fa-balance-scale mr-2"></i>View P&amp;L
              </button>
              <button onClick={() => navigate('/reports/gst')} className="bg-white/10 backdrop-blur-md text-white px-5 py-2 rounded-full font-bold text-xs uppercase tracking-widest border border-white/20 hover:bg-white/20 transition-colors">
                <i className="fas fa-receipt mr-2"></i>GST Report
              </button>
              <button onClick={() => navigate('/reports/hierarchy')} className="bg-white/10 backdrop-blur-md text-white px-5 py-2 rounded-full font-bold text-xs uppercase tracking-widest border border-white/20 hover:bg-white/20 transition-colors">
                <i className="fas fa-chart-bar mr-2"></i>Hierarchy
              </button>
            </div>
          </div>
          <div className="absolute right-0 top-0 h-full opacity-10 pointer-events-none flex items-center pr-8">
            <i className="fas fa-chart-line text-[180px]"></i>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportCenter;
