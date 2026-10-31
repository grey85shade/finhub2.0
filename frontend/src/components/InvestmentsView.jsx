import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  PiggyBank,
  Percent,
  Layers,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import { bankFor, BankBadge, niceTicks } from './DashboardHome';
import FundsModal from './FundsModal';
import CompoundSimulator from './CompoundSimulator';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact, formatPct, formatDay, monthLabel, toIso } from '../utils/format';
import './DashboardHome.css';
import './InvestmentsView.css';

// Paleta categórica para distinguir cuentas en la distribución
const PALETTE = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#94a3b8'];

const MOVEMENT_TYPES = {
  income: { label: 'Aportación', icon: ArrowDownLeft, tone: 'tone-income' },
  expense: { label: 'Retirada', icon: ArrowUpRight, tone: 'tone-expense' },
  update: { label: 'Valoración', icon: RefreshCw, tone: 'tone-savings' },
};

const tone = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'is-positive' : 'is-negative');
const signed = (v) => `${v > 0 ? '+' : ''}${formatCurrency(v)}`;

export default function InvestmentsView({ onOpenAccount }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [fundsAccountId, setFundsAccountId] = useState(null);
  const [sync, setSync] = useState({ state: 'idle', errors: [] });

  const load = async () => {
    try {
      setError('');
      const res = await api.getInvestments();
      setData(res.data);
      return res.data;
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las inversiones.');
      return null;
    }
  };

  // Descarga los últimos valores liquidativos (el servidor los guarda en caché unas horas) y revalora las cuentas
  const syncPrices = async (force = false) => {
    setSync({ state: 'syncing', errors: [] });
    try {
      const res = await api.syncFundPrices(force);
      setSync({ state: 'done', errors: res.data.errors });
      if (Object.keys(res.data.updated).length > 0) await load();
    } catch (err) {
      setSync({ state: 'done', errors: [err.message || 'No se pudieron actualizar los precios.'] });
    }
  };

  useEffect(() => {
    load().then((d) => { if (d?.accounts.some((a) => a.funds.length > 0)) syncPrices(); });
  }, []);

  if (error) {
    return (
      <div className="home-error glass-panel">
        <AlertCircle size={18} />
        <span>{error}</span>
        <button type="button" className="home-link-btn" onClick={load}><RefreshCw size={14} /> Reintentar</button>
      </div>
    );
  }
  if (!data) return <div className="home-loading">Cargando inversiones…</div>;

  const { totals, accounts, evolution, annual, movements } = data;
  if (accounts.length === 0) {
    return (
      <section className="home-empty glass-panel">
        <h2>Aún no tienes inversiones</h2>
        <p>Crea una cuenta de tipo <strong>Inversión</strong> en <strong>Cuentas</strong> para ver aquí su rentabilidad.</p>
      </section>
    );
  }

  const colorOf = Object.fromEntries(accounts.map((a, i) => [a.id, PALETTE[i % PALETTE.length]]));
  const open = (acc) => onOpenAccount(acc, bankFor(acc.bank_id));
  const navDates = accounts.flatMap((a) => a.funds.map((f) => f.nav_date)).filter(Boolean).sort();
  const manualAccounts = accounts.filter((a) => a.funds.length === 0);
  const fundsAccount = accounts.find((a) => a.id === fundsAccountId);

  return (
    <div className="home inv">
      <header className="inv-header">
        <div>
          <h2 className="inv-title">Inversiones</h2>
          <span className="home-card-hint">
            {accounts.length} {accounts.length === 1 ? 'cuenta' : 'cuentas'} · datos a {formatDay(data.as_of, { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="inv-header-actions">
          {navDates.length > 0 && (
            <button
              type="button"
              className="inv-sync"
              onClick={() => syncPrices(true)}
              disabled={sync.state === 'syncing'}
              title={sync.errors.length ? sync.errors.join('\n') : 'Descargar ahora los últimos valores liquidativos'}
            >
              <RefreshCw size={14} className={sync.state === 'syncing' ? 'is-spinning' : ''} />
              {sync.state === 'syncing' ? 'Actualizando precios…' : `Precios del ${formatDay(navDates[0])}`}
              {sync.errors.length > 0 && <AlertCircle size={14} className="inv-sync-error" />}
            </button>
          )}
          {manualAccounts.length > 0 && (
            <button type="button" className="btn-modal-primary inv-update-btn" onClick={() => setIsUpdateOpen(true)}>
              <RefreshCw size={16} /> Actualizar valores
            </button>
          )}
        </div>
      </header>

      <section className="home-tiles">
        <div className="home-tile home-tile-hero">
          <span className="home-tile-label">Valor neto (tras impuestos)</span>
          <span className="home-tile-value">{formatCurrency(totals.net)}</span>
          <span className="home-tile-sub">
            Bruto {formatCurrency(totals.value)} · Impuestos latentes {formatCurrency(totals.tax)}
          </span>
        </div>
        <div className="home-tile glass-panel">
          <span className="home-tile-label">{totals.gain >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} Plusvalía</span>
          <span className={`home-tile-value ${tone(totals.gain)}`}>{signed(totals.gain)}</span>
          <span className="home-tile-sub">{formatPct(totals.gain_pct)} sobre lo aportado</span>
        </div>
        <div className="home-tile glass-panel">
          <span className="home-tile-label"><Percent size={14} /> TIR anual</span>
          <span className={`home-tile-value ${tone(totals.xirr)}`}>{formatPct(totals.xirr)}</span>
          <span className="home-tile-sub" title="Rentabilidad anualizada ponderada por dinero: tiene en cuenta cuándo hiciste cada aportación">
            Según cuándo aportaste
          </span>
        </div>
        <div className="home-tile glass-panel">
          <span className="home-tile-label"><PiggyBank size={14} /> Capital aportado</span>
          <span className="home-tile-value">{formatCurrency(totals.contributed)}</span>
          <span className="home-tile-sub" title="Aportaciones menos retiradas de los últimos 12 meses, por mes">
            {formatCurrency(totals.monthly_contribution)}/mes último año
          </span>
        </div>
      </section>

      {evolution.length > 1 && (
        <section className="home-card glass-panel">
          <header className="home-card-header">
            <h3>Valor frente a capital aportado</h3>
            <span className="home-card-hint">Al cierre de cada mes · la diferencia es lo que han rendido tus inversiones</span>
          </header>
          <ValueChart points={evolution} />
        </section>
      )}

      <section className="home-grid-2 inv-grid">
        <AnnualReturns annual={annual} accounts={accounts} colorOf={colorOf} />
        <Allocation accounts={accounts} total={totals.value} colorOf={colorOf} onOpen={open} />
      </section>

      <AccountsTable accounts={accounts} colorOf={colorOf} onOpen={open} onManageFunds={(a) => setFundsAccountId(a.id)} />

      <CompoundSimulator totals={totals} />

      <Movements movements={movements} accounts={accounts} colorOf={colorOf} />

      {fundsAccount && (
        <FundsModal account={fundsAccount} onClose={() => setFundsAccountId(null)} onChanged={load} />
      )}

      {isUpdateOpen && (
        <BulkValuationModal
          accounts={manualAccounts}
          onClose={() => setIsUpdateOpen(false)}
          onSaved={() => { setIsUpdateOpen(false); load(); }}
        />
      )}
    </div>
  );
}

const CHART_HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function ValueChart({ points }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const all = points.flatMap((p) => [p.value, p.contributed]);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
  const valueLine = path('value');
  const area = `${valueLine} L${x(points.length - 1)},${y(yMin)} L${x(0)},${y(yMin)} Z`;
  // Cada cuántos meses se rotula el eje X para que las etiquetas no se pisen
  const labelEvery = Math.max(1, Math.ceil(48 / (innerW / points.length || 1)));

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - PAD.left) / (innerW || 1);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(rel * (points.length - 1)))));
  };

  const hp = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="home-chart" ref={ref}>
      <div className="inv-legend">
        <span><i className="inv-legend-line is-value" /> Valor {formatCurrency(last.value)}</span>
        <span><i className="inv-legend-line is-contributed" /> Aportado {formatCurrency(last.contributed)}</span>
      </div>
      {width > 0 && (
        <div className="home-chart-plot">
          <svg
            width={width}
            height={CHART_HEIGHT}
            role="img"
            aria-label={`Valor de la cartera ${formatCurrency(last.value)} frente a ${formatCurrency(last.contributed)} aportados`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="inv-area" x1="0" y1="0" x2="0" y2="1">
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
                {(points.length - 1 - i) % labelEvery ? '' : monthLabel(p.month)}
              </text>
            ))}
            <path d={area} fill="url(#inv-area)" />
            <path d={path('contributed')} className="inv-chart-contributed" />
            <path d={valueLine} className="home-chart-line" />
            {hp && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="home-chart-crosshair" />
                <circle cx={x(hover)} cy={y(hp.contributed)} r={4} className="inv-chart-marker-contributed" />
                <circle cx={x(hover)} cy={y(hp.value)} r={5} className="home-chart-marker" />
              </>
            )}
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" />
          </svg>
          {hp && (
            <div className="home-chart-tooltip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: Math.max(0, y(hp.value) - 96) }}>
              <span>{formatDay(hp.date, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <strong>{formatCurrency(hp.value)}</strong>
              <span>Aportado {formatCurrency(hp.contributed)}</span>
              <span className={tone(hp.value - hp.contributed)}>Plusvalía {signed(hp.value - hp.contributed)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnnualReturns({ annual, accounts, colorOf }) {
  const multi = accounts.length > 1;
  return (
    <div className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Rentabilidad por año</h3>
        <span className="home-card-hint" title="Método Modified Dietz: descuenta el efecto de las aportaciones y retiradas hechas durante el año">
          Sin el efecto de las aportaciones
        </span>
      </header>
      {annual.length === 0 ? (
        <p className="home-empty-text">Sin datos suficientes.</p>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table inv-annual">
            <thead>
              <tr>
                <th>Año</th>
                <th>Rentab.</th>
                <th>Ganancia</th>
                <th>Aport. netas</th>
                {multi && accounts.map((a) => (
                  <th key={a.id} title={a.name} aria-label={a.name}><span className="home-bar-dot inv-th-dot" style={{ background: colorOf[a.id] }} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annual.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}{y.is_current && <small className="inv-ytd">YTD</small>}</td>
                  <td className={`inv-strong ${tone(y.return_pct)}`}>{formatPct(y.return_pct)}</td>
                  <td className={tone(y.gain)}>{signed(y.gain)}</td>
                  <td>{formatCurrency(y.net_contributions)}</td>
                  {multi && accounts.map((a) => {
                    const v = y.accounts[a.id];
                    return <td key={a.id} className={tone(v)}>{v === undefined ? '' : formatPct(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Allocation({ accounts, total, colorOf, onOpen }) {
  const [hover, setHover] = useState(null);
  const slices = accounts.filter((a) => a.balance > 0);
  const size = 180;
  const r = 70;
  const c = 2 * Math.PI * r;
  const lengths = slices.map((s) => (total > 0 ? (s.balance / total) * c : 0));
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  const hovered = slices.find((s) => s.id === hover);

  return (
    <div className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Distribución</h3>
        <span className="home-card-hint">Por cuenta, valor bruto</span>
      </header>
      <div className="inv-alloc">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribución de la cartera por cuenta">
          <circle cx={size / 2} cy={size / 2} r={r} className="inv-donut-track" />
          {slices.map((s, i) => (
              <circle
                key={s.id}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colorOf[s.id]}
                strokeWidth={hover === s.id ? 26 : 22}
                strokeDasharray={`${Math.max(0, lengths[i] - 2)} ${c}`}
                strokeDashoffset={-offsets[i]}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className={hover !== null && hover !== s.id ? 'is-dimmed' : ''}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
              />
          ))}
          <text x="50%" y="47%" textAnchor="middle" className="inv-donut-label">{hovered ? hovered.name : 'Total'}</text>
          <text x="50%" y="58%" textAnchor="middle" className="inv-donut-value">
            {hovered ? formatPct(Math.round((hovered.balance / total) * 1000) / 10) : formatCompact(total)}
          </text>
        </svg>
        <ul className="home-bars inv-alloc-list">
          {slices.map((s) => (
            <li
              key={s.id}
              className={`home-bar-row inv-alloc-row is-clickable ${hover !== null && hover !== s.id ? 'is-dimmed' : ''}`}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onOpen(s)}
            >
              <span className="home-bar-label"><span className="home-bar-dot" style={{ background: colorOf[s.id] }} />{s.name}</span>
              <span className="home-bar-value">{formatCurrency(s.balance)}</span>
              <span className="home-bar-pct">{formatPct(Math.round((s.balance / total) * 1000) / 10)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccountsTable({ accounts, colorOf, onOpen, onManageFunds }) {
  return (
    <section className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Cuentas de inversión</h3>
        <span className="home-card-hint">Pulsa una cuenta para ver sus movimientos</span>
      </header>
      <div className="inv-table-wrap">
        <table className="inv-table inv-accounts">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Valor</th>
              <th>Aportado</th>
              <th>Plusvalía</th>
              <th>TIR anual</th>
              <th>Impuestos</th>
              <th>Neto</th>
              <th>Últ. valoración</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <Fragment key={a.id}>
              <tr className={`is-clickable ${a.funds.length ? 'has-funds' : ''}`} onClick={() => onOpen(a)}>
                <td>
                  <span className="inv-account-cell">
                    <span className="inv-color-bar" style={{ background: colorOf[a.id] }} />
                    <BankBadge bankId={a.bank_id} />
                    <span className="home-account-name">
                      {a.name}
                      <span className="home-account-bank">
                        {bankFor(a.bank_id).name}{a.years !== null && ` · ${a.years.toLocaleString('es-ES', { maximumFractionDigits: 1 })} años`}
                      </span>
                      <button
                        type="button"
                        className="inv-funds-btn"
                        onClick={(e) => { e.stopPropagation(); onManageFunds(a); }}
                        title={a.funds.length ? 'Gestionar fondos' : 'Añadir fondos para valorar la cuenta automáticamente'}
                      >
                        <Layers size={12} /> {a.funds.length ? 'Gestionar fondos' : 'Añadir fondos'}
                      </button>
                    </span>
                  </span>
                </td>
                <td className="inv-strong">{formatCurrency(a.balance)}</td>
                <td>{formatCurrency(a.contributed)}</td>
                <td className={tone(a.gain)}>{signed(a.gain)}<small>{formatPct(a.gain_pct)}</small></td>
                <td className={`inv-strong ${tone(a.xirr)}`}>{formatPct(a.xirr)}</td>
                <td>{formatCurrency(a.tax)}</td>
                <td>{formatCurrency(a.net)}</td>
                <td className={a.funds.length ? '' : staleClass(a.last_valuation)}>
                  {a.last_valuation ? formatDay(a.last_valuation) : 'Nunca'}
                  {a.funds.length > 0 && <small>automática</small>}
                </td>
              </tr>
              {a.funds.map((f) => (
                <tr key={`f${f.id}`} className="inv-fund-row is-clickable" onClick={() => onManageFunds(a)}>
                  <td>
                    <span className="inv-fund-cell">
                      <span className="home-account-name">
                        {f.name}
                        <span className="home-account-bank">{f.isin} · peso {formatPct(f.weight)}</span>
                      </span>
                    </span>
                  </td>
                  <td>{f.value === null ? '—' : formatCurrency(f.value)}</td>
                  <td colSpan={2} className="inv-dim">
                    {f.units === null ? 'Sin precios' : `${f.units.toLocaleString('es-ES', { maximumFractionDigits: 4 })} part. × ${f.nav.toLocaleString('es-ES', { maximumFractionDigits: 4 })} €`}
                  </td>
                  <td className={tone(f.nav_change_1y)} title="Variación del valor liquidativo en los últimos 12 meses">
                    {f.nav_change_1y === null ? '' : <>{formatPct(f.nav_change_1y)}<small>VL 12 m</small></>}
                  </td>
                  <td colSpan={4} />
                </tr>
              ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Una valoración de hace más de 45 días hace que las métricas no reflejen el valor real. */
function staleClass(date) {
  if (!date) return 'inv-stale';
  const days = (Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86400000;
  return days > 45 ? 'inv-stale' : '';
}

const PAGE = 15;

function Movements({ movements, accounts, colorOf }) {
  const [type, setType] = useState('all');
  const [accountId, setAccountId] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const nameOf = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const filtered = useMemo(
    () => movements.filter((m) => (type === 'all' || m.type === type) && (accountId === 'all' || m.account_id === Number(accountId))),
    [movements, type, accountId],
  );

  return (
    <section className="home-card glass-panel">
      <header className="home-card-header">
        <h3>Movimientos</h3>
        <div className="inv-filters">
          <div className="inv-segment" role="group" aria-label="Tipo de movimiento">
            {[['all', 'Todos'], ['income', 'Aportaciones'], ['expense', 'Retiradas'], ['update', 'Valoraciones']].map(([id, label]) => (
              <button key={id} type="button" className={type === id ? 'active' : ''} onClick={() => { setType(id); setLimit(PAGE); }}>
                {label}
              </button>
            ))}
          </div>
          {accounts.length > 1 && (
            <select className="modal-input modal-select inv-select" value={accountId} onChange={(e) => { setAccountId(e.target.value); setLimit(PAGE); }}>
              <option value="all">Todas las cuentas</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      </header>
      {filtered.length === 0 ? (
        <p className="home-empty-text">No hay movimientos con estos filtros.</p>
      ) : (
        <ul className="inv-movements">
          {filtered.slice(0, limit).map((m) => {
            const { label, icon: Icon, tone: t } = MOVEMENT_TYPES[m.type];
            return (
              <li key={m.id} className="inv-movement">
                <span className={`home-month-icon ${t}`}><Icon size={16} /></span>
                <span className="inv-movement-text">
                  <span className="inv-movement-concept">{m.concept}</span>
                  <span className="home-account-bank">
                    <span className="home-bar-dot" style={{ background: colorOf[m.account_id] }} /> {nameOf[m.account_id]} · {label}
                  </span>
                </span>
                <span className="inv-movement-date">{formatDay(m.date)}</span>
                <span className={`inv-movement-amount ${m.type === 'income' ? 'is-positive' : m.type === 'expense' ? 'is-negative' : ''}`}>
                  {m.type === 'income' ? '+' : m.type === 'expense' ? '−' : ''}{formatCurrency(m.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > limit && (
        <button type="button" className="home-link-btn inv-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Ver más ({filtered.length - limit}) <ChevronRight size={14} />
        </button>
      )}
    </section>
  );
}

function BulkValuationModal({ accounts, onClose, onSaved }) {
  const [date, setDate] = useState(toIso(new Date()));
  const [values, setValues] = useState(() => Object.fromEntries(accounts.map((a) => [a.id, ''])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const changed = accounts.filter((a) => values[a.id] !== '' && Number(values[a.id]) !== a.balance);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (changed.length === 0) { onClose(); return; }
    setSaving(true);
    setError('');
    const failed = [];
    // En serie: cada valoración recalcula la cadena de saldos de su cuenta
    for (const a of changed) {
      try {
        await api.createTransaction(a.id, { date, concept: 'Actualización de valor', amount: Number(values[a.id]), type: 'update' });
      } catch (err) {
        failed.push(`${a.name}: ${err.message}`);
      }
    }
    setSaving(false);
    if (failed.length) { setError(failed.join(' · ')); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal-container glass-panel animate-scale-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="step-badge">Valoración</span>
            <h2>Actualizar valores</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={saving}><X size={20} /></button>
        </div>
        {error && <div className="modal-alert-error"><AlertCircle size={16} /><span>{error}</span></div>}
        <form onSubmit={handleSubmit} className="inv-bulk-form">
          <div className="form-group">
            <label htmlFor="inv-date">Fecha de la valoración</label>
            <input id="inv-date" type="date" required className="modal-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <p className="form-hint">Escribe el valor actual de cada cuenta. Las que dejes en blanco no cambian.</p>
          <ul className="inv-bulk-list">
            {accounts.map((a, i) => {
              const v = values[a.id] === '' ? null : Number(values[a.id]);
              const diff = v === null ? null : v - a.balance;
              return (
                <li key={a.id} className="inv-bulk-row">
                  <BankBadge bankId={a.bank_id} />
                  <span className="home-account-name">
                    {a.name}
                    <span className="home-account-bank">Ahora {formatCurrency(a.balance)}</span>
                  </span>
                  <span className={`inv-bulk-diff ${tone(diff)}`}>{diff === null || diff === 0 ? '' : signed(diff)}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder={a.balance.toFixed(2)}
                    aria-label={`Nuevo valor de ${a.name}`}
                    className="modal-input inv-bulk-input"
                    value={values[a.id]}
                    autoFocus={i === 0}
                    onChange={(e) => setValues({ ...values, [a.id]: e.target.value })}
                  />
                </li>
              );
            })}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn-modal-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn-modal-primary" disabled={saving || changed.length === 0}>
              {saving ? 'Guardando…' : `Guardar ${changed.length || ''} ${changed.length === 1 ? 'valoración' : 'valoraciones'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
