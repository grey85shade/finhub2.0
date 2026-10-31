import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarClock, Check, EyeOff, RotateCcw, X } from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency, formatDay, fromIso } from '../utils/format';

const VISIBLE_ROWS = 8;
const DAY_MS = 86400000;
const shortDate = (iso) => formatDay(iso, { day: 'numeric', month: 'short', year: '2-digit' }).replace('.', '');

function relativeDay(iso, asOf) {
  const d = Math.round((fromIso(iso) - fromIso(asOf)) / DAY_MS);
  if (d < 0) return { text: `Sin cobrar · previsto hace ${-d} ${d === -1 ? 'día' : 'días'}`, tone: 'is-overdue' };
  if (d === 0) return { text: 'Hoy', tone: 'is-soon' };
  if (d === 1) return { text: 'Mañana', tone: 'is-soon' };
  return { text: `En ${d} días`, tone: d <= 7 ? 'is-soon' : '' };
}

/**
 * Gastos fijos (impuestos, seguros, préstamos, suministros, recibos) que se cobraron hace un año y se esperan de
 * nuevo. Desaparecen solos al llegar el cargo de este año; si no va a llegar, se desestiman.
 */
export default function PlannedExpenses({ planned, onChanged }) {
  const [choosing, setChoosing] = useState(null); // transaction_id con el menú de desestimar abierto
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = async (action) => {
    setBusy(true);
    try {
      const res = await action();
      setNotice({ type: 'ok', text: res.message });
      setChoosing(null);
      await onChanged();
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'No se pudo completar la operación.' });
    } finally {
      setBusy(false);
    }
  };

  const { items, later, dismissed } = planned;
  const visible = showAll ? items : items.slice(0, VISIBLE_ROWS);

  return (
    <section className="home-card glass-panel home-planned">
      <header className="home-card-header">
        <h3>Gastos previstos</h3>
        <span className="home-card-hint">
          {items.length > 0
            ? <>30 días: <strong>{formatCurrency(planned.total_30)}</strong> · {planned.horizon_days} días: {formatCurrency(planned.total_horizon)}</>
            : 'Según tus gastos fijos del año pasado'}
        </span>
      </header>

      {notice && (
        <div className={`home-planned-notice ${notice.type === 'error' ? 'is-error' : ''}`}>
          {notice.type === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}
          <span>{notice.text}</span>
        </div>
      )}

      {items.length === 0 ? (
        <p className="home-empty-text">
          Nada previsto en los próximos {planned.horizon_days} días. Se calculan con lo que pagaste hace un año en
          impuestos, seguros, préstamos, comunidad y suministros, y con los recibos domiciliados.
        </p>
      ) : (
        <ul className="home-planned-list">
          {visible.map((item) => {
            const rel = relativeDay(item.expected_date, planned.as_of);
            const open = choosing === item.transaction_id;
            return (
              <li key={item.transaction_id} className="home-planned-row">
                <span className="home-planned-date">
                  <strong>{fromIso(item.expected_date).getDate()}</strong>
                  <span>{fromIso(item.expected_date).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                </span>
                <span className="home-planned-info">
                  <span className="home-planned-name">
                    <span className="home-bar-dot" style={{ background: item.color }} />
                    {item.name}
                  </span>
                  <span className="home-planned-meta">
                    <span className={`home-planned-when ${rel.tone}`}>{rel.text}</span>
                    {item.category_name && <> · {item.category_name}</>}
                    {' · '}
                    <span title={`Cargo del ${formatDay(item.last_year_date)} en ${item.account_name}`}>
                      año pasado el {shortDate(item.last_year_date)}
                    </span>
                  </span>
                </span>
                <span className="home-planned-amount" title="Importe del año pasado">≈ {formatCurrency(-item.amount)}</span>
                {open ? (
                  <span className="home-planned-choice" role="group" aria-label={`Desestimar ${item.name}`}>
                    <button type="button" className="home-planned-choice-btn" disabled={busy}
                      onClick={() => run(() => api.dismissPlannedExpense(item.transaction_id, 'once'))}
                      title="Este año no se cobrará (o ya se pagó por otra vía)">
                      Esta vez
                    </button>
                    <button type="button" className="home-planned-choice-btn" disabled={busy}
                      onClick={() => run(() => api.dismissPlannedExpense(item.transaction_id, 'always'))}
                      title="Ya no se cobrará más: deuda pagada, seguro dado de baja…">
                      Siempre
                    </button>
                    <button type="button" className="home-planned-btn" onClick={() => setChoosing(null)} aria-label="Cancelar">
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <button type="button" className="home-planned-btn" onClick={() => setChoosing(item.transaction_id)}
                    title="Desestimar" aria-label={`Desestimar ${item.name}`}>
                    <EyeOff size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {items.length > VISIBLE_ROWS && (
        <button type="button" className="home-card-link home-planned-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Ver menos' : `Ver ${items.length - VISIBLE_ROWS} más`}
        </button>
      )}

      {(later.length > 0 || dismissed.length > 0) && (
        <div className="home-planned-footer">
          {later.length > 0 && (
            <div className="home-planned-later">
              <CalendarClock size={14} />
              <span>Más adelante:</span>
              {later.map((l) => (
                <span key={l.transaction_id} className="home-planned-chip">
                  {l.name} · {shortDate(l.expected_date)} · {formatCurrency(l.amount)}
                </span>
              ))}
            </div>
          )}
          {dismissed.length > 0 && (
            <div className="home-planned-later">
              <button type="button" className="home-card-link" onClick={() => setShowHidden(!showHidden)}>
                <EyeOff size={13} /> Desestimados ({dismissed.length})
              </button>
              {showHidden && dismissed.map((d) => (
                <button key={d.id} type="button" className="home-planned-chip" disabled={busy}
                  onClick={() => run(() => api.restorePlannedExpense(d.id))} title="Restaurar">
                  {d.label}{d.scope === 'once' ? ' (esta vez)' : ''} <RotateCcw size={11} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
