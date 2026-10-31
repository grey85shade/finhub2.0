import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { niceTicks } from './DashboardHome';
import { useWidth } from '../utils/useWidth';
import { formatCurrency, formatCompact } from '../utils/format';

// Mismos tramos de la base del ahorro que InvestmentMetrics.php
const SAVINGS_TAX_BRACKETS = [[6000, 0.19], [50000, 0.21], [200000, 0.23], [300000, 0.27], [Infinity, 0.28]];

function savingsTax(gain) {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of SAVINGS_TAX_BRACKETS) {
    if (gain <= lower) break;
    tax += (Math.min(gain, upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

/** Valor y capital aportado al final de cada año, con capitalización y aportaciones mensuales. */
function simulate({ initial, monthly, rate, years }) {
  const monthlyRate = (1 + rate / 100) ** (1 / 12) - 1;
  let value = initial;
  let contributed = initial;
  const points = [{ year: 0, value, contributed }];
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      value = value * (1 + monthlyRate) + monthly;
      contributed += monthly;
    }
    points.push({ year: y, value, contributed });
  }
  return points;
}

const num = (v) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

export default function CompoundSimulator({ totals }) {
  const [form, setForm] = useState(() => ({
    initial: String(Math.round(totals.value)),
    monthly: String(Math.max(0, Math.round(totals.monthly_contribution))),
    rate: String(totals.xirr !== null ? Math.round(totals.xirr * 10) / 10 : 6),
    years: '20',
    inflation: '2',
  }));
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const years = Math.min(60, Math.max(1, Math.round(num(form.years))));
  const points = useMemo(
    () => simulate({ initial: num(form.initial), monthly: num(form.monthly), rate: num(form.rate), years }),
    [form.initial, form.monthly, form.rate, years],
  );
  const last = points[points.length - 1];
  const gain = last.value - last.contributed;
  const tax = savingsTax(gain);
  const net = last.value - tax;
  const real = net / (1 + num(form.inflation) / 100) ** years;

  return (
    <section className="home-card glass-panel">
      <header className="home-card-header">
        <h3><Calculator size={16} className="inv-inline-icon" /> Simulador de interés compuesto</h3>
        <span className="home-card-hint">Parte de tu cartera actual, tu aportación media y tu TIR</span>
      </header>
      <div className="inv-sim">
        <div className="inv-sim-form">
          <label>Capital inicial (€)<input type="number" min="0" step="100" className="modal-input" value={form.initial} onChange={set('initial')} /></label>
          <label>Aportación mensual (€)<input type="number" min="0" step="10" className="modal-input" value={form.monthly} onChange={set('monthly')} /></label>
          <label>Rentabilidad anual (%)<input type="number" step="0.1" className="modal-input" value={form.rate} onChange={set('rate')} /></label>
          <label>Años<input type="number" min="1" max="60" step="1" className="modal-input" value={form.years} onChange={set('years')} /></label>
          <label>Inflación anual (%)<input type="number" step="0.1" className="modal-input" value={form.inflation} onChange={set('inflation')} /></label>
          <p className="form-hint inv-sim-hint">
            La rentabilidad parte de tu TIR histórica, que no garantiza la futura. Prueba también con escenarios más prudentes.
          </p>
        </div>
        <div className="inv-sim-result">
          <dl className="inv-sim-stats">
            <div className="is-main"><dt>Valor dentro de {years} {years === 1 ? 'año' : 'años'}</dt><dd>{formatCurrency(last.value)}</dd></div>
            <div><dt>Aportado</dt><dd>{formatCurrency(last.contributed)}</dd></div>
            <div><dt>Plusvalía</dt><dd className={gain >= 0 ? 'is-positive' : 'is-negative'}>{formatCurrency(gain)}</dd></div>
            <div><dt>Impuestos al rescatar todo</dt><dd>{formatCurrency(tax)}</dd></div>
            <div><dt>Neto</dt><dd>{formatCurrency(net)}</dd></div>
            <div title="Neto descontando la inflación: lo que podrías comprar con él en euros de hoy"><dt>Neto en euros de hoy</dt><dd>{formatCurrency(real)}</dd></div>
          </dl>
          <SimChart points={points} />
        </div>
      </div>
    </section>
  );
}

const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

function SimChart({ points }) {
  const [ref, width] = useWidth();
  const ticks = niceTicks(0, Math.max(...points.map((p) => p.value), 1));
  const yMax = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / (points.length - 1 || 1)) * innerW;
  const y = (v) => PAD.top + innerH - (v / (yMax || 1)) * innerH;
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 40))));

  return (
    <div className="home-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="Evolución simulada del valor frente a lo aportado">
          <defs>
            <linearGradient id="inv-sim-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="home-chart-grid" />
              <text x={PAD.left - 8} y={y(t)} className="home-chart-axis" textAnchor="end" dominantBaseline="middle">{formatCompact(t)}</text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.year} x={x(i)} y={HEIGHT - 6} className="home-chart-axis" textAnchor="middle">
              {(points.length - 1 - i) % every ? '' : `+${p.year}`}
            </text>
          ))}
          <path d={`${path('value')} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#inv-sim-area)" />
          <path d={path('contributed')} className="inv-chart-contributed" />
          <path d={path('value')} className="home-chart-line" />
        </svg>
      )}
    </div>
  );
}
