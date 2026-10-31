import React, { useState } from 'react';
import { AlertCircle, History, Plus, Trash2, X } from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency, formatDay, formatPct } from '../utils/format';

const unitsFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4, useGrouping: 'always' });
const navFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4, useGrouping: 'always' });

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Fondos indexados de una cuenta: alta por ISIN, participaciones según el broker (ancla), reparto de las
 * aportaciones entre fondos y reconstrucción del histórico con precios reales.
 */
export default function FundsModal({ account, onClose, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState('');
  const emptyFund = () => ({ isin: '', weight: account.funds.length ? '' : '100', anchor_units: '', anchor_date: localToday() });
  const [newFund, setNewFund] = useState(emptyFund);
  const [edits, setEdits] = useState({});
  const [replaceManual, setReplaceManual] = useState(false);

  const totalWeight = account.funds.reduce((sum, f) => sum + Number(edits[f.id]?.weight ?? f.weight), 0);

  const run = async (key, action, success) => {
    setBusy(key);
    setError('');
    setNotice('');
    setWarning('');
    try {
      const res = await action();
      setNotice(success(res));
      setWarning((res.data?.sync?.errors ?? []).join(' · '));
      await onChanged();
      return true;
    } catch (err) {
      const detail = err.message || 'No se pudo completar la operación.';
      setError(detail);
      return false;
    } finally {
      setBusy('');
    }
  };

  // Sin participaciones la fecha no significa nada: se calculan con las aportaciones
  const payload = (f) => {
    const hasUnits = f.anchor_units !== '' && f.anchor_units !== null;
    return {
      // En blanco, el servidor usa 100: los fondos sin reparto indicado se llevan partes iguales
      ...(f.weight === '' ? {} : { weight: Number(f.weight) }),
      anchor_units: hasUnits ? f.anchor_units : null,
      anchor_date: hasUnits ? (f.anchor_date || localToday()) : null,
    };
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const ok = await run('add', () => api.createFund(account.id, { isin: newFund.isin, ...payload(newFund) }),
      (res) => `Añadido: ${res.data.fund.name}`);
    if (ok) setNewFund({ ...emptyFund(), weight: '' });
  };

  const fieldsOf = (f) => ({
    weight: edits[f.id]?.weight ?? String(f.weight),
    anchor_units: edits[f.id]?.anchor_units ?? (f.anchor_units ?? ''),
    anchor_date: edits[f.id]?.anchor_date ?? (f.anchor_date ?? ''),
  });
  const setField = (f, key, value) => setEdits({ ...edits, [f.id]: { ...fieldsOf(f), [key]: value } });

  const handleSave = async (f) => {
    const ok = await run(`save-${f.id}`, () => api.updateFund(account.id, f.id, payload(fieldsOf(f))), () => 'Fondo actualizado');
    if (ok) setEdits(({ [f.id]: _, ...rest }) => rest);
  };

  const handleDelete = (f) => {
    const msg = account.funds.length > 1
      ? `¿Quitar ${f.name} de la cuenta? Sus aportaciones pasarán a repartirse entre los demás fondos.`
      : `¿Quitar ${f.name} de la cuenta? Se borrarán las valoraciones automáticas y la cuenta volverá a tus valoraciones manuales.`;
    if (!window.confirm(msg)) return;
    run(`del-${f.id}`, () => api.deleteFund(account.id, f.id), () => 'Fondo quitado');
  };

  const handleRebuild = () => {
    if (replaceManual && !window.confirm('Se borrarán las valoraciones que registraste a mano en esta cuenta y se sustituirán por las calculadas con precios reales. ¿Continuar?')) return;
    run('rebuild', () => api.rebuildFundHistory(account.id, replaceManual), (res) => res.message);
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-container glass-panel animate-scale-up inv-funds-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="step-badge">Fondos indexados</span>
            <h2>{account.name}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={!!busy}><X size={20} /></button>
        </div>
        {error && <div className="modal-alert-error"><AlertCircle size={16} /><span>{error}</span></div>}
        {notice && <div className="inv-notice">{notice}</div>}
        {warning && <div className="modal-alert-error inv-alert-warning"><AlertCircle size={16} /><span>{warning}</span></div>}

        <div className="inv-funds-body">
          <dl className="inv-funds-help">
            <div>
              <dt>Participaciones</dt>
              <dd>
                Las que tienes del fondo. Cópialas de tu broker (en la posición del fondo, como «participaciones» o «títulos») con su fecha.
                Con ellas y el valor liquidativo de cada día, FinHub calcula solo el valor de la cuenta; las aportaciones que registres después
                se suman a partir de esa fecha. Si las dejas en blanco, se deducen de las aportaciones de la cuenta, y para eso tienen que estar todas registradas.
              </dd>
            </div>
            <div>
              <dt>Valor liquidativo</dt>
              <dd>El precio de una participación ese día. Se descarga solo.</dd>
            </div>
            {account.funds.length > 0 && (
              <div>
                <dt>Reparto %</dt>
                <dd>Qué parte de cada aportación nueva va a este fondo. Solo importa si la cuenta tiene varios fondos.</dd>
              </div>
            )}
          </dl>

          {account.funds.map((f) => {
            const v = fieldsOf(f);
            const dirty = !!edits[f.id];
            return (
              <section key={f.id} className="inv-fund">
                <header className="inv-fund-head">
                  <span className="home-account-name">
                    {f.name}
                    <span className="home-account-bank">{f.isin} · {f.symbol}</span>
                  </span>
                  <button type="button" className="inv-icon-btn" title="Quitar fondo" onClick={() => handleDelete(f)} disabled={!!busy}>
                    <Trash2 size={16} />
                  </button>
                </header>
                <dl className="inv-fund-stats">
                  <div><dt>Participaciones</dt><dd>{f.units === null ? '—' : unitsFmt.format(f.units)}</dd></div>
                  <div><dt>Valor liquidativo</dt><dd>{f.nav === null ? '—' : navFmt.format(f.nav)}<small>{f.nav_date && formatDay(f.nav_date)}</small></dd></div>
                  <div><dt>Valor</dt><dd>{f.value === null ? '—' : formatCurrency(f.value)}</dd></div>
                  <div><dt>Precio últimos 12 m</dt><dd className={f.nav_change_1y >= 0 ? 'is-positive' : 'is-negative'}>{formatPct(f.nav_change_1y)}</dd></div>
                </dl>
                <div className="inv-fund-form">
                  {account.funds.length > 1 && (
                    <label>Reparto %<input type="number" min="0" max="100" step="0.01" className="modal-input" value={v.weight} onChange={(e) => setField(f, 'weight', e.target.value)} /></label>
                  )}
                  <label>Participaciones<input type="number" min="0" step="0.000001" className="modal-input" placeholder="Las de tu broker" value={v.anchor_units} onChange={(e) => setField(f, 'anchor_units', e.target.value)} /></label>
                  <label>A fecha de<input type="date" className="modal-input" value={v.anchor_date} onChange={(e) => setField(f, 'anchor_date', e.target.value)} /></label>
                  <button type="button" className="btn-modal-primary" disabled={!dirty || !!busy} onClick={() => handleSave(f)}>
                    {busy === `save-${f.id}` ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </section>
            );
          })}

          {account.fund_check && (
            <div className={`inv-fund-check ${account.fund_check.ok ? 'is-ok' : 'is-off'}`}>
              <div>
                <span>Los fondos suman el {formatDay(account.fund_check.date)}</span>
                <strong>{formatCurrency(account.fund_check.computed)}</strong>
              </div>
              <div>
                <span>Tu valoración de ese día</span>
                <strong>{formatCurrency(account.fund_check.registered)}</strong>
              </div>
              <p>
                {account.fund_check.ok
                  ? 'Cuadra: el valor de la cuenta se actualiza solo con los precios de cada día.'
                  : account.fund_check.computed < account.fund_check.registered
                    ? `Cubren el ${Math.round((account.fund_check.computed / account.fund_check.registered) * 100)} %. Añade los fondos que falten o revisa las participaciones; hasta que cuadre, el valor no se actualiza.`
                    : 'Suman más de lo que registraste: revisa las participaciones. Hasta que cuadre, el valor no se actualiza.'}
              </p>
            </div>
          )}

          {account.funds.length > 1 && Math.abs(totalWeight - 100) > 0.01 && (
            <p className="inv-warning">Los pesos suman {formatPct(totalWeight)}; las aportaciones se reparten en proporción.</p>
          )}

          <form className="inv-fund inv-fund-new" onSubmit={handleAdd}>
            <h4 className="home-subtitle">Añadir fondo</h4>
            <div className="inv-fund-form">
              <label>ISIN<input required className="modal-input monospace" placeholder="IE00B03HCZ61" maxLength={14} value={newFund.isin} onChange={(e) => setNewFund({ ...newFund, isin: e.target.value.toUpperCase() })} /></label>
              {account.funds.length > 0 && (
                <label>Reparto %<input type="number" min="0" max="100" step="0.01" className="modal-input" placeholder="100" value={newFund.weight} onChange={(e) => setNewFund({ ...newFund, weight: e.target.value })} /></label>
              )}
              <label>Participaciones<input type="number" min="0" step="0.000001" className="modal-input" placeholder="Las de tu broker" value={newFund.anchor_units} onChange={(e) => setNewFund({ ...newFund, anchor_units: e.target.value })} /></label>
              <label>A fecha de<input type="date" className="modal-input" value={newFund.anchor_date} onChange={(e) => setNewFund({ ...newFund, anchor_date: e.target.value })} /></label>
            </div>
            <button type="submit" className="btn-modal-primary inv-fund-add" disabled={!!busy || !newFund.isin}>
              <Plus size={16} /> {busy === 'add' ? 'Buscando fondo…' : 'Añadir fondo'}
            </button>
          </form>

          {account.funds.length > 0 && (
            <section className="inv-fund">
              <h4 className="home-subtitle">Histórico</h4>
              <p className="form-hint">
                Calcula el valor de la cuenta al cierre de cada mes pasado con los precios reales de sus fondos.
                Mejora el gráfico de evolución y la rentabilidad por año.
              </p>
              <label className="tx-rule-option">
                <input type="checkbox" checked={replaceManual} onChange={(e) => setReplaceManual(e.target.checked)} />
                <span>Sustituir también las valoraciones que registré a mano</span>
              </label>
              <button type="button" className="btn-modal-secondary inv-fund-add" onClick={handleRebuild} disabled={!!busy}>
                <History size={16} /> {busy === 'rebuild' ? 'Reconstruyendo…' : 'Reconstruir histórico'}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
