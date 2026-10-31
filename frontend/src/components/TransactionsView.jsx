import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Plus,
  Upload,
  Trash2,
  X,
  AlertCircle,
  AlertTriangle,
  Check,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  RefreshCw,
  Tag,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  CalendarDays,
  Zap,
  Flame,
  Siren
} from 'lucide-react';
import { api } from '../services/api';
import { BANK_DIRECTORY } from './AccountsView';
import ImportTransactionsModal from './ImportTransactionsModal';
import ToastStack from './Toast';
import './TransactionsView.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (v) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v ?? 0);

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

const MONTH_LABELS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const monthKey = (dateStr) => dateStr?.slice(0, 7) ?? 'sin-fecha'; // "2025-03"
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`;
};

const TX_TYPES = [
  { id: 'expense',  label: 'Gasto',         icon: TrendingDown,    color: '#f43f5e' },
  { id: 'income',   label: 'Ingreso',        icon: TrendingUp,      color: '#34d399' },
  { id: 'update',   label: 'Actualización',  icon: RefreshCw,       color: '#38bdf8' },
  { id: 'internal', label: 'Interna',        icon: ArrowLeftRight,  color: '#a78bfa' },
];

const txTypeInfo = (type) => TX_TYPES.find((t) => t.id === type) ?? TX_TYPES[0];

// Niveles para destacar los gastos grandes (por importe absoluto, de mayor a menor)
const AMOUNT_TIERS = [
  { id: 'top',  min: 3000, icon: Siren, label: 'Más de 3.000 €' },
  { id: 'high', min: 1000, icon: Flame, label: 'De 1.000 a 3.000 €' },
  { id: 'mid',  min: 500,  icon: Zap,   label: 'De 500 a 1.000 €' },
];

/** Nivel del gasto, o null si es pequeño o no es un gasto. */
const amountTier = (tx) =>
  tx.type !== 'expense' ? null : AMOUNT_TIERS.find((t) => Math.abs(tx.amount) >= t.min) ?? null;

// ─── Componente principal ────────────────────────────────────────────────────

export default function TransactionsView({ account, bankData, onBack }) {
  const [transactions, setTransactions]   = useState([]);
  const [accountInfo, setAccountInfo]     = useState(account);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  // Secciones colapsadas por mes
  const [collapsedMonths, setCollapsedMonths] = useState({});

  // Modal de nueva transacción
  const [isAddOpen, setIsAddOpen]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [formError, setFormError]       = useState('');
  const [categories, setCategories]     = useState([]);
  const [formData, setFormData]         = useState({
    date: new Date().toISOString().slice(0, 10),
    concept: '',
    amount: '',
    type: 'expense',
    category_id: '',
    fund_id: '',
    create_rule: false,
    notes: '',
  });

  // Confirmación de borrado
  // Carga masiva y notificaciones
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [toasts, setToasts]             = useState([]);

  // Cambio de categoría
  const [txToCategorize, setTxToCategorize] = useState(null);
  const [categoryForm, setCategoryForm]     = useState({ category_id: '', create_rule: false });
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError]   = useState('');

  const [txToDelete, setTxToDelete]   = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.getTransactions(account.id);
      if (res.success) {
        setTransactions(res.data.transactions ?? []);
        setAccountInfo(res.data.account ?? account);
      }
    } catch (err) {
      setError(err.message || 'Error al cargar transacciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    api.getCategories().then((r) => {
      if (r.success) setCategories(r.data.categories ?? []);
    }).catch(() => {});
  }, [account.id]);

  // ── Agrupación por mes ─────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = {};
    transactions.forEach((tx) => {
      const key = monthKey(tx.date);
      if (!map[key]) map[key] = { key, label: monthLabel(key), items: [] };
      map[key].items.push(tx);
    });
    // Ordenar grupos descendentemente
    return Object.values(map).sort((a, b) => (b.key > a.key ? 1 : -1));
  }, [transactions]);

  const toggleMonth = (key) =>
    setCollapsedMonths((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Formulario nueva transacción ──────────────────────────────────────────

  const openAddModal = () => {
    setFormData({
      date: new Date().toISOString().slice(0, 10),
      concept: '',
      amount: '',
      type: 'expense',
      category_id: '',
      fund_id: '',
      create_rule: false,
      notes: '',
    });
    setFormError('');
    setIsAddOpen(true);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!formData.concept.trim()) { setFormError('El concepto es obligatorio.'); return; }
    if (!formData.amount || isNaN(parseFloat(formData.amount))) { setFormError('El importe es obligatorio.'); return; }

    try {
      setSubmitting(true);
      setFormError('');
      const payload = {
        date:        formData.date,
        concept:     formData.concept.trim(),
        amount:      parseFloat(formData.amount),
        type:        formData.type,
        category_id: formData.category_id || null,
        fund_id:     formData.fund_id || null,
        create_rule: !!formData.category_id && formData.create_rule,
        notes:       formData.notes.trim() || null,
      };
      const res = await api.createTransaction(account.id, payload);
      if (res.success) {
        setIsAddOpen(false);
        await fetchTransactions();
      }
    } catch (err) {
      setFormError(err.message || 'Error al guardar la transacción.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Borrado ────────────────────────────────────────────────────────────────

  // ── Carga masiva ───────────────────────────────────────────────────────────

  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const pushToast = (toast) => setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, ...toast }]);

  const handleImportDone = async ({ imported, categorized, discarded }) => {
    setIsImportOpen(false);
    if (imported > 0) {
      pushToast({
        type: 'success',
        title: `${imported} ${imported === 1 ? 'transacción importada' : 'transacciones importadas'}`,
        message: categorized > 0 ? `${categorized} categorizadas automáticamente por tus reglas.` : undefined,
        autoClose: 6000,
      });
    }
    if (discarded.length > 0) {
      pushToast({
        type: 'warning',
        title: `${discarded.length} ${discarded.length === 1 ? 'transacción descartada' : 'transacciones descartadas'}`,
        items: discarded.map((d) => {
          const amount = typeof d.amount === 'number' ? formatCurrency(d.amount) : d.amount;
          const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? formatDate(d.date) : d.date;
          const detail = [date, d.concept, amount].filter(Boolean).join(' · ') || d.raw;
          return `Fila ${d.line} · ${detail} — ${d.reason}`;
        }),
      });
    }
    if (imported > 0) await fetchTransactions();
  };

  // ── Cambio de categoría ────────────────────────────────────────────────────

  const openCategoryEdit = (tx) => {
    setTxToCategorize(tx);
    setCategoryForm({ category_id: tx.category?.id ? String(tx.category.id) : '', create_rule: false });
    setCategoryError('');
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    try {
      setSavingCategory(true);
      setCategoryError('');
      await api.updateTransactionCategory(account.id, txToCategorize.id, {
        category_id: categoryForm.category_id || null,
        create_rule: !!categoryForm.category_id && categoryForm.create_rule,
      });
      setTxToCategorize(null);
      await fetchTransactions();
    } catch (err) {
      setCategoryError(err.message || 'No se pudo actualizar la categoría.');
    } finally {
      setSavingCategory(false);
    }
  };

  // ── Borrado ────────────────────────────────────────────────────────────────

  const openDeleteConfirm = (tx) => {
    setTxToDelete(tx);
    setDeleteError('');
  };

  const handleConfirmDelete = async (e) => {
    e.preventDefault();
    try {
      setDeleting(true);
      setDeleteError('');
      await api.deleteTransaction(account.id, txToDelete.id);
      setTxToDelete(null);
      await fetchTransactions();
    } catch (err) {
      setDeleteError(err.message || 'No se pudo eliminar la transacción.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const bank = bankData || BANK_DIRECTORY.find((b) => b.id === accountInfo?.bank_id) || {};

  return (
    <div className="tx-view animate-fade-in">
      {/* Header */}
      <div className="tx-header">
        <button className="btn-back" onClick={onBack} title="Volver a cuentas">
          <ArrowLeft size={18} />
          <span>Volver</span>
        </button>

        <div className="tx-account-info">
          <div className="tx-bank-chip" style={{ backgroundColor: bank.color || '#38bdf8' }}>
            {bank.initials || accountInfo?.bank_id?.slice(0, 2).toUpperCase()}
          </div>
          <div className="tx-account-text">
            <h1 className="tx-account-name">{accountInfo?.name}</h1>
            <span className="tx-account-meta">
              {accountInfo?.iban
                ? accountInfo.iban.replace(/(.{4})/g, '$1 ').trim()
                : accountInfo?.account_type === 'investment' ? 'Cuenta de Inversión' : 'Cuenta Corriente'}
            </span>
          </div>
          <div className="tx-balance-badge">
            <span className="tx-balance-label">Saldo actual</span>
            <span className="tx-balance-amount">{formatCurrency(accountInfo?.balance)}</span>
          </div>
        </div>

        <div className="tx-actions-bar">
          <button className="btn-import-batch glass-panel" onClick={() => setIsImportOpen(true)} title="Importar transacciones pegando el extracto del banco">
            <Upload size={16} />
            <span>Importar batch</span>
          </button>
          <button className="btn-add-tx shadow-glow" onClick={openAddModal}>
            <Plus size={16} />
            <span>Nueva transacción</span>
          </button>
        </div>
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="tx-loading glass-panel">
          <div className="spinner" />
          <p>Cargando transacciones...</p>
        </div>
      ) : error ? (
        <div className="tx-error glass-panel">
          <AlertCircle size={32} />
          <p>{error}</p>
          <button className="btn-add-tx" onClick={fetchTransactions}>Reintentar</button>
        </div>
      ) : grouped.length === 0 ? (
        <div className="tx-empty glass-panel">
          <CalendarDays size={48} className="tx-empty-icon" />
          <h3>Sin transacciones</h3>
          <p>Registra tu primera transacción para esta cuenta.</p>
          <button className="btn-add-tx" onClick={openAddModal}>
            <Plus size={16} /> Nueva transacción
          </button>
        </div>
      ) : (
        <div className="tx-groups">
          {grouped.map((group) => {
            const collapsed = collapsedMonths[group.key];
            const totalIncome  = group.items.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalExpense = group.items.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

            return (
              <div key={group.key} className="tx-month-group glass-panel">
                {/* Cabecera del mes */}
                <button
                  className="tx-month-header"
                  onClick={() => toggleMonth(group.key)}
                >
                  <div className="tx-month-left">
                    <span className="tx-month-label">{group.label}</span>
                    <span className="tx-month-count">{group.items.length} movs.</span>
                  </div>
                  <div className="tx-month-right">
                    <span className="tx-month-income">+{formatCurrency(totalIncome)}</span>
                    <span className="tx-month-expense">−{formatCurrency(totalExpense)}</span>
                    {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </div>
                </button>

                {/* Tabla */}
                {!collapsed && (
                  <div className="tx-table-wrap">
                    <table className="tx-table">
                      <thead>
                        <tr>
                          <th className="col-date">Fecha</th>
                          <th className="col-concept">Concepto</th>
                          <th className="col-category">Categoría</th>
                          <th className="col-amount">Importe</th>
                          <th className="col-balance">Saldo</th>
                          <th className="col-actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((tx) => {
                          const typeInfo = txTypeInfo(tx.type);
                          const TypeIcon = typeInfo.icon;
                          const isNeg = tx.type === 'expense';
                          const tier = amountTier(tx);
                          const TierIcon = tier?.icon;
                          return (
                            <tr key={tx.id} className={`tx-row tx-row-${tx.type} ${tier ? `tx-size-${tier.id}` : ''}`}>
                              <td className="col-date">
                                <span className="tx-date">{formatDate(tx.date)}</span>
                              </td>
                              <td className="col-concept">
                                <div className="tx-concept-cell">
                                  <span
                                    className="tx-type-icon-dot"
                                    style={{ background: typeInfo.color + '22', color: typeInfo.color, border: `1px solid ${typeInfo.color}44` }}
                                    title={typeInfo.label}
                                  >
                                    <TypeIcon size={12} />
                                  </span>
                                  <div className="tx-concept-text">
                                    <span className="tx-concept">{tx.concept}</span>
                                    {tx.notes && <span className="tx-notes">{tx.notes}</span>}
                                  </div>
                                </div>
                              </td>
                              <td className="col-category">
                                <button
                                  type="button"
                                  className="btn-tx-category"
                                  onClick={() => openCategoryEdit(tx)}
                                  title="Cambiar categoría"
                                >
                                  {tx.category ? (
                                    <span
                                      className="tx-category-badge"
                                      style={{ background: (tx.category.color || '#38bdf8') + '22', color: tx.category.color || '#38bdf8', border: `1px solid ${(tx.category.color || '#38bdf8')}44` }}
                                    >
                                      <Tag size={11} />
                                      {tx.category.name}
                                    </span>
                                  ) : (
                                    <span className="tx-no-category">—</span>
                                  )}
                                </button>
                              </td>
                              <td className="col-amount">
                                <span className={`tx-amount ${isNeg ? 'neg' : tx.type === 'income' ? 'pos' : 'neutral'}`}>
                                  {tier && (
                                    <span className="tx-size-icon" title={tier.label} aria-label={tier.label}>
                                      <TierIcon size={12} />
                                    </span>
                                  )}
                                  {isNeg ? '−' : tx.type === 'income' ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                                </span>
                              </td>
                              <td className="col-balance">
                                <span className="tx-balance-after">
                                  {tx.balance_after !== null ? formatCurrency(tx.balance_after) : '—'}
                                </span>
                              </td>
                              <td className="col-actions">
                                <button
                                  className="btn-tx-delete"
                                  onClick={() => openDeleteConfirm(tx)}
                                  title="Eliminar transacción"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Nueva Transacción */}
      {isAddOpen && (
        <div className="modal-backdrop" onClick={() => !submitting && setIsAddOpen(false)}>
          <div className="modal-container glass-panel animate-scale-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="step-badge">Nueva Transacción</span>
                <h2>{accountInfo?.name}</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setIsAddOpen(false)} disabled={submitting}>
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="modal-alert-error">
                <AlertCircle size={16} /><span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="tx-form step-account-form">
              {/* Tipo de transacción */}
              <div className="form-group">
                <label>Tipo de Transacción *</label>
                <div className="tx-type-selector">
                  {TX_TYPES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`tx-type-btn ${formData.type === t.id ? 'active' : ''}`}
                        style={formData.type === t.id ? { borderColor: t.color, background: t.color + '18', color: t.color } : {}}
                        onClick={() => setFormData({ ...formData, type: t.id })}
                      >
                        <Icon size={16} />
                        <span>{t.label}</span>
                        {formData.type === t.id && <Check size={13} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Fila Fecha + Importe */}
              <div className="form-row-two">
                <div className="form-group">
                  <label htmlFor="tx-date">Fecha *</label>
                  <input
                    id="tx-date"
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="modal-input"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="tx-amount">
                    Importe (€) *
                    {formData.type === 'update' && <span className="label-hint"> — nuevo saldo</span>}
                  </label>
                  <input
                    id="tx-amount"
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="modal-input"
                  />
                </div>
              </div>

              {/* Concepto */}
              <div className="form-group">
                <label htmlFor="tx-concept">Concepto *</label>
                <input
                  id="tx-concept"
                  type="text"
                  required
                  placeholder="Ej. Supermercado Mercadona, Nómina Octubre..."
                  value={formData.concept}
                  onChange={(e) => setFormData({ ...formData, concept: e.target.value })}
                  className="modal-input"
                  autoFocus
                />
              </div>

              {/* Fondo de la aportación o retirada (cuentas de inversión con fondos) */}
              {accountInfo?.funds?.length > 0 && (formData.type === 'income' || formData.type === 'expense') && (
                <div className="form-group">
                  <label htmlFor="tx-fund">Fondo</label>
                  <select
                    id="tx-fund"
                    value={formData.fund_id}
                    onChange={(e) => setFormData({ ...formData, fund_id: e.target.value })}
                    className="modal-input modal-select"
                  >
                    <option value="">{formData.type === 'income' ? 'Repartir según los pesos' : 'Repartir según el valor de cada fondo'}</option>
                    {accountInfo.funds.map((f) => (
                      <option key={f.id} value={f.id}>{f.name} ({f.isin})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Categoría */}
              <div className="form-group">
                <label htmlFor="tx-category">Categoría</label>
                <select
                  id="tx-category"
                  value={formData.category_id}
                  onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                  className="modal-input modal-select"
                >
                  <option value="">Sin categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {formData.category_id && (
                  <label className="tx-rule-option">
                    <input
                      type="checkbox"
                      checked={formData.create_rule}
                      onChange={(e) => setFormData({ ...formData, create_rule: e.target.checked })}
                    />
                    <span>Crear regla: asignar siempre esta categoría a las transacciones con el mismo concepto</span>
                  </label>
                )}
              </div>

              {/* Notas */}
              <div className="form-group">
                <label htmlFor="tx-notes">Notas (opcional)</label>
                <input
                  id="tx-notes"
                  type="text"
                  placeholder="Descripción adicional..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="modal-input"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-modal-secondary" onClick={() => setIsAddOpen(false)} disabled={submitting}>
                  Cancelar
                </button>
                <button type="submit" className="btn-modal-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : 'Registrar Transacción'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Carga Masiva */}
      {isImportOpen && (
        <ImportTransactionsModal
          account={accountInfo}
          onClose={() => setIsImportOpen(false)}
          onDone={handleImportDone}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Modal Cambio de Categoría */}
      {txToCategorize && (
        <div className="modal-backdrop" onClick={() => !savingCategory && setTxToCategorize(null)}>
          <div className="modal-container tx-category-modal glass-panel animate-scale-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="step-badge">Cambiar Categoría</span>
                <h2>{txToCategorize.concept}</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setTxToCategorize(null)} disabled={savingCategory}>
                <X size={20} />
              </button>
            </div>

            {categoryError && (
              <div className="modal-alert-error"><AlertCircle size={16} /><span>{categoryError}</span></div>
            )}

            <form onSubmit={handleCategorySubmit} className="tx-form step-account-form">
              <div className="form-group">
                <label htmlFor="tx-edit-category">Categoría</label>
                <select
                  id="tx-edit-category"
                  value={categoryForm.category_id}
                  onChange={(e) => setCategoryForm({ ...categoryForm, category_id: e.target.value })}
                  className="modal-input modal-select"
                  autoFocus
                >
                  <option value="">Sin categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {categoryForm.category_id && (
                  <label className="tx-rule-option">
                    <input
                      type="checkbox"
                      checked={categoryForm.create_rule}
                      onChange={(e) => setCategoryForm({ ...categoryForm, create_rule: e.target.checked })}
                    />
                    <span>
                      Crear regla: asignar siempre esta categoría a las transacciones con el concepto
                      {' '}<strong>"{txToCategorize.concept}"</strong>
                    </span>
                  </label>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-modal-secondary" onClick={() => setTxToCategorize(null)} disabled={savingCategory}>
                  Cancelar
                </button>
                <button type="submit" className="btn-modal-primary" disabled={savingCategory}>
                  {savingCategory ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmación Borrado */}
      {txToDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setTxToDelete(null)}>
          <div className="modal-container delete-confirm-modal glass-panel animate-scale-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header delete-modal-header">
              <div className="modal-title-wrap">
                <div className="delete-badge-wrap">
                  <AlertTriangle size={20} className="delete-alert-icon" />
                  <span className="delete-step-badge">Acción Destructiva</span>
                </div>
                <h2>Confirmar eliminación</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setTxToDelete(null)} disabled={deleting}>
                <X size={20} />
              </button>
            </div>

            {deleteError && (
              <div className="modal-alert-error"><AlertCircle size={16} /><span>{deleteError}</span></div>
            )}

            <form onSubmit={handleConfirmDelete} className="delete-confirm-body">
              <p className="delete-warning-text">
                Vas a eliminar la transacción <strong className="text-highlight">"{txToDelete.concept}"</strong> del{' '}
                <strong>{formatDate(txToDelete.date)}</strong> por{' '}
                <strong>{formatCurrency(txToDelete.amount)}</strong>.
                <br />El saldo de la cuenta se revertirá automáticamente.
                <br />¿Seguro que quieres eliminarla?
              </p>
              <div className="modal-actions delete-actions">
                <button type="button" className="btn-modal-secondary" onClick={() => setTxToDelete(null)} disabled={deleting}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-modal-danger"
                  disabled={deleting}
                  autoFocus
                >
                  {deleting ? 'Eliminando...' : 'Eliminar Transacción'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
