import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '../services/api';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact } from '../utils/format';
import './BalanceView.css';
import './ProjectionView.css';

// Filas especiales (mismas claves que usa la API): todos los ingresos y los gastos sin categoría
const INCOME = 0;
const NONE = -1;
const HORIZONS = [1, 2, 3, 5, 10];

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });
const fmt = (v) => (Math.abs(v) < 0.5 ? '' : numFmt.format(v));
const round2 = (v) => Math.round(v * 100) / 100;
const cellId = (y, m, k) => `${y}-${m}-${k}`;
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''));
const tone = (v) => (v > 0.004 ? 'is-good' : v < -0.004 ? 'is-bad' : '');

// ---------- Vista ----------

export default function ProjectionView() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [overrides, setOverrides] = useState(() => new Map());
  const [year, setYear] = useState(null);
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getProjection()
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setData(d);
        setSettings(d.settings);
        setYear(d.year);
        setOverrides(new Map(d.overrides.map((o) => [cellId(o.year, o.month, o.category_id), { amount: o.amount, oneoff: o.oneoff }])));
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'No se pudo cargar la proyección.'); });
    return () => { cancelled = true; };
  }, []);

  const model = useMemo(() => (data && settings ? project(data, settings, overrides) : null), [data, settings, overrides]);

  const updateSettings = (patch) => {
    const prev = settings;
    setSettings({ ...settings, ...patch });
    if (patch.years !== undefined && year > data.year + patch.years) setYear(data.year);
    api.updateProjectionSettings(patch).catch((err) => {
      setSettings(prev);
      setError(err.message || 'No se pudieron guardar los ajustes.');
    });
  };

  const saveCell = (y, m, k, next) => {
    const id = cellId(y, m, k);
    const prev = overrides.get(id);
    const apply = (value) => setOverrides((cur) => {
      const map = new Map(cur);
      if (value) map.set(id, value); else map.delete(id);
      return map;
    });
    apply(next);
    api.saveProjectionCell({ year: y, month: m, category_id: k, amount: next ? next.amount : null, oneoff: next?.oneoff ?? false })
      .catch((err) => { apply(prev); setError(err.message || 'No se pudo guardar la celda.'); });
  };

  const resetAll = () => {
    if (!window.confirm('¿Borrar todos los cambios hechos a mano? La proyección volverá a los valores calculados.')) return;
    const prev = overrides;
    setOverrides(new Map());
    api.resetProjection().catch((err) => { setOverrides(prev); setError(err.message || 'No se pudo restablecer.'); });
  };

  const toggleGroup = (id) => setOpenGroups((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const editedCount = model ? [...overrides.keys()].filter((id) => Number(id.split('-')[0]) <= model.lastYear).length : 0;

  return (
    <div className="bal prj">
      <header className="bal-header">
        <h2>Proyección</h2>
        {settings && (
          <div className="prj-settings">
            <label className="prj-setting">
              <span>Horizonte</span>
              <select value={settings.years} onChange={(e) => updateSettings({ years: Number(e.target.value) })}>
                {HORIZONS.map((n) => <option key={n} value={n}>+{n} {n === 1 ? 'año' : 'años'}</option>)}
              </select>
            </label>
            <PctInput key={`i${settings.inflation}`} label="Inflación" value={settings.inflation}
              onCommit={(v) => updateSettings({ inflation: v })} />
            <PctInput key={`g${settings.income_growth}`} label="Subida ingresos" value={settings.income_growth}
              onCommit={(v) => updateSettings({ income_growth: v })} />
            {model?.hasInvest && (
              <PctInput key={`r${settings.investment_return}`} label="Rentab. inversión" value={settings.investment_return}
                onCommit={(v) => updateSettings({ investment_return: v })}
                suggestion={data.suggested_investment_return} suggestionLabel="Usar mi TIR" />
            )}
          </div>
        )}
      </header>

      {error && (
        <div className="bal-error">
          <AlertCircle size={16} /><span>{error}</span>
          <button type="button" className="prj-error-close" onClick={() => setError('')} aria-label="Cerrar">×</button>
        </div>
      )}

      {!model ? (
        !error && <div className="bal-loading">Cargando proyección…</div>
      ) : (
        <>
          <YearStrip model={model} year={year} onPick={setYear} />

          <section className="bal-card glass-panel">
            <header className="bal-card-header">
              <h3>{model.hasInvest ? 'Saldo y patrimonio' : 'Saldo'} previstos</h3>
              <div className="bal-legend">
                <span><i className="bal-key is-line" />Saldo</span>
                {model.hasInvest && <span><i className="bal-key prj-key-worth" />Patrimonio</span>}
                <span><i className="prj-key-dash" />Previsto</span>
              </div>
            </header>
            <ProjectionChart model={model} year={year} onPick={setYear} />
          </section>

          <section className="bal-card glass-panel">
            <header className="bal-card-header">
              <h3>{year} mes a mes</h3>
              <div className="prj-table-tools">
                <div className="prj-legend">
                  <span><i className="prj-swatch is-real" />Real</span>
                  <span><i className="prj-swatch is-calc" />{year === model.year ? 'Copiado de ' + (year - 1) : 'Calculado'}</span>
                  <span><i className="prj-swatch is-edit" />Editado</span>
                  <span><i className="prj-swatch is-oneoff" />Puntual</span>
                </div>
                {editedCount > 0 && (
                  <button type="button" className="prj-reset" onClick={resetAll}>
                    <RotateCcw size={13} /> Restablecer {editedCount === 1 ? '1 cambio' : `${editedCount} cambios`}
                  </button>
                )}
              </div>
            </header>
            <YearTable model={model} year={year} openGroups={openGroups} onToggleGroup={toggleGroup}
              onEdit={setEditing} />
            <p className="bal-hint">
              Pulsa una celda para cambiarla. Los cambios se arrastran a los años siguientes, salvo los marcados como puntuales.
            </p>
          </section>
        </>
      )}

      {editing && model && (
        <CellEditor key={cellId(editing.y, editing.m, editing.k)} target={editing} model={model}
          onClose={() => setEditing(null)}
          onSave={(next) => { saveCell(editing.y, editing.m, editing.k, next); setEditing(null); }} />
      )}
    </div>
  );
}

// ---------- Cálculos ----------

/**
 * Calcula todas las celdas y saldos del horizonte:
 *  - Año en curso: meses cerrados con los datos reales, el mes en curso con lo real hasta hoy y los siguientes
 *    copiados del mismo mes del año anterior.
 *  - Años siguientes: el mismo mes del año anterior con la inflación (gastos) o la subida (ingresos).
 * Una celda editada sustituye al valor calculado y se arrastra a los años siguientes, salvo que sea puntual.
 */
function project(data, settings, overrides) {
  const cur = data.year;
  const curMonth = Number(data.today.slice(5, 7));
  const lastYear = cur + settings.years;
  const known = new Set(data.categories.map((c) => c.id));
  const rowKey = (k) => (k === INCOME || known.has(k) ? k : NONE); // categorías desactivadas → sin categoría

  const real = new Map();
  Object.entries(data.real).forEach(([y, months]) => Object.entries(months).forEach(([m, cellsOfMonth]) =>
    Object.entries(cellsOfMonth).forEach(([k, v]) => {
      const id = cellId(Number(y), Number(m), rowKey(Number(k)));
      real.set(id, round2((real.get(id) ?? 0) + v));
    })));
  const realAt = (y, m, k) => real.get(cellId(y, m, k)) ?? 0;

  const keys = [INCOME, ...data.categories.map((c) => c.id), NONE];
  const factor = (k) => 1 + (k === INCOME ? settings.income_growth : settings.inflation) / 100;
  const monthlyReturn = (1 + settings.investment_return / 100) ** (1 / 12);
  const hasInvest = data.investments !== null;

  const years = [];
  let carry = null; // valor que hereda el año siguiente, por fila
  let liquid = data.liquid[0];
  let invest = hasInvest ? data.investments[0] : 0;

  for (let y = cur; y <= lastYear; y++) {
    const rows = new Map();
    const nextCarry = new Map();
    keys.forEach((k) => {
      const row = [];
      const carried = [];
      for (let m = 1; m <= 12; m++) {
        const locked = y === cur && m < curMonth;
        let inherited;
        let source;
        if (y === cur) {
          inherited = m <= curMonth ? realAt(cur, m, k) : realAt(cur - 1, m, k);
          source = locked ? 'real' : m === curMonth ? 'current' : 'calc';
        } else {
          inherited = round2(carry.get(k)[m - 1] * factor(k));
          source = 'calc';
        }
        const ov = locked ? null : overrides.get(cellId(y, m, k));
        const value = ov ? ov.amount : inherited;
        row.push({ value, inherited, locked, source: ov ? (ov.oneoff ? 'oneoff' : 'edit') : source });
        carried.push(ov?.oneoff ? inherited : value);
      }
      rows.set(k, row);
      nextCarry.set(k, carried);
    });
    carry = nextCarry;

    const months = [];
    const opening = liquid;
    for (let m = 1; m <= 12; m++) {
      const start = liquid;
      const income = rows.get(INCOME)[m - 1].value;
      const net = round2(keys.reduce((s, k) => s + rows.get(k)[m - 1].value, 0));
      const closed = y === cur && m < curMonth;
      liquid = closed ? data.liquid[m] : round2(liquid + net);
      if (hasInvest) {
        invest = closed ? data.investments[m]
          : y === cur && m === curMonth ? data.investments[data.investments.length - 1]
          : invest * monthlyReturn;
      }
      months.push({ m, start, income, expense: round2(income - net), net, liquid, worth: round2(liquid + invest), real: closed });
    }
    const sum = (f) => round2(months.reduce((s, x) => s + x[f], 0));
    years.push({
      year: y, rows, months, opening,
      income: sum('income'), expense: sum('expense'), net: sum('net'),
      closing: liquid, worth: months[11].worth,
    });
  }

  // Grupos de la tabla: las categorías de cada supracategoría, y "sin categoría" solo si tiene algo
  const groupMap = new Map();
  data.categories.forEach((c) => {
    if (!groupMap.has(c.supra_id)) groupMap.set(c.supra_id, { id: c.supra_id, name: c.supra_name, color: c.supra_color, items: [] });
    groupMap.get(c.supra_id).items.push({ key: c.id, name: c.name, color: c.color });
  });
  const groups = [...groupMap.values()];
  const hasNone = years.some((yr) => yr.rows.get(NONE).some((c) => Math.abs(c.value) >= 0.005));

  return { year: cur, curMonth, lastYear, years, groups, hasNone, hasInvest };
}

// ---------- Ajustes ----------

function PctInput({ label, value, onCommit, suggestion = null, suggestionLabel }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  const commit = () => {
    const v = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(v) || Math.abs(v) > 100) { setText(String(value).replace('.', ',')); return; }
    if (round2(v) !== value) onCommit(round2(v));
  };
  return (
    <label className="prj-setting">
      <span>{label}</span>
      <span className="prj-pct">
        <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <i>%</i>
      </span>
      {suggestion !== null && round2(suggestion) !== value && (
        <button type="button" className="prj-suggest" onClick={() => onCommit(round2(suggestion))}
          title="Rentabilidad anual real de tu cartera (TIR), calculada en Inversiones">
          {suggestionLabel}: {suggestion.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %
        </button>
      )}
    </label>
  );
}

// ---------- Resumen por año ----------

function YearStrip({ model, year, onPick }) {
  return (
    <div className="prj-years" role="tablist" aria-label="Año">
      {model.years.map((yr) => (
        <button key={yr.year} type="button" role="tab" aria-selected={yr.year === year}
          className={`prj-year glass-panel ${yr.year === year ? 'is-active' : ''}`} onClick={() => onPick(yr.year)}>
          <span className="prj-year-label">{yr.year}{yr.year === model.year && <small> · en curso</small>}</span>
          <span className="prj-year-value">{formatCurrency(model.hasInvest ? yr.worth : yr.closing)}</span>
          <span className="prj-year-sub">
            <span className={tone(yr.net)}>{yr.net > 0 ? '+' : ''}{formatCurrency(yr.net)}</span> en el año
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- Gráfico ----------

const CHART_HEIGHT = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 56 };

function niceStep(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= v);
}

function ProjectionChart({ model, year, onPick }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const points = model.years.flatMap((yr) => yr.months.map((mo) => ({ ...mo, year: yr.year })));
  const values = points.flatMap((p) => (model.hasInvest ? [p.liquid, p.worth] : [p.liquid]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = niceStep(Math.max(max - min, Math.abs(max) * 0.1, 1) / 3);
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);

  const compact = width < 520;
  const pad = compact ? { ...PAD, left: 44 } : PAD;
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = CHART_HEIGHT - pad.top - pad.bottom;
  const slot = innerW / points.length;
  const x = (i) => pad.left + slot * i + slot / 2;
  const yv = (v) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const lastReal = points.findLastIndex((p) => p.real);

  const path = (field, from, to) => points.slice(from, to + 1)
    .map((p, i) => `${i ? 'L' : 'M'}${x(from + i)},${yv(p[field])}`).join(' ');
  const lines = (field, cls) => (
    <>
      {lastReal > 0 && <path d={path(field, 0, lastReal)} className={`prj-line ${cls}`} />}
      <path d={path(field, Math.max(lastReal, 0), points.length - 1)} className={`prj-line ${cls} is-projected`} />
    </>
  );

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - pad.left) / slot);
    return i >= 0 && i < points.length ? i : null;
  };
  const h = hover !== null ? points[hover] : null;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => i / Math.round((hi - lo) / step));

  return (
    <div className="bal-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={CHART_HEIGHT} role="img" aria-label="Evolución prevista del saldo"
          onMouseMove={(e) => setHover(pick(e))} onMouseLeave={() => setHover(null)}
          onClick={(e) => { const i = pick(e); if (i !== null) onPick(points[i].year); }}>
          {model.years.map((yr, yi) => (
            <g key={yr.year}>
              <rect x={pad.left + slot * 12 * yi} y={pad.top} width={slot * 12} height={innerH}
                className={`prj-band ${yr.year === year ? 'is-active' : ''}`} />
              {yi > 0 && <line x1={pad.left + slot * 12 * yi} x2={pad.left + slot * 12 * yi} y1={pad.top} y2={pad.top + innerH} className="prj-year-sep" />}
              <text x={pad.left + slot * 12 * (yi + 0.5)} y={CHART_HEIGHT - 8} textAnchor="middle"
                className={`bal-axis ${yr.year === year ? 'prj-axis-active' : ''}`}>
                {yr.year}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH * (1 - t)} y2={pad.top + innerH * (1 - t)} className="bal-grid-line" />
              <text x={pad.left - 8} y={pad.top + innerH * (1 - t)} className="bal-axis" textAnchor="end" dominantBaseline="middle">
                {formatCompact(lo + (hi - lo) * t)}
              </text>
            </g>
          ))}
          {model.hasInvest && lines('worth', 'is-worth')}
          {lines('liquid', 'is-liquid')}
          {h && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} className="prj-cursor" />
              <circle cx={x(hover)} cy={yv(h.liquid)} r={3.5} className="bal-point" />
              {model.hasInvest && <circle cx={x(hover)} cy={yv(h.worth)} r={3.5} className="bal-point prj-point-worth" />}
            </>
          )}
        </svg>
      )}
      {h && width > 0 && (
        <div className="bal-tooltip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: 0 }}>
          <span className="bal-tooltip-title">{MONTHS[h.m - 1]} {h.year}{h.real ? '' : ' · previsto'}</span>
          <span className="bal-tooltip-row">Resultado<strong className={tone(h.net)}>{formatCurrency(h.net)}</strong></span>
          <span className="bal-tooltip-row"><i className="bal-key is-line" />Saldo<strong>{formatCurrency(h.liquid)}</strong></span>
          {model.hasInvest && (
            <span className="bal-tooltip-row"><i className="bal-key prj-key-worth" />Patrimonio<strong>{formatCurrency(h.worth)}</strong></span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Tabla ----------

/** Importe tal como se muestra: los gastos en positivo (una devolución neta queda en negativo). */
const shown = (k, v) => (k === INCOME ? v : -v);

function YearTable({ model, year, openGroups, onToggleGroup, onEdit }) {
  const yr = model.years.find((y) => y.year === year);
  const isCurrent = year === model.year;
  const rowTotal = (k) => yr.rows.get(k).reduce((s, c) => s + c.value, 0);
  const editTarget = (k, name) => (m, anchor) => onEdit({ y: year, m, k, name, anchor: anchor.getBoundingClientRect() });

  return (
    <div className="bal-table-wrap prj-table-wrap">
      <table className="bal-table prj-table">
        <thead>
          <tr>
            <th>Concepto</th>
            {MONTHS.map((name, i) => (
              <th key={name} className={`num ${isCurrent && i + 1 < model.curMonth ? 'is-real' : ''} ${isCurrent && i + 1 === model.curMonth ? 'is-current' : ''}`}>
                {name}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="prj-balance">
            <td>Saldo inicial</td>
            {yr.months.map((mo) => <td key={mo.m} className="num">{fmt(mo.start)}</td>)}
            <td />
          </tr>
          <EditableRow k={INCOME} name="Ingresos" className="prj-income" cells={yr.rows.get(INCOME)}
            total={rowTotal(INCOME)} onEdit={editTarget(INCOME, 'Ingresos')} />
          {model.groups.map((g) => {
            const open = openGroups.has(g.id);
            const sums = yr.months.map((_, i) => g.items.reduce((s, it) => s + yr.rows.get(it.key)[i].value, 0));
            const edited = g.items.some((it) => yr.rows.get(it.key).some((c) => c.source === 'edit' || c.source === 'oneoff'));
            return (
              <Fragment key={g.id}>
                <tr className={`prj-group ${open ? 'is-open' : ''}`} onClick={() => onToggleGroup(g.id)} tabIndex={0} aria-expanded={open}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleGroup(g.id); } }}>
                  <td>
                    <span className="prj-concept">
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="bal-swatch" style={{ background: g.color }} />
                      <span className="prj-name">{g.name}</span>
                      {edited && <i className="prj-mark is-edit" title="Tiene celdas editadas" />}
                    </span>
                  </td>
                  {sums.map((v, i) => (
                    <td key={i} className={`num ${isCurrent && i + 1 < model.curMonth ? 'prj-dim' : ''}`}>{fmt(-v)}</td>
                  ))}
                  <td className="num prj-total">{fmt(-sums.reduce((s, v) => s + v, 0))}</td>
                </tr>
                {open && g.items.map((it) => (
                  <EditableRow key={it.key} k={it.key} name={it.name} color={it.color} child cells={yr.rows.get(it.key)}
                    total={rowTotal(it.key)} onEdit={editTarget(it.key, it.name)} />
                ))}
              </Fragment>
            );
          })}
          {model.hasNone && (
            <EditableRow k={NONE} name="Sin categoría" cells={yr.rows.get(NONE)} total={rowTotal(NONE)}
              onEdit={editTarget(NONE, 'Sin categoría')} />
          )}
        </tbody>
        <tfoot>
          <tr className="prj-sum">
            <td>Total gastos</td>
            {yr.months.map((mo) => <td key={mo.m} className="num">{fmt(mo.expense)}</td>)}
            <td className="num">{fmt(yr.expense)}</td>
          </tr>
          <tr className="prj-sum">
            <td>Resultado</td>
            {yr.months.map((mo) => <td key={mo.m} className={`num ${tone(mo.net)}`}>{fmt(mo.net) || '0'}</td>)}
            <td className={`num ${tone(yr.net)}`}>{fmt(yr.net) || '0'}</td>
          </tr>
          <tr className="prj-sum prj-closing">
            <td>Saldo final</td>
            {yr.months.map((mo) => <td key={mo.m} className="num">{fmt(mo.liquid)}</td>)}
            <td className="num">{fmt(yr.closing)}</td>
          </tr>
          {model.hasInvest && (
            <tr className="prj-sum prj-worth">
              <td>Patrimonio</td>
              {yr.months.map((mo) => <td key={mo.m} className="num">{fmt(mo.worth)}</td>)}
              <td className="num">{fmt(yr.worth)}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

const SOURCE_TITLE = {
  real: 'Dato real',
  current: 'Mes en curso: real hasta hoy',
  calc: 'Calculado',
  edit: 'Editado',
  oneoff: 'Puntual: no se repite los años siguientes',
};

function EditableRow({ k, name, color, cells, total, onEdit, className = '', child = false }) {
  return (
    <tr className={`prj-row ${child ? 'is-child' : ''} ${className}`}>
      <td>
        <span className="prj-concept">
          {color && <span className="bal-dot" style={{ background: color }} />}
          <span className="prj-name" title={name}>{name}</span>
        </span>
      </td>
      {cells.map((c, i) => {
        const text = fmt(shown(k, c.value));
        const title = c.source === 'edit' || c.source === 'oneoff'
          ? `${SOURCE_TITLE[c.source]} · calculado: ${fmt(shown(k, c.inherited)) || '0'}`
          : SOURCE_TITLE[c.source];
        return (
          <td key={i} className={`num prj-cell is-${c.source}`}>
            {c.locked ? <span title={title}>{text}</span> : (
              <button type="button" title={title} onClick={(e) => onEdit(i + 1, e.currentTarget)}
                aria-label={`${name}, ${MONTHS[i]}: ${text || '0'}`}>
                {text || <span className="prj-empty">·</span>}
              </button>
            )}
          </td>
        );
      })}
      <td className="num prj-total">{fmt(shown(k, total))}</td>
    </tr>
  );
}

// ---------- Editor de celda ----------

const EDITOR_WIDTH = 270;

function CellEditor({ target, model, onClose, onSave }) {
  const { y, m, k, name, anchor } = target;
  const cell = model.years.find((yr) => yr.year === y).rows.get(k)[m - 1];
  const overridden = cell.source === 'edit' || cell.source === 'oneoff';
  const [text, setText] = useState(String(round2(shown(k, cell.value))).replace('.', ','));
  const [oneoff, setOneoff] = useState(cell.source === 'oneoff');
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Debajo de la celda si cabe; si no, encima
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 200;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - EDITOR_WIDTH / 2, 8), window.innerWidth - EDITOR_WIDTH - 8);
    const top = anchor.bottom + 6 + h > window.innerHeight ? Math.max(8, anchor.top - h - 6) : anchor.bottom + 6;
    setPos({ left, top });
    inputRef.current?.select();
  }, [anchor]);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const value = Number(text.trim().replace(/\./g, '').replace(',', '.'));
  const valid = text.trim() === '' || (Number.isFinite(value) && Math.abs(value) < 1e9);

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const amount = round2(shown(k, text.trim() === '' ? 0 : value));
    // Si coincide con el valor calculado y no es puntual, no hace falta guardarla
    if (!oneoff && Math.abs(amount - cell.inherited) < 0.005) { onSave(null); return; }
    onSave({ amount, oneoff });
  };

  return (
    <form ref={ref} className="prj-editor glass-panel" style={{ left: pos.left, top: pos.top, width: EDITOR_WIDTH }} onSubmit={submit}>
      <div className="prj-editor-title">
        <strong>{name}</strong>
        <span>{MONTHS[m - 1]} {y}</span>
      </div>
      <label className="prj-editor-amount">
        <span>{k === INCOME ? 'Ingreso' : 'Gasto'}</span>
        <input ref={inputRef} type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)}
          aria-invalid={!valid} autoFocus />
        <i>€</i>
      </label>
      <label className="prj-editor-check">
        <input type="checkbox" checked={oneoff} onChange={(e) => setOneoff(e.target.checked)} />
        <span>Puntual: solo este mes, no se repite los años siguientes</span>
      </label>
      <div className="prj-editor-calc">
        Calculado: {formatCurrency(shown(k, cell.inherited))}
        {overridden && (
          <button type="button" onClick={() => onSave(null)}><RotateCcw size={12} /> Volver al calculado</button>
        )}
      </div>
      <div className="prj-editor-actions">
        <button type="button" onClick={onClose}>Cancelar</button>
        <button type="submit" className="is-primary" disabled={!valid}>Guardar</button>
      </div>
    </form>
  );
}
