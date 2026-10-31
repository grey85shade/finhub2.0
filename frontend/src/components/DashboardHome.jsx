import React, { useEffect, useState } from 'react';
import {
  Wallet,
  Landmark,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  PiggyBank,
  AlertCircle,
  ChevronRight,
  LineChart,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { BANK_DIRECTORY } from './AccountsView';
import PlannedExpenses from './PlannedExpenses';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact, formatPct, monthName, monthLabel } from '../utils/format';
import './DashboardHome.css';

export const bankFor = (bankId) =>
  BANK_DIRECTORY.find((b) => b.id === bankId) || { id: bankId, name: bankId, color: '#3b82f6', initials: bankId?.slice(0, 2).toUpperCase() };

export default function DashboardHome({ user, onOpenAccount, onOpenExpenses }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const res = await api.getDashboard();
      setData(res.data);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el resumen.');
    }
  };

  useEffect(() => { load(); }, []);

  if (error) {
    return (
      <div className="home-error glass-panel">
        <AlertCircle size={18} />
        <span>{error}</span>
        <button type="button" className="home-link-btn" onClick={load}><RefreshCw size={14} /> Reintentar</button>
      </div>
    );
  }
  if (!data) return <div className="home-loading">Cargando resumen…</div>;

  const { totals, month, categories, evolution, uncategorized, investments } = data;
  const hasAccounts = data.checking_accounts.length + data.debt_accounts.length + investments.length > 0;

  if (!hasAccounts) {
    return (
      <section className="home-empty glass-panel">
        <h2>Bienvenido/a, {user?.name || 'FinHuber'}</h2>
        <p>Aún no tienes cuentas. Pulsa <strong>Cuentas</strong> en el Dock inferior para añadir la primera.</p>
      </section>
    );
  }

  return (
    <div className="home">
      <section className="home-tiles">
        <div className="home-tile home-tile-hero">
          <span className="home-tile-label">Patrimonio neto (tras impuestos)</span>
          <span className="home-tile-value">{formatCurrency(totals.net_worth)}</span>
          <span className="home-tile-sub">
            Bruto {formatCurrency(totals.gross_worth)} · Impuestos estimados {formatCurrency(totals.taxes)}
          </span>
        </div>
        <div className="home-tile glass-panel">
          <span className="home-tile-label"><Wallet size={14} /> Cuentas corrientes</span>
          <span className="home-tile-value">{formatCurrency(totals.checking)}</span>
          <span className="home-tile-sub">Disponible en bancos</span>
        </div>
        <div className="home-tile glass-panel">
          <span className="home-tile-label"><LineChart size={14} /> Inversiones (neto)</span>
          <span className="home-tile-value">{formatCurrency(totals.investment_net)}</span>
          <span className="home-tile-sub">Valor bruto {formatCurrency(totals.investment)}</span>
        </div>
        {data.debt_accounts.length > 0 && (
          <div className="home-tile glass-panel">
            <span className="home-tile-label"><Landmark size={14} /> Deudas</span>
            <span className="home-tile-value is-negative">{formatCurrency(totals.debts)}</span>
            <span className="home-tile-sub">{data.debt_accounts.map((d) => d.name).join(', ')}</span>
          </div>
        )}
      </section>

      <section className="home-grid-2">
        <MonthSummary month={month} />
        <CategoryBars categories={categories} monthStart={month.current.start} onOpenExpenses={onOpenExpenses} />
      </section>

      <PlannedExpenses planned={data.planned} onChanged={load} />

      <section className="home-card glass-panel">
        <header className="home-card-header">
          <h3>Evolución del patrimonio</h3>
          <span className="home-card-hint">Patrimonio bruto al cierre de cada mes</span>
        </header>
        <EvolutionChart points={evolution} />
      </section>

      <section className="home-grid-2 home-grid-accounts">
        <AccountsTable checking={data.checking_accounts} debts={data.debt_accounts} onOpenAccount={onOpenAccount} />
        <UncategorizedCard uncategorized={uncategorized} onOpenAccount={onOpenAccount} />
      </section>

      {investments.length > 0 && (
        <section>
          <h3 className="home-section-title"><TrendingUp size={18} /> Portafolio de inversiones</h3>
          <div className="home-investments">
            {investments.map((inv) => <InvestmentCard key={inv.id} inv={inv} onOpenAccount={onOpenAccount} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Delta({ current, previous, higherIsBetter, prevLabel }) {
  if (!previous) return <span className="home-delta is-neutral">Sin datos de {prevLabel}</span>;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const good = higherIsBetter ? change >= 0 : change <= 0;
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`home-delta ${good ? 'is-good' : 'is-bad'}`}>
      <Icon size={12} />
      {change >= 0 ? '+' : ''}{change.toLocaleString('es-ES', { maximumFractionDigits: 0 })} % vs {prevLabel}
    </span>
  );
}

function MonthSummary({ month }) {
  const { current, previous } = month;
  const prevLabel = monthName(previous.start, 'short').replace('.', '');
  const rows = [
    { key: 'income', label: 'Ingresos', icon: ArrowDownLeft, tone: 'income', higherIsBetter: true },
    { key: 'expense', label: 'Gastos', icon: ArrowUpRight, tone: 'expense', higherIsBetter: false },
    { key: 'savings', label: 'Ahorro', icon: PiggyBank, tone: 'savings', higherIsBetter: true },
  ];
  return (
    <div className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Resumen de {monthName(current.start)}</h3>
        <span className="home-card-hint">Cuentas corrientes, sin transferencias internas</span>
      </header>
      <div className="home-month-rows">
        {rows.map(({ key, label, icon: Icon, tone, higherIsBetter }) => (
          <div key={key} className="home-month-row">
            <span className={`home-month-icon tone-${tone}`}><Icon size={16} /></span>
            <div className="home-month-text">
              <span className="home-month-label">{label}</span>
              <Delta current={current[key]} previous={previous[key]} higherIsBetter={higherIsBetter} prevLabel={prevLabel} />
            </div>
            <span className={`home-month-value ${key === 'savings' && current.savings < 0 ? 'is-negative' : ''}`}>
              {formatCurrency(current[key])}
            </span>
          </div>
        ))}
      </div>
      <div className="home-savings-rate">
        <span>Tasa de ahorro</span>
        <strong>{current.savings_rate === null ? '—' : `${current.savings_rate.toLocaleString('es-ES')} %`}</strong>
        <span className="home-card-hint">
          {previous.savings_rate === null ? '' : `${previous.savings_rate.toLocaleString('es-ES')} % en ${prevLabel}`}
        </span>
      </div>
    </div>
  );
}

function CategoryBars({ categories, monthStart, onOpenExpenses }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(0, ...categories.items.map((c) => c.amount));
  return (
    <div className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Gastos por categoría</h3>
        <button type="button" className="home-card-link" onClick={() => onOpenExpenses?.(null)}>
          {monthName(monthStart)} · {formatCurrency(categories.total)} <ChevronRight size={14} />
        </button>
      </header>
      {categories.items.length === 0 ? (
        <p className="home-empty-text">Todavía no hay gastos este mes.</p>
      ) : (
        <ul className="home-bars" aria-label="Gastos del mes por categoría">
          {categories.items.map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              className={`home-bar-row ${hover !== null && hover !== i ? 'is-dimmed' : ''} ${c.is_other ? '' : 'is-clickable'}`}
              onClick={() => !c.is_other && onOpenExpenses?.({ type: 'category', key: c.id ?? 'none', label: c.name })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title={`${c.name}: ${formatCurrency(c.amount)} (${formatPct(c.pct)} del gasto)`}
            >
              <span className="home-bar-label">
                <span className="home-bar-dot" style={{ background: c.color }} />
                {c.name}
              </span>
              <span className="home-bar-track">
                <span className="home-bar-fill" style={{ width: `${max ? (c.amount / max) * 100 : 0}%` }} />
              </span>
              <span className="home-bar-value">{formatCurrency(c.amount)}</span>
              <span className="home-bar-pct">{formatPct(c.pct)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHART_HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/** Escala "bonita" para el eje Y: 4-5 marcas en múltiplos de 1, 2 o 5. */
export function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function EvolutionChart({ points }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - PAD.left) / (innerW || 1);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(rel * (points.length - 1)))));
  };

  const hp = hover !== null ? points[hover] : null;
  const tooltipLeft = hp ? Math.min(Math.max(x(hover), 70), width - 70) : 0;

  return (
    <div className="home-chart" ref={ref}>
      <div className="home-chart-headline">
        <span className="home-chart-value">{formatCurrency(last.value)}</span>
        <span className={`home-delta ${change >= 0 ? 'is-good' : 'is-bad'}`}>
          {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change >= 0 ? '+' : ''}{formatCurrency(change)} desde {monthLabel(first.month)}
        </span>
      </div>
      {width > 0 && (
        <div className="home-chart-plot">
          <svg
            width={width}
            height={CHART_HEIGHT}
            role="img"
            aria-label={`Evolución del patrimonio de ${monthLabel(first.month)} a ${monthLabel(last.month)}: de ${formatCurrency(first.value)} a ${formatCurrency(last.value)}`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="home-chart-grid" />
                <text x={PAD.left - 10} y={y(t)} className="home-chart-axis" textAnchor="end" dominantBaseline="middle">
                  {formatCompact(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <text key={p.month} x={x(i)} y={CHART_HEIGHT - 8} className="home-chart-axis" textAnchor="middle">
                {innerW / points.length < 44 && i % 2 ? '' : monthLabel(p.month)}
              </text>
            ))}
            <path d={area} fill="url(#home-area)" />
            <path d={line} className="home-chart-line" />
            {hp && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="home-chart-crosshair" />
                <circle cx={x(hover)} cy={y(hp.value)} r={5} className="home-chart-marker" />
              </>
            )}
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" />
          </svg>
          {hp && (
            <div className="home-chart-tooltip" style={{ left: tooltipLeft, top: Math.max(0, y(hp.value) - 64) }}>
              <span>{new Date(`${hp.date}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <strong>{formatCurrency(hp.value)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BankBadge({ bankId }) {
  const bank = bankFor(bankId);
  return (
    <span className="home-bank-badge" style={{ background: bank.color }} title={bank.name}>
      {bank.initials || bank.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function AccountsTable({ checking, debts, onOpenAccount }) {
  const row = (acc) => (
    <li key={acc.id}>
      <button type="button" className="home-account-row" onClick={() => onOpenAccount(acc, bankFor(acc.bank_id))}>
        <BankBadge bankId={acc.bank_id} />
        <span className="home-account-name">
          {acc.name}
          <span className="home-account-bank">{bankFor(acc.bank_id).name}</span>
        </span>
        <span className={`home-account-balance ${acc.balance < 0 ? 'is-negative' : ''}`}>{formatCurrency(acc.balance)}</span>
        <ChevronRight size={16} className="home-account-chevron" />
      </button>
    </li>
  );
  return (
    <div className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Cuentas corrientes</h3>
      </header>
      <ul className="home-account-list">{checking.map(row)}</ul>
      {debts.length > 0 && (
        <>
          <h4 className="home-subtitle">Deudas</h4>
          <ul className="home-account-list">{debts.map(row)}</ul>
        </>
      )}
    </div>
  );
}

function UncategorizedCard({ uncategorized, onOpenAccount }) {
  const done = uncategorized.total === 0;
  return (
    <div className={`home-card glass-panel home-uncat ${done ? 'is-done' : ''}`}>
      <header className="home-card-header">
        <h3>Movimientos sin categoría</h3>
      </header>
      {done ? (
        <p className="home-empty-text">Todo categorizado. 👌</p>
      ) : (
        <>
          <div className="home-uncat-count">
            <AlertCircle size={18} />
            <span><strong>{uncategorized.total}</strong> movimientos sin categoría</span>
          </div>
          <ul className="home-account-list">
            {uncategorized.accounts.map(({ account, count }) => (
              <li key={account.id}>
                <button type="button" className="home-account-row" onClick={() => onOpenAccount(account, bankFor(account.bank_id))}>
                  <BankBadge bankId={account.bank_id} />
                  <span className="home-account-name">{account.name}</span>
                  <span className="home-uncat-pill">{count}</span>
                  <ChevronRight size={16} className="home-account-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function InvestmentCard({ inv, onOpenAccount }) {
  const tone = (v) => (v === null ? '' : v >= 0 ? 'is-positive' : 'is-negative');
  return (
    <button type="button" className="home-investment glass-panel" onClick={() => onOpenAccount(inv, bankFor(inv.bank_id))}>
      <div className="home-investment-head">
        <BankBadge bankId={inv.bank_id} />
        <span className="home-account-name">
          {inv.name}
          <span className="home-account-bank">{bankFor(inv.bank_id).name}</span>
        </span>
      </div>
      <div className="home-investment-net">
        <span className="home-tile-label">Valor neto</span>
        <span className="home-investment-value">{formatCurrency(inv.net)}</span>
      </div>
      <dl className="home-investment-stats">
        <div><dt>Plusvalía</dt><dd className={tone(inv.gain)}>{formatCurrency(inv.gain)} <small>{formatPct(inv.gain_pct)}</small></dd></div>
        <div><dt>TIR anual</dt><dd className={tone(inv.xirr)}>{formatPct(inv.xirr)}</dd></div>
        <div><dt>Aportado</dt><dd>{formatCurrency(inv.contributed)}</dd></div>
        <div><dt>Impuestos est.</dt><dd>{formatCurrency(inv.tax)}</dd></div>
        <div><dt>Valor bruto</dt><dd>{formatCurrency(inv.balance)}</dd></div>
      </dl>
    </button>
  );
}
