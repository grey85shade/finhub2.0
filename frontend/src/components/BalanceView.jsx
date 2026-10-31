import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, EyeOff, RotateCcw, Wallet } from 'lucide-react';
import { api } from '../services/api';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact, formatPct, formatDay, fromIso } from '../utils/format';
import './BalanceView.css';

// Se guardan las cuentas excluidas (no las marcadas) para que una cuenta nueva aparezca incluida
const EXCLUDED_ACCOUNTS_KEY = 'finhub_balance_excluded_accounts';
const NONE_CATEGORY = { name: 'Sin categoría', color: '#64748b', supra_id: 'none', supra_name: 'Sin categoría', supra_color: '#64748b' };

const loadSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const saveSet = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* almacenamiento no disponible */ }
};

const round2 = (v) => Math.round(v * 100) / 100;
const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;
const monthLong = (key) => fromIso(`${key}-01`).toLocaleDateString('es-ES', { month: 'long' });
const monthShort = (key) => fromIso(`${key}-01`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Tasa de ahorro en %, o null cuando no aporta nada (sin ingresos, o un gasto de más del doble de lo ingresado). */
function savingsRate(income, diff) {
  if (income <= 0) return null;
  const rate = Math.round((diff / income) * 1000) / 10;
  return rate < -100 ? null : rate;
}

const signed = (v) => `${v > 0 ? '+' : ''}${formatCurrency(v)}`;
const tone = (v) => (v > 0.004 ? 'is-good' : v < -0.004 ? 'is-bad' : '');

// ---------- Vista ----------

export default function BalanceView() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [excludedAccounts, setExcludedAccounts] = useState(() => loadSet(EXCLUDED_ACCOUNTS_KEY));
  const [openMonth, setOpenMonth] = useState(null);
  // Movimientos que se quitan temporalmente para ver cómo quedaría el año sin ellos
  const [excludedMovements, setExcludedMovements] = useState(() => new Set());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getBalance(year)
      .then((res) => { if (!cancelled) { setData(res.data); setError(''); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'No se pudo cargar el balance.'); });
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => saveSet(EXCLUDED_ACCOUNTS_KEY, excludedAccounts), [excludedAccounts]);

  const changeYear = (y) => { setYear(y); setOpenMonth(null); setExcludedMovements(new Set()); };

  const toggleMovements = (ids, exclude) => setExcludedMovements((cur) => {
    const next = new Set(cur);
    ids.forEach((id) => (exclude ? next.add(id) : next.delete(id)));
    return next;
  });

  // Solo vale cuando los datos cargados son del año elegido
  const ready = data && data.year === year;
  const model = useMemo(() => (ready ? buildModel(data, excludedAccounts, excludedMovements) : null),
    [ready, data, excludedAccounts, excludedMovements]);

  return (
    <div className="bal">
      <header className="bal-header">
        <h2>Balances</h2>
        <div className="bal-filters">
          <YearPicker year={year} years={data?.years ?? [year]} onChange={changeYear} />
          <AccountPicker accounts={data?.accounts ?? []} excluded={excludedAccounts} setExcluded={setExcludedAccounts} />
        </div>
      </header>

      {error && <div className="bal-error"><AlertCircle size={16} /><span>{error}</span></div>}

      {!model ? (
        !error && <div className="bal-loading">Cargando balance…</div>
      ) : (
        <>
          {model.excluded.count > 0 && (
            <div className="bal-excluded">
              <EyeOff size={15} />
              <span>
                Sin {model.excluded.count === 1 ? '1 movimiento excluido' : `${model.excluded.count} movimientos excluidos`}
                {' '}({signed(model.excluded.net)} en el saldo). Totales y saldos son una simulación.
              </span>
              <button type="button" onClick={() => setExcludedMovements(new Set())}>
                <RotateCcw size={13} /> Restablecer
              </button>
            </div>
          )}

          <Tiles model={model} year={year} />

          <section className="bal-card glass-panel">
            <header className="bal-card-header">
              <h3>Ingresos, gastos y saldo</h3>
              <Legend hasInvest={model.hasInvest} />
            </header>
            <FlowChart model={model} onPick={(key) => setOpenMonth(key)} />
          </section>

          <section className="bal-card glass-panel">
            <header className="bal-card-header">
              <h3>Mes a mes</h3>
              <span className="bal-hint">Pulsa un mes para ver el desglose</span>
            </header>
            <MonthTable model={model} openMonth={openMonth} onExclude={toggleMovements}
              onToggle={(key) => setOpenMonth((cur) => (cur === key ? null : key))} />
          </section>
        </>
      )}
    </div>
  );
}

// ---------- Cálculos ----------

function buildModel(data, excluded, excludedMovements) {
  const included = data.accounts.filter((a) => !excluded.has(a.id));
  const checkingIds = new Set(included.filter((a) => a.account_type === 'checking').map((a) => a.id));
  const investIds = included.filter((a) => a.account_type === 'investment').map((a) => a.id);
  const hasInvest = investIds.length > 0;
  // Con una sola cuenta corriente los traspasos internos son dinero que entra o sale de ella; con varias se compensan
  const countTransfers = checkingIds.size === 1;

  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const infoOf = (id) => (id === null ? NONE_CATEGORY : categories.get(id) || NONE_CATEGORY);

  const movements = [];
  data.movements.forEach((mv) => {
    if (!checkingIds.has(mv.account_id)) return;
    if (mv.kind === 'transfer' && !countTransfers) return;
    const isIncome = mv.kind === 'income' || (mv.kind === 'transfer' && mv.amount > 0);
    movements.push({
      ...mv,
      month: mv.date.slice(0, 7),
      income: isIncome ? mv.amount : 0,
      expense: isIncome ? 0 : mv.kind === 'transfer' ? -mv.amount : mv.amount, // devoluciones en negativo
      excluded: excludedMovements.has(mv.id),
    });
  });

  const byMonth = new Map();
  movements.forEach((mv) => {
    const t = byMonth.get(mv.month) || { income: 0, expense: 0, adjust: 0, excluded: 0 };
    if (mv.excluded) {
      // Lo que el saldo tendría de más (o de menos) sin este movimiento
      t.adjust += mv.expense - mv.income;
      t.excluded++;
    } else {
      t.income += mv.income;
      t.expense += mv.expense;
    }
    byMonth.set(mv.month, t);
  });

  const sumBalances = (ids, i) => round2(ids.reduce((acc, id) => acc + (data.balances[id]?.[i] ?? 0), 0));
  const liquidIds = [...checkingIds];
  const currentKey = data.today.slice(0, 7);
  const lastMonth = data.year === Number(data.today.slice(0, 4)) ? Number(data.today.slice(5, 7)) : 12;

  let cumulative = 0;
  let adjust = 0;
  const months = [];
  for (let m = 1; m <= lastMonth; m++) {
    const key = ym(data.year, m);
    const t = byMonth.get(key) || { income: 0, expense: 0, adjust: 0, excluded: 0 };
    const prev = byMonth.get(ym(data.year - 1, m)) || { income: 0, expense: 0 };
    const income = round2(t.income);
    const expense = round2(t.expense);
    const diff = round2(income - expense);
    cumulative = round2(cumulative + diff);
    adjust += t.adjust;
    const liquid = round2(sumBalances(liquidIds, m) + adjust);
    const invest = sumBalances(investIds, m);
    months.push({
      key, income, expense, diff, cumulative, liquid, invest, worth: round2(liquid + invest),
      rate: savingsRate(income, diff),
      inProgress: key === currentKey,
      excludedCount: t.excluded,
      prev: { income: round2(prev.income), expense: round2(prev.expense), diff: round2(prev.income - prev.expense) },
    });
  }
  const yearMovements = movements.filter((mv) => mv.date.startsWith(`${data.year}-`));
  const excludedList = yearMovements.filter((mv) => mv.excluded);

  const total = (list, field) => round2(list.reduce((acc, x) => acc + x[field], 0));
  const income = total(months, 'income');
  const expense = total(months, 'expense');
  const diff = round2(income - expense);
  // El año anterior se compara en los mismos meses, para que un año en curso no salga perdiendo
  const prevIncome = round2(months.reduce((acc, x) => acc + x.prev.income, 0));
  const prevExpense = round2(months.reduce((acc, x) => acc + x.prev.expense, 0));
  const hasPrev = movements.some((mv) => mv.month < `${data.year}-01`);

  const opening = { liquid: sumBalances(liquidIds, 0), invest: sumBalances(investIds, 0) };
  opening.worth = round2(opening.liquid + opening.invest);
  const last = months[months.length - 1];

  return {
    year: data.year,
    months,
    hasInvest,
    hasPrev,
    countTransfers,
    opening,
    last,
    excluded: { count: excludedList.length, net: round2(excludedList.reduce((acc, mv) => acc + mv.expense - mv.income, 0)) },
    totals: { income, expense, diff, rate: savingsRate(income, diff) },
    prevTotals: { income: prevIncome, expense: prevExpense, diff: round2(prevIncome - prevExpense), rate: savingsRate(prevIncome, prevIncome - prevExpense) },
    breakdown: (key) => monthBreakdown(yearMovements.filter((mv) => mv.month === key), infoOf),
  };
}

/**
 * Gastos por grupo y categoría, e ingresos por categoría, de los movimientos de un mes. Cada nodo lleva
 * su total sin los movimientos excluidos (total) y con ellos (gross), y los movimientos que lo forman.
 */
function monthBreakdown(movements, infoOf) {
  const node = (id, name, color) => ({ id, name, color, total: 0, gross: 0, movements: [] });
  const add = (n, mv, value) => {
    n.gross += value;
    if (!mv.excluded) n.total += value;
    n.movements.push(mv);
  };
  const supras = new Map();
  const incomes = new Map();
  movements.forEach((mv) => {
    const info = infoOf(mv.category_id);
    const catKey = mv.category_id ?? 'none';
    if (mv.income) {
      const name = mv.category_id === null ? 'Ingresos sin categoría' : info.name;
      if (!incomes.has(catKey)) incomes.set(catKey, node(catKey, name, info.color));
      add(incomes.get(catKey), mv, mv.income);
    } else {
      if (!supras.has(info.supra_id)) supras.set(info.supra_id, { ...node(info.supra_id, info.supra_name, info.supra_color), categories: new Map() });
      const s = supras.get(info.supra_id);
      add(s, mv, mv.expense);
      if (!s.categories.has(catKey)) s.categories.set(catKey, node(catKey, info.name, info.color));
      add(s.categories.get(catKey), mv, mv.expense);
    }
  });
  const sort = (list) => list
    .filter((x) => Math.abs(x.gross) > 0.004 || x.movements.length)
    .map((x) => ({ ...x, movements: [...x.movements].sort((a, b) => Math.abs(b.income + b.expense) - Math.abs(a.income + a.expense)) }))
    .sort((a, b) => b.gross - a.gross);
  return {
    expenses: sort([...supras.values()].map((s) => ({ ...s, categories: sort([...s.categories.values()]) }))),
    incomes: sort([...incomes.values()]),
  };
}

// ---------- Filtros ----------

function YearPicker({ year, years, onChange }) {
  const sorted = [...years].sort((a, b) => a - b);
  const idx = sorted.indexOf(year);
  return (
    <div className="bal-year" role="group" aria-label="Año">
      <button type="button" onClick={() => onChange(sorted[idx - 1])} disabled={idx <= 0} aria-label="Año anterior">
        <ChevronLeft size={16} />
      </button>
      <select value={year} onChange={(e) => onChange(Number(e.target.value))} aria-label="Elegir año">
        {[...sorted].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" onClick={() => onChange(sorted[idx + 1])} disabled={idx === -1 || idx >= sorted.length - 1}
        aria-label="Año siguiente">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function AccountPicker({ accounts, excluded, setExcluded }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const included = accounts.filter((a) => !excluded.has(a.id));
  const label = included.length === accounts.length ? 'Todas las cuentas'
    : included.length === 0 ? 'Ninguna cuenta'
    : included.length === 1 ? included[0].name
    : `${included.length} de ${accounts.length} cuentas`;

  const setMany = (ids, include) => setExcluded((cur) => {
    const next = new Set(cur);
    ids.forEach((id) => (include ? next.delete(id) : next.add(id)));
    return next;
  });

  const groups = [
    { id: 'checking', label: 'Cuentas corrientes', items: accounts.filter((a) => a.account_type === 'checking') },
    { id: 'investment', label: 'Inversión', items: accounts.filter((a) => a.account_type === 'investment') },
  ].filter((g) => g.items.length);

  return (
    <div className="bal-accounts" ref={ref}>
      <button type="button" className={`bal-accounts-btn ${included.length < accounts.length ? 'is-filtered' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <Wallet size={14} />
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="bal-accounts-pop glass-panel" role="group" aria-label="Cuentas incluidas">
          <div className="bal-picker-actions">
            <button type="button" onClick={() => setExcluded(new Set())}>Todas</button>
            <button type="button" onClick={() => setExcluded(new Set(accounts.map((a) => a.id)))}>Ninguna</button>
          </div>
          {groups.map((g) => {
            const ids = g.items.map((a) => a.id);
            const count = ids.filter((id) => !excluded.has(id)).length;
            return (
              <div key={g.id} className="bal-picker-group">
                <label className="bal-check is-group">
                  <input type="checkbox" checked={count === ids.length}
                    ref={(el) => { if (el) el.indeterminate = count > 0 && count < ids.length; }}
                    onChange={(e) => setMany(ids, e.target.checked)} />
                  <span className="bal-check-name">{g.label}</span>
                </label>
                {g.items.map((a) => (
                  <label key={a.id} className="bal-check is-child">
                    <input type="checkbox" checked={!excluded.has(a.id)} onChange={(e) => setMany([a.id], e.target.checked)} />
                    <span className="bal-check-name">{a.name}</span>
                    <span className="bal-check-total">{formatCurrency(a.balance)}</span>
                  </label>
                ))}
              </div>
            );
          })}
          <p className="bal-hint bal-picker-note">
            Los ingresos y gastos salen de las cuentas corrientes; las de inversión solo suman al patrimonio.
            Los traspasos internos cuentan solo si hay una única cuenta corriente marcada.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Resumen ----------

function Tiles({ model, year }) {
  const { totals, prevTotals, months, opening, last, hasInvest, hasPrev } = model;
  const n = months.length;
  const top = months.reduce((best, m) => (!best || m.expense > best.expense ? m : best), null);
  const endWorth = hasInvest ? last.worth : last.liquid;
  const startWorth = hasInvest ? opening.worth : opening.liquid;
  const sameMonths = n < 12 ? ` (ene–${monthShort(last.key)})` : '';

  return (
    <section className="bal-tiles">
      <Tile label={hasInvest ? 'Patrimonio' : 'Saldo'} value={formatCurrency(endWorth)}
        sub={<><span className={tone(endWorth - startWorth)}>{signed(round2(endWorth - startWorth))}</span> desde el 1 de enero</>} />
      <Tile label={`Ahorro ${year}`} value={<span className={tone(totals.diff)}>{formatCurrency(totals.diff)}</span>}
        sub={hasPrev ? `${year - 1}${sameMonths}: ${formatCurrency(prevTotals.diff)}` : `${formatCurrency(totals.income)} ingresado`} />
      <Tile label="Tasa de ahorro" value={<span className={tone(totals.diff)}>{formatPct(totals.rate)}</span>}
        sub={hasPrev ? `${year - 1}${sameMonths}: ${formatPct(prevTotals.rate)}` : 'Sobre los ingresos del año'} />
      <Tile label="Gasto medio mensual" value={formatCurrency(n ? totals.expense / n : 0)}
        sub={`Ingreso medio: ${formatCurrency(n ? totals.income / n : 0)}`} />
      <Tile label="Mes con más gasto" value={top && top.expense > 0 ? capitalize(monthLong(top.key)) : '—'}
        sub={top && top.expense > 0 ? formatCurrency(top.expense) : 'Sin gastos'} />
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="bal-tile glass-panel">
      <span className="bal-tile-label">{label}</span>
      <span className="bal-tile-value">{value}</span>
      {sub && <span className="bal-tile-sub">{sub}</span>}
    </div>
  );
}

// ---------- Gráfico ----------

const CHART_HEIGHT = 260;
const PAD = { top: 14, right: 58, bottom: 26, left: 56 };

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= v);
}

/** Escala del saldo: no empieza en 0 para que se vea cómo varía, con márgenes redondos. */
function balanceScale(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Math.abs(max) * 0.1, 1);
  const step = niceMax(span / 2) / 2;
  const lo = Math.floor((min - span * 0.1) / step) * step;
  const hi = Math.ceil((max + span * 0.1) / step) * step;
  return { lo, hi };
}

function Legend({ hasInvest }) {
  return (
    <div className="bal-legend">
      <span><i className="bal-key is-income" />Ingresos</span>
      <span><i className="bal-key is-expense" />Gastos</span>
      <span><i className="bal-key is-line" />{hasInvest ? 'Patrimonio' : 'Saldo final'}</span>
    </div>
  );
}

function FlowChart({ model, onPick }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const { months, hasInvest } = model;
  const slots = 12; // ancho fijo de 12 meses aunque el año esté en curso
  const lineValue = (m) => (hasInvest ? m.worth : m.liquid);

  const max = niceMax(Math.max(...months.map((m) => Math.max(m.income, m.expense)), 0));
  const { lo, hi } = balanceScale(months.map(lineValue));
  const compact = width < 520;
  const pad = compact ? { ...PAD, left: 44, right: 46 } : PAD;
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = CHART_HEIGHT - pad.top - pad.bottom;
  const slot = innerW / slots;
  const barW = Math.max(3, Math.min(16, slot / 2 - 3));
  const y = (v) => pad.top + innerH - (Math.max(0, v) / max) * innerH;
  const yb = (v) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const cx = (i) => pad.left + slot * i + slot / 2;
  const ticks = [0, 0.5, 1];
  const linePath = months.map((m, i) => `${i ? 'L' : 'M'}${cx(i)},${yb(lineValue(m))}`).join(' ');
  const h = hover !== null ? months[hover] : null;

  return (
    <div className="bal-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={CHART_HEIGHT} role="img" aria-label="Ingresos y gastos por mes con la evolución del saldo">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH * (1 - t)} y2={pad.top + innerH * (1 - t)} className="bal-grid-line" />
              <text x={pad.left - 8} y={pad.top + innerH * (1 - t)} className="bal-axis" textAnchor="end" dominantBaseline="middle">
                {formatCompact(max * t)}
              </text>
              <text x={width - pad.right + 8} y={pad.top + innerH * (1 - t)} className="bal-axis is-line" dominantBaseline="middle">
                {formatCompact(lo + (hi - lo) * t)}
              </text>
            </g>
          ))}
          {Array.from({ length: slots }, (_, i) => {
            const m = months[i];
            const key = ym(model.year, i + 1);
            return (
              <g key={key} className={m ? 'bal-bar-group' : ''} onMouseEnter={() => m && setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => m && onPick(m.key)}>
                <rect x={cx(i) - slot / 2} y={pad.top} width={slot} height={innerH} fill="transparent" className={hover === i ? 'bal-slot is-hover' : 'bal-slot'} />
                {m && m.income > 0 && <path className="bal-bar is-income" d={roundedTop(cx(i) - barW - 1, y(m.income), barW, pad.top + innerH - y(m.income))} />}
                {m && m.expense > 0 && <path className="bal-bar is-expense" d={roundedTop(cx(i) + 1, y(m.expense), barW, pad.top + innerH - y(m.expense))} />}
                <text x={cx(i)} y={CHART_HEIGHT - 8} className={`bal-axis ${m ? '' : 'is-future'}`} textAnchor="middle">
                  {compact ? monthShort(key).charAt(0).toUpperCase() : monthShort(key)}
                </text>
              </g>
            );
          })}
          <path d={linePath} className="bal-line" />
          {months.map((m, i) => (
            <circle key={m.key} cx={cx(i)} cy={yb(lineValue(m))} r={hover === i ? 4.5 : 3}
              className={`bal-point ${m.inProgress ? 'is-progress' : ''}`} />
          ))}
        </svg>
      )}
      {h && width > 0 && (
        <div className="bal-tooltip" style={{ left: Math.min(Math.max(cx(hover), 90), width - 90), top: 0 }}>
          <span className="bal-tooltip-title">{capitalize(monthLong(h.key))} {model.year}{h.inProgress ? ' · en curso' : ''}</span>
          <span className="bal-tooltip-row"><i className="bal-key is-income" />Ingresos<strong>{formatCurrency(h.income)}</strong></span>
          <span className="bal-tooltip-row"><i className="bal-key is-expense" />Gastos<strong>{formatCurrency(h.expense)}</strong></span>
          <span className="bal-tooltip-row">Diferencia<strong className={tone(h.diff)}>{formatCurrency(h.diff)}</strong></span>
          <span className="bal-tooltip-row"><i className="bal-key is-line" />{hasInvest ? 'Patrimonio' : 'Saldo'}<strong>{formatCurrency(lineValue(h))}</strong></span>
        </div>
      )}
    </div>
  );
}

/** Rectángulo con las esquinas superiores redondeadas y la base recta sobre el eje. */
function roundedTop(x, y, w, h) {
  const r = Math.min(3, h, w / 2);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

// ---------- Tabla ----------

function MonthTable({ model, openMonth, onToggle, onExclude }) {
  const { months, totals, hasInvest, last } = model;
  const n = months.length;
  const cols = hasInvest ? 9 : 8;

  return (
    <div className="bal-table-wrap">
      <table className="bal-table">
        <thead>
          <tr>
            <th>Mes</th>
            <th className="num">Ingresos</th>
            <th className="num">Gastos</th>
            <th className="num">Diferencia</th>
            <th className="num">Ahorro</th>
            <th className="num">Acumulado</th>
            <th className="num">Saldo final</th>
            {hasInvest && <th className="num">Patrimonio</th>}
            <th aria-label="Desplegar" />
          </tr>
        </thead>
        <tbody>
          {months.map((m) => {
            const open = openMonth === m.key;
            return (
              <Fragment key={m.key}>
                <tr className={`bal-row ${open ? 'is-open' : ''}`} onClick={() => onToggle(m.key)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(m.key); } }}
                  aria-expanded={open}>
                  <td className="bal-month">
                    {capitalize(monthLong(m.key))}
                    {m.inProgress && <span className="bal-badge">en curso</span>}
                    {m.excludedCount > 0 && (
                      <span className="bal-badge is-excluded" title="Movimientos excluidos de este mes">
                        <EyeOff size={10} /> {m.excludedCount}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatCurrency(m.income)}</td>
                  <td className="num">{formatCurrency(m.expense)}</td>
                  <td className={`num ${tone(m.diff)}`}>{formatCurrency(m.diff)}</td>
                  <td className={`num ${tone(m.diff)}`} title={m.rate === null && m.income > 0 ? 'Gasto de más del doble de lo ingresado' : undefined}>
                    {formatPct(m.rate)}
                  </td>
                  <td className={`num bal-muted ${tone(m.cumulative)}`}>{formatCurrency(m.cumulative)}</td>
                  <td className="num bal-strong">{formatCurrency(m.liquid)}</td>
                  {hasInvest && <td className="num bal-strong">{formatCurrency(m.worth)}</td>}
                  <td className="bal-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                </tr>
                {open && (
                  <tr className="bal-detail-row">
                    <td colSpan={cols}><MonthDetail month={m} model={model} onExclude={onExclude} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bal-total">
            <td>Total {model.year}</td>
            <td className="num">{formatCurrency(totals.income)}</td>
            <td className="num">{formatCurrency(totals.expense)}</td>
            <td className={`num ${tone(totals.diff)}`}>{formatCurrency(totals.diff)}</td>
            <td className={`num ${tone(totals.diff)}`}>{formatPct(totals.rate)}</td>
            <td className="num" />
            <td className="num">{formatCurrency(last.liquid)}</td>
            {hasInvest && <td className="num">{formatCurrency(last.worth)}</td>}
            <td />
          </tr>
          <tr className="bal-average">
            <td>Media mensual</td>
            <td className="num">{formatCurrency(totals.income / n)}</td>
            <td className="num">{formatCurrency(totals.expense / n)}</td>
            <td className={`num ${tone(totals.diff)}`}>{formatCurrency(totals.diff / n)}</td>
            <td colSpan={cols - 4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MonthDetail({ month, model, onExclude }) {
  const { expenses, incomes } = model.breakdown(month.key);
  const top = Math.max(...expenses.map((g) => g.total), 1);
  const prevYear = model.year - 1;

  return (
    <div className="bal-detail">
      <div className="bal-detail-col">
        <h4>Gastos por categoría</h4>
        {expenses.length === 0 ? <p className="bal-empty">Sin gastos este mes.</p> : (
          <ul className="bal-breakdown">
            {expenses.map((g) => (
              <BreakdownNode key={g.id} node={g} top={top} onExclude={onExclude} swatch
                subnodes={g.categories.length > 1 ? g.categories : null} />
            ))}
          </ul>
        )}
        <p className="bal-hint bal-exclude-hint">Desmarca una categoría o un movimiento para ver cómo quedaría el año sin él.</p>
      </div>
      <div className="bal-detail-col">
        <h4>Ingresos</h4>
        {incomes.length === 0 ? <p className="bal-empty">Sin ingresos este mes.</p> : (
          <ul className="bal-breakdown">
            {incomes.map((c) => <BreakdownNode key={c.id} node={c} onExclude={onExclude} />)}
          </ul>
        )}
        {model.hasPrev && (
          <>
            <h4 className="bal-compare-title">Frente a {monthLong(month.key)} de {prevYear}</h4>
            <dl className="bal-compare">
              <CompareRow label="Ingresos" current={month.income} previous={month.prev.income} higherIsGood />
              <CompareRow label="Gastos" current={month.expense} previous={month.prev.expense} />
              <CompareRow label="Diferencia" current={month.diff} previous={month.prev.diff} higherIsGood />
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Fila de un grupo o categoría con su casilla para incluirla o excluirla. Si tiene subcategorías las
 * muestra debajo; si no, se despliega para ver (y excluir) sus movimientos uno a uno.
 */
function BreakdownNode({ node, subnodes = null, top = null, onExclude, swatch = false, child = false }) {
  const [open, setOpen] = useState(false);
  const ids = node.movements.map((mv) => mv.id);
  const excludedCount = node.movements.filter((mv) => mv.excluded).length;
  const allExcluded = excludedCount === ids.length;
  const expandable = !subnodes;

  return (
    <li>
      <div className={`bal-breakdown-row ${top === null ? 'is-flat' : ''} ${child ? 'is-child' : ''} ${allExcluded ? 'is-excluded' : ''}`}>
        <input type="checkbox" checked={!allExcluded} aria-label={`Incluir ${node.name}`}
          ref={(el) => { if (el) el.indeterminate = excludedCount > 0 && !allExcluded; }}
          onChange={(e) => onExclude(ids, !e.target.checked)} />
        <button type="button" className="bal-breakdown-main" disabled={!expandable}
          onClick={() => setOpen((o) => !o)} aria-expanded={expandable ? open : undefined}>
          {expandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          <span className={swatch ? 'bal-swatch' : 'bal-dot'} style={{ background: node.color }} />
          <span className="bal-breakdown-name">{node.name}</span>
          {expandable && <span className="bal-breakdown-count">{ids.length}</span>}
        </button>
        {top !== null && (
          <span className="bal-breakdown-bar">
            {!child && <span style={{ width: `${(Math.max(0, node.total) / top) * 100}%`, background: node.color }} />}
          </span>
        )}
        <span className="bal-breakdown-value">{formatCurrency(node.total)}</span>
      </div>
      {subnodes && (
        <ul>
          {subnodes.map((c) => <BreakdownNode key={c.id} node={c} top={top} onExclude={onExclude} child />)}
        </ul>
      )}
      {expandable && open && (
        <ul className="bal-movements">
          {node.movements.map((mv) => {
            const value = mv.income || mv.expense;
            return (
              <li key={mv.id} className={mv.excluded ? 'is-excluded' : ''}>
                <label>
                  <input type="checkbox" checked={!mv.excluded} onChange={(e) => onExclude([mv.id], !e.target.checked)} />
                  <span className="bal-mv-date">{formatDay(mv.date, { day: '2-digit', month: '2-digit' })}</span>
                  <span className="bal-mv-concept" title={mv.concept}>
                    {mv.concept}
                    {mv.kind === 'transfer' && <small> · traspaso</small>}
                  </span>
                  <span className={`bal-mv-amount ${value < 0 ? 'is-good' : ''}`}>
                    {value < 0 ? `+${formatCurrency(-value)}` : formatCurrency(value)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function CompareRow({ label, current, previous, higherIsGood = false }) {
  const delta = round2(current - previous);
  const good = higherIsGood ? delta > 0 : delta < 0;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className="bal-compare-prev">{formatCurrency(previous)}</span>
        <span className={Math.abs(delta) < 0.005 ? '' : good ? 'is-good' : 'is-bad'}>{signed(delta)}</span>
      </dd>
    </>
  );
}
