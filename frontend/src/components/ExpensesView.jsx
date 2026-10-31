import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Search, X, TrendingUp, TrendingDown, RotateCcw, Wallet } from 'lucide-react';
import { api } from '../services/api';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact, formatPct, monthLabel, formatDay, toIso, fromIso } from '../utils/format';
import './ExpensesView.css';

const PRESETS = [
  { id: 'month', label: 'Este mes' },
  { id: 'prev_month', label: 'Mes anterior' },
  { id: '3m', label: '3 meses' },
  { id: '12m', label: '12 meses' },
  { id: 'year', label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];
const BAR_MONTHS = 12;
const TOP_CONCEPTS = 8;
const LIST_PAGE = 60;
const NONE = 'none';
const NONE_CATEGORY = { name: 'Sin categoría', color: '#64748b', supra_id: NONE, supra_name: 'Sin categoría', supra_color: '#64748b' };
const EXCLUDED_KEY = 'finhub_expenses_excluded';
// Se guardan las cuentas excluidas (no las marcadas) para que una cuenta nueva aparezca incluida
const EXCLUDED_ACCOUNTS_KEY = 'finhub_expenses_excluded_accounts';

const loadSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const saveSet = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* almacenamiento no disponible */ }
};

// ---------- Fechas ----------

/** Suma meses conservando el día (ajustado al último día si el mes es más corto). */
function addMonths(iso, n) {
  const d = fromIso(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toIso(target);
}
const firstOfMonth = (iso, offset = 0) => {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth() + offset, 1));
};
const lastOfMonth = (iso) => {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};
const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 86400000) + 1;
const addDays = (iso, n) => {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
};

/** Periodo elegido y el periodo anterior equivalente con el que se compara. */
function resolvePeriod(preset, custom, today) {
  const monthsBack = { month: 0, '3m': 2, '12m': 11 };
  if (preset in monthsBack) {
    const span = monthsBack[preset] + 1;
    const from = firstOfMonth(today, -monthsBack[preset]);
    return { from, to: today, prevFrom: addMonths(from, -span), prevTo: addMonths(today, -span) };
  }
  if (preset === 'prev_month') {
    const from = firstOfMonth(today, -1);
    return { from, to: lastOfMonth(from), prevFrom: firstOfMonth(today, -2), prevTo: lastOfMonth(firstOfMonth(today, -2)) };
  }
  if (preset === 'year') {
    const from = `${today.slice(0, 4)}-01-01`;
    return { from, to: today, prevFrom: addMonths(from, -12), prevTo: addMonths(today, -12) };
  }
  const len = daysBetween(custom.from, custom.to);
  return { from: custom.from, to: custom.to, prevFrom: addDays(custom.from, -len), prevTo: addDays(custom.from, -1) };
}

// ---------- Vista ----------

export default function ExpensesView({ initialFocus = null }) {
  const [today] = useState(() => toIso(new Date()));
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: firstOfMonth(today), to: today });
  const [excludedAccounts, setExcludedAccounts] = useState(() => loadSet(EXCLUDED_ACCOUNTS_KEY));
  const [excluded, setExcluded] = useState(() => loadSet(EXCLUDED_KEY));
  const [focus, setFocus] = useState(initialFocus); // { type: 'supra'|'category'|'concept', key, label }
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const period = resolvePeriod(preset, custom, today);
  const barsFrom = firstOfMonth(period.to, -(BAR_MONTHS - 1));
  const fetchFrom = period.prevFrom < barsFrom ? period.prevFrom : barsFrom;

  useEffect(() => {
    let cancelled = false;
    api.getExpenses(fetchFrom, period.to)
      .then((res) => { if (!cancelled) { setData(res.data); setError(''); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'No se pudieron cargar los gastos.'); });
    return () => { cancelled = true; };
  }, [fetchFrom, period.to]);

  useEffect(() => saveSet(EXCLUDED_KEY, excluded), [excluded]);
  useEffect(() => saveSet(EXCLUDED_ACCOUNTS_KEY, excludedAccounts), [excludedAccounts]);

  const accountIncluded = (m) => !excludedAccounts.has(m.account_id);

  const categoryInfo = useMemo(() => {
    const map = new Map([[NONE, NONE_CATEGORY]]);
    data?.categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [data]);

  const catKey = (m) => m.category_id ?? NONE;
  const infoOf = (key) => categoryInfo.get(key) || NONE_CATEGORY;

  // Movimientos tras filtrar por cuenta y por las categorías excluidas: base de todo lo demás
  const base = useMemo(() => {
    if (!data) return [];
    return data.movements.filter((m) =>
      !excludedAccounts.has(m.account_id) && !excluded.has(String(catKey(m)))
    );
  }, [data, excludedAccounts, excluded]);

  const matchesFocus = (m) => {
    if (!focus) return true;
    if (focus.type === 'category') return String(catKey(m)) === String(focus.key);
    if (focus.type === 'supra') return String(infoOf(catKey(m)).supra_id) === String(focus.key);
    return normalizeConcept(m.concept) === focus.key;
  };

  const inPeriod = base.filter((m) => m.date >= period.from && m.date <= period.to);
  const inPrev = base.filter((m) => m.date >= period.prevFrom && m.date <= period.prevTo);
  const focused = inPeriod.filter(matchesFocus);
  const total = sum(focused);
  const prevTotal = sum(inPrev.filter(matchesFocus));
  const days = daysBetween(period.from, period.to);

  const toggleFocus = (next) =>
    setFocus((cur) => (cur && cur.type === next.type && String(cur.key) === String(next.key) ? null : next));

  const pickMonth = (ym) => {
    setPreset('custom');
    setCustom({ from: `${ym}-01`, to: lastOfMonth(`${ym}-01`) });
  };

  const handleCategoryChange = async (movement, value) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.updateTransactionCategory(movement.account_id, movement.id, { category_id: categoryId });
      setData((d) => ({
        ...d,
        movements: d.movements
          .map((m) => (m.id === movement.id ? { ...m, category_id: categoryId } : m))
          // Si pasa a ser traspaso interno, o una devolución pasa a "Ingresos", deja de ser un gasto
          .filter((m) => {
            if (m.id !== movement.id || categoryId === null) return true;
            const role = categoryInfo.get(categoryId)?.role;
            return role !== 'transfer' && !(role === 'income' && m.amount < 0);
          }),
      }));
    } catch (err) {
      setError(err.message || 'No se pudo cambiar la categoría.');
    }
  };

  return (
    <div className="exp">
      <header className="exp-header">
        <h2>Gastos</h2>
        <div className="exp-filters">
          <div className="exp-presets" role="group" aria-label="Periodo">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={preset === p.id ? 'is-active' : ''} onClick={() => setPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="exp-range">
              <input type="date" value={custom.from} max={custom.to}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="Desde" />
              <span>→</span>
              <input type="date" value={custom.to} min={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="Hasta" />
            </div>
          )}
          <AccountPicker accounts={data?.accounts ?? []} excluded={excludedAccounts} setExcluded={setExcludedAccounts} />
        </div>
      </header>

      {error && <div className="exp-error"><AlertCircle size={16} /><span>{error}</span></div>}

      {!data ? (
        <div className="exp-loading">Cargando gastos…</div>
      ) : (
        <>
          {focus && (
            <div className="exp-focus">
              <span>Filtrando por <strong>{focus.label}</strong></span>
              <button type="button" onClick={() => setFocus(null)} aria-label="Quitar filtro"><X size={14} /></button>
            </div>
          )}

          <section className="exp-tiles">
            <Tile label="Total gastado" value={formatCurrency(total)} sub={`${formatDay(period.from)} – ${formatDay(period.to)}`} />
            <Tile
              label={days <= 31 ? 'Media diaria' : 'Media mensual'}
              value={formatCurrency(days <= 31 ? total / days : total / (days / 30.44))}
              sub={`${days} días`}
            />
            <Tile label="Vs periodo anterior" value={<Change current={total} previous={prevTotal} />}
              sub={`${formatCurrency(prevTotal)} del ${formatDay(period.prevFrom)} al ${formatDay(period.prevTo)}`} />
            <Tile label="Movimientos" value={focused.filter((m) => m.amount > 0).length}
              sub={`${focused.filter((m) => m.amount < 0).length} devoluciones`} />
          </section>

          <section className="exp-card glass-panel">
            <header className="exp-card-header">
              <h3>Gasto por mes</h3>
              <span className="exp-hint">Pulsa un mes para verlo</span>
            </header>
            <MonthlyBars movements={base.filter(matchesFocus)} barsFrom={barsFrom} to={period.to}
              period={period} onPick={pickMonth} />
          </section>

          <section className="exp-grid exp-grid-categories">
            <div className="exp-card glass-panel">
              <header className="exp-card-header">
                <h3>Por categoría</h3>
                <span className="exp-hint">Pulsa para filtrar</span>
              </header>
              <CategoryBreakdown movements={inPeriod} infoOf={infoOf} catKey={catKey} focus={focus} onFocus={toggleFocus} />
            </div>
            <CategoryPicker data={data} inPeriod={data.movements.filter((m) => m.date >= period.from && m.date <= period.to
              && accountIncluded(m))}
              excluded={excluded} setExcluded={setExcluded} catKey={catKey} />
          </section>

          <section className="exp-grid exp-grid-list">
            <div className="exp-card glass-panel">
              <header className="exp-card-header">
                <h3>Dónde más gastas</h3>
              </header>
              {/* Con un concepto seleccionado se siguen mostrando los demás para poder cambiar de uno a otro */}
              <TopConcepts movements={focus?.type === 'concept' ? inPeriod : focused}
                focus={focus} onFocus={toggleFocus} />
            </div>
            <MovementList movements={focused} search={search} setSearch={setSearch} categories={data.categories}
              accounts={data.accounts} infoOf={infoOf} catKey={catKey} onCategoryChange={handleCategoryChange} />
          </section>
        </>
      )}
    </div>
  );
}

const sum = (list) => Math.round(list.reduce((acc, m) => acc + m.amount, 0) * 100) / 100;
const normalizeConcept = (c) => c.replace(/\s+/g, ' ').trim().toLowerCase();

function Tile({ label, value, sub }) {
  return (
    <div className="exp-tile glass-panel">
      <span className="exp-tile-label">{label}</span>
      <span className="exp-tile-value">{value}</span>
      {sub && <span className="exp-tile-sub">{sub}</span>}
    </div>
  );
}

function Change({ current, previous }) {
  if (!previous) return <span className="exp-change">—</span>;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  // Gastar más es malo
  return (
    <span className={`exp-change ${up ? 'is-bad' : 'is-good'}`}>
      <Icon size={20} /> {up ? '+' : ''}{pct.toLocaleString('es-ES', { maximumFractionDigits: 0 })} %
    </span>
  );
}

// ---------- Selección de cuentas ----------

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
  const label = included.length === accounts.length ? 'Todas las cuentas corrientes'
    : included.length === 0 ? 'Ninguna cuenta'
    : included.length === 1 ? included[0].name
    : `${included.length} cuentas`;

  const toggle = (id, include) => setExcluded((cur) => {
    const next = new Set(cur);
    if (include) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="exp-accounts" ref={ref}>
      <button type="button" className={`exp-accounts-btn ${included.length < accounts.length ? 'is-filtered' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <Wallet size={14} />
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="exp-accounts-pop glass-panel" role="group" aria-label="Cuentas incluidas">
          <div className="exp-picker-actions">
            <button type="button" onClick={() => setExcluded(new Set())}>Todas</button>
            <button type="button" onClick={() => setExcluded(new Set(accounts.map((a) => a.id)))}>Ninguna</button>
          </div>
          {accounts.map((a) => (
            <label key={a.id} className="exp-check">
              <input type="checkbox" checked={!excluded.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
              <span className="exp-check-name">{a.name}</span>
              <span className="exp-check-total">{formatCurrency(a.balance)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Gasto por mes ----------

const BAR_HEIGHT = 200;
const BAR_PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= v);
}

function MonthlyBars({ movements, barsFrom, to, period, onPick }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const months = [];
  for (let i = 0; i < BAR_MONTHS; i++) months.push(firstOfMonth(barsFrom, i).slice(0, 7));
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  movements.forEach((m) => {
    const ym = m.date.slice(0, 7);
    if (ym in totals && m.date <= to) totals[ym] += m.amount;
  });
  const values = months.map((m) => Math.max(0, totals[m]));
  const max = niceMax(Math.max(...values));
  const ticks = [0, max / 2, max];

  const innerW = Math.max(0, width - BAR_PAD.left - BAR_PAD.right);
  const innerH = BAR_HEIGHT - BAR_PAD.top - BAR_PAD.bottom;
  const slot = innerW / months.length;
  const barW = Math.max(4, Math.min(36, slot - 6));
  const y = (v) => BAR_PAD.top + innerH - (v / max) * innerH;
  const inPeriod = (ym) => ym >= period.from.slice(0, 7) && ym <= period.to.slice(0, 7);

  return (
    <div className="exp-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={BAR_HEIGHT} role="img" aria-label="Gasto por mes en los últimos 12 meses">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={BAR_PAD.left} x2={width - BAR_PAD.right} y1={y(t)} y2={y(t)} className="exp-grid-line" />
              <text x={BAR_PAD.left - 8} y={y(t)} className="exp-axis" textAnchor="end" dominantBaseline="middle">{formatCompact(t)}</text>
            </g>
          ))}
          {months.map((ym, i) => {
            const cx = BAR_PAD.left + slot * i + slot / 2;
            const v = values[i];
            const top = y(v);
            const h = BAR_PAD.top + innerH - top;
            return (
              <g key={ym} className="exp-bar-group" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => onPick(ym)}>
                <rect x={cx - slot / 2} y={BAR_PAD.top} width={slot} height={innerH} fill="transparent" />
                {h > 0 && (
                  <path
                    className={`exp-bar ${inPeriod(ym) ? 'is-selected' : ''} ${hover === i ? 'is-hover' : ''}`}
                    d={roundedTop(cx - barW / 2, top, barW, h, Math.min(4, h))}
                  />
                )}
                <text x={cx} y={BAR_HEIGHT - 8} className="exp-axis" textAnchor="middle">
                  {slot < 40 && i % 2 ? '' : monthLabel(ym)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="exp-tooltip" style={{
          left: Math.min(Math.max(BAR_PAD.left + slot * hover + slot / 2, 60), width - 60),
          top: Math.max(0, y(values[hover]) - 52),
        }}>
          <span>{fromIso(`${months[hover]}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</span>
          <strong>{formatCurrency(totals[months[hover]])}</strong>
        </div>
      )}
    </div>
  );
}

/** Rectángulo con las esquinas superiores redondeadas y la base recta sobre el eje. */
function roundedTop(x, y, w, h, r) {
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

// ---------- Por categoría: donut de grupos + desglose ----------

function groupBySupra(movements, infoOf, catKey) {
  const supras = new Map();
  movements.forEach((m) => {
    const key = catKey(m);
    const info = infoOf(key);
    if (!supras.has(info.supra_id)) {
      supras.set(info.supra_id, { id: info.supra_id, name: info.supra_name, color: info.supra_color, total: 0, categories: new Map() });
    }
    const s = supras.get(info.supra_id);
    s.total += m.amount;
    const c = s.categories.get(key) || { key, name: info.name, color: info.color, total: 0 };
    c.total += m.amount;
    s.categories.set(key, c);
  });
  return [...supras.values()]
    .map((s) => ({ ...s, categories: [...s.categories.values()].filter((c) => c.total > 0.004).sort((a, b) => b.total - a.total) }))
    .filter((s) => s.total > 0.004)
    .sort((a, b) => b.total - a.total);
}

function CategoryBreakdown({ movements, infoOf, catKey, focus, onFocus }) {
  const [open, setOpen] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const groups = groupBySupra(movements, infoOf, catKey);
  const total = groups.reduce((a, g) => a + g.total, 0);

  if (groups.length === 0) return <p className="exp-empty">No hay gastos en este periodo.</p>;

  const toggleOpen = (id) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const isFocused = (type, key) => focus && focus.type === type && String(focus.key) === String(key);

  return (
    <div className="exp-breakdown">
      <Donut groups={groups} total={total} hover={hover} setHover={setHover}
        onPick={(g) => onFocus({ type: 'supra', key: g.id, label: g.name })} focus={focus} />
      <ul className="exp-tree">
        {groups.map((g) => (
          <li key={g.id} className={hover !== null && hover !== g.id ? 'is-dimmed' : ''}
            onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}>
            <div className={`exp-tree-row is-group ${isFocused('supra', g.id) ? 'is-focused' : ''}`}>
              <button type="button" className="exp-tree-toggle" onClick={() => toggleOpen(g.id)}
                aria-label={open.has(g.id) ? 'Plegar' : 'Desplegar'} aria-expanded={open.has(g.id)}>
                {open.has(g.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button type="button" className="exp-tree-main" onClick={() => onFocus({ type: 'supra', key: g.id, label: g.name })}>
                <span className="exp-swatch" style={{ background: g.color }} />
                <span className="exp-tree-name">{g.name}</span>
                <span className="exp-tree-bar"><span style={{ width: `${(g.total / groups[0].total) * 100}%` }} /></span>
                <span className="exp-tree-value">{formatCurrency(g.total)}</span>
                <span className="exp-tree-pct">{formatPct(Math.round((g.total / total) * 1000) / 10)}</span>
              </button>
            </div>
            {open.has(g.id) && (
              <ul>
                {g.categories.map((c) => (
                  <li key={c.key}>
                    <button type="button" className={`exp-tree-row exp-tree-main is-child ${isFocused('category', c.key) ? 'is-focused' : ''}`}
                      onClick={() => onFocus({ type: 'category', key: c.key, label: c.name })}>
                      <span className="exp-dot" style={{ background: c.color }} />
                      <span className="exp-tree-name">{c.name}</span>
                      <span className="exp-tree-bar"><span style={{ width: `${(c.total / groups[0].total) * 100}%` }} /></span>
                      <span className="exp-tree-value">{formatCurrency(c.total)}</span>
                      <span className="exp-tree-pct">{formatPct(Math.round((c.total / total) * 1000) / 10)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const DONUT = 180;
const RING = 26;

function Donut({ groups, total, hover, setHover, onPick, focus }) {
  const r = DONUT / 2 - RING / 2 - 2;
  const c = 2 * Math.PI * r;
  const active = groups.find((g) => g.id === hover);
  const offsets = groups.reduce((acc, g, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (groups[i - 1].total / total) * c], []);
  return (
    <div className="exp-donut">
      <svg width={DONUT} height={DONUT} viewBox={`0 0 ${DONUT} ${DONUT}`} role="img" aria-label="Reparto del gasto por grupo de categorías">
        <g transform={`rotate(-90 ${DONUT / 2} ${DONUT / 2})`}>
          {groups.map((g, i) => {
            const len = (g.total / total) * c;
            const gap = groups.length > 1 ? Math.min(2, len / 2) : 0;
            const seg = (
              <circle key={g.id} cx={DONUT / 2} cy={DONUT / 2} r={r} fill="none" stroke={g.color} strokeWidth={RING}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offsets[i]}
                className={`exp-donut-seg ${hover !== null && hover !== g.id ? 'is-dimmed' : ''} ${focus?.type === 'supra' && String(focus.key) === String(g.id) ? 'is-focused' : ''}`}
                onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)} onClick={() => onPick(g)}>
                <title>{`${g.name}: ${formatCurrency(g.total)}`}</title>
              </circle>
            );
            return seg;
          })}
        </g>
      </svg>
      <div className="exp-donut-center">
        <span>{active ? active.name : 'Total'}</span>
        <strong>{formatCurrency(active ? active.total : total)}</strong>
        {active && <span>{formatPct(Math.round((active.total / total) * 1000) / 10)}</span>}
      </div>
    </div>
  );
}

// ---------- Selección de categorías incluidas ----------

function CategoryPicker({ data, inPeriod, excluded, setExcluded, catKey }) {
  const totals = new Map();
  inPeriod.forEach((m) => totals.set(String(catKey(m)), (totals.get(String(catKey(m))) || 0) + m.amount));

  // Categorías que pueden tener gastos: todas menos las de traspasos e ingresos, más "Sin categoría"
  const groups = new Map();
  [...data.categories.filter((c) => !c.role), { id: NONE, ...NONE_CATEGORY }].forEach((c) => {
    if (!groups.has(c.supra_id)) groups.set(c.supra_id, { id: c.supra_id, name: c.supra_name, color: c.supra_color, items: [] });
    groups.get(c.supra_id).items.push({ key: String(c.id), name: c.name, color: c.color, total: totals.get(String(c.id)) || 0 });
  });
  const list = [...groups.values()].sort((a, b) => (a.id === NONE) - (b.id === NONE) || a.name.localeCompare(b.name, 'es'));
  const allKeys = list.flatMap((g) => g.items.map((i) => i.key));

  const setMany = (keys, include) => setExcluded((cur) => {
    const next = new Set(cur);
    keys.forEach((k) => (include ? next.delete(k) : next.add(k)));
    return next;
  });

  return (
    <div className="exp-card glass-panel exp-picker">
      <header className="exp-card-header">
        <h3>Categorías incluidas</h3>
        <div className="exp-picker-actions">
          <button type="button" onClick={() => setMany(allKeys, true)}>Todas</button>
          <button type="button" onClick={() => setMany(allKeys, false)}>Ninguna</button>
        </div>
      </header>
      <span className="exp-hint">
        {excluded.size === 0 ? 'Se incluyen todas en totales y gráficos' : `${excluded.size} excluidas de totales y gráficos`}
      </span>
      <div className="exp-picker-list">
        {list.map((g) => {
          const keys = g.items.map((i) => i.key);
          const included = keys.filter((k) => !excluded.has(k)).length;
          return (
            <div key={g.id} className="exp-picker-group">
              <label className="exp-check is-group">
                <input type="checkbox" checked={included === keys.length}
                  ref={(el) => { if (el) el.indeterminate = included > 0 && included < keys.length; }}
                  onChange={(e) => setMany(keys, e.target.checked)} />
                <span className="exp-swatch" style={{ background: g.color }} />
                <span className="exp-check-name">{g.name}</span>
              </label>
              {g.items.length > 1 || g.id !== NONE ? g.items.map((i) => (
                <label key={i.key} className={`exp-check is-child ${i.total === 0 ? 'is-empty' : ''}`}>
                  <input type="checkbox" checked={!excluded.has(i.key)} onChange={(e) => setMany([i.key], e.target.checked)} />
                  <span className="exp-dot" style={{ background: i.color }} />
                  <span className="exp-check-name">{i.name}</span>
                  <span className="exp-check-total">{i.total ? formatCurrency(i.total) : ''}</span>
                </label>
              )) : null}
            </div>
          );
        })}
      </div>
      {excluded.size > 0 && (
        <button type="button" className="exp-reset" onClick={() => setExcluded(new Set())}>
          <RotateCcw size={13} /> Volver a incluir todas
        </button>
      )}
    </div>
  );
}

// ---------- Dónde más gastas ----------

function TopConcepts({ movements, focus, onFocus }) {
  const groups = new Map();
  movements.forEach((m) => {
    const key = normalizeConcept(m.concept);
    const g = groups.get(key) || { key, label: m.concept, total: 0, count: 0 };
    g.total += m.amount;
    if (m.amount > 0) g.count++;
    groups.set(key, g);
  });
  const top = [...groups.values()].filter((g) => g.total > 0.004).sort((a, b) => b.total - a.total).slice(0, TOP_CONCEPTS);
  if (top.length === 0) return <p className="exp-empty">Sin gastos.</p>;
  return (
    <ol className="exp-concepts">
      {top.map((g) => (
        <li key={g.key}>
          <button type="button" className={focus?.type === 'concept' && focus.key === g.key ? 'is-focused' : ''}
            onClick={() => onFocus({ type: 'concept', key: g.key, label: g.label })} title={g.label}>
            <span className="exp-concept-name">{g.label}</span>
            <span className="exp-concept-count">{g.count}×</span>
            <span className="exp-concept-total">{formatCurrency(g.total)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---------- Listado de movimientos ----------

function MovementList({ movements, search, setSearch, categories, accounts, infoOf, catKey, onCategoryChange }) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const q = search.trim().toLowerCase();
  const rows = q ? movements.filter((m) => m.concept.toLowerCase().includes(q)) : movements;
  const accountName = (id) => accounts.find((a) => a.id === id)?.name ?? '';
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return (
    <div className="exp-card glass-panel exp-list-card">
      <header className="exp-card-header">
        <h3>Movimientos <span className="exp-hint">({rows.length})</span></h3>
        <label className="exp-search">
          <Search size={14} />
          <input type="search" placeholder="Buscar concepto" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(LIST_PAGE); }} />
        </label>
      </header>
      {rows.length === 0 ? (
        <p className="exp-empty">No hay movimientos.</p>
      ) : (
        <div className="exp-table-wrap">
          <table className="exp-table">
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th className="num">Importe</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((m) => (
                <tr key={m.id}>
                  <td className="exp-date">{formatDay(m.date)}</td>
                  <td className="exp-concept">
                    <span title={m.concept}>{m.concept}</span>
                    <small>{accountName(m.account_id)}</small>
                  </td>
                  <td>
                    <span className="exp-cat-select-wrap">
                      <span className="exp-dot" style={{ background: infoOf(catKey(m)).color }} />
                      <select className="exp-cat-select" value={m.category_id ?? ''} onChange={(e) => onCategoryChange(m, e.target.value)}
                        aria-label={`Categoría de ${m.concept}`}>
                        <option value="">Sin categoría</option>
                        {sortedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </span>
                  </td>
                  <td className={`num ${m.amount < 0 ? 'is-refund' : ''}`}>
                    {m.amount < 0 ? `+${formatCurrency(-m.amount)}` : `-${formatCurrency(m.amount)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <button type="button" className="exp-more" onClick={() => setLimit((l) => l + LIST_PAGE)}>
              Mostrar más ({rows.length - limit} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
