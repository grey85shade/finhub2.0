import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  CreditCard, 
  TrendingUp, 
  Plus, 
  Trash2, 
  Calendar, 
  ShieldCheck, 
  Sparkles, 
  ArrowRight, 
  Check, 
  X, 
  AlertCircle,
  Landmark,
  WalletCards,
  Coins,
  Edit2,
  AlertTriangle
} from 'lucide-react';
import { api } from '../services/api';
import './AccountsView.css';

// Lista de bancos oficiales según especificación con sus identidades visuales
export const BANK_DIRECTORY = [
  // Destacados primer bloque
  { id: 'caixa_enginyers', name: 'Caixa Enginyers', short: 'C. Enginyers', color: '#00838f', accent: '#00acc1', initials: 'CE' },
  { id: 'caixabank', name: 'CaixaBank', short: 'CaixaBank', color: '#007eae', accent: '#00a3e0', initials: 'CB' },
  { id: 'kutxabank', name: 'Kutxabank', short: 'Kutxabank', color: '#c50920', accent: '#e2001a', initials: 'KB' },
  { id: 'indexa_capital', name: 'Indexa Capital', short: 'Indexa', color: '#1e293b', accent: '#3b82f6', initials: 'IC' },
  { id: 'revolut', name: 'Revolut', short: 'Revolut', color: '#191c1f', accent: '#0075eb', initials: 'REV' },

  // Bloque general
  { id: 'banco_sabadell', name: 'Banco Sabadell', short: 'Sabadell', color: '#005596', accent: '#007acc', initials: 'BS' },
  { id: 'bbva', name: 'BBVA', short: 'BBVA', color: '#004481', accent: '#1464a5', initials: 'BBVA' },
  { id: 'ibercaja', name: 'Ibercaja', short: 'Ibercaja', color: '#b31b1b', accent: '#e53935', initials: 'IB' },
  { id: 'ing', name: 'ING', short: 'ING', color: '#ff6200', accent: '#ff8c00', initials: 'ING' },
  { id: 'openbank', name: 'Openbank', short: 'Openbank', color: '#c00d0d', accent: '#e60000', initials: 'OB' },
  { id: 'myinvestor', name: 'Myinvestor', short: 'MyInvestor', color: '#2b2d42', accent: '#06d6a0', initials: 'MYI' },
  { id: 'bankinter', name: 'Bankinter', short: 'Bankinter', color: '#ff5900', accent: '#ff7920', initials: 'BK' },
  { id: 'unicaja', name: 'Unicaja', short: 'Unicaja', color: '#00843d', accent: '#00a651', initials: 'UNI' },
  { id: 'abanca', name: 'Abanca', short: 'Abanca', color: '#005494', accent: '#0083ca', initials: 'AB' },
  { id: 'banco_de_espana', name: 'Banco de España', short: 'B. España', color: '#374151', accent: '#64748b', initials: 'BDE' },
  { id: 'n26', name: 'N26', short: 'N26', color: '#36a99a', accent: '#2cb5a0', initials: 'N26' }
];

export default function AccountsView({ onOpenTransactions }) {
  const [bankGroups, setBankGroups] = useState([]);
  const [summary, setSummary] = useState({
    total_balance: 0,
    total_checking: 0,
    total_investment: 0,
    banks_count: 0,
    accounts_count: 0
  });
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1); // 1 = Elegir banco, 2 = Datos de cuenta
  const [selectedBank, setSelectedBank] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Edición de cuenta
  const [editingAccount, setEditingAccount] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    account_type: 'checking',
    balance: '',
    initial_balance: '',
    iban: '',
    opening_date: ''
  });
  const [editError, setEditError] = useState('');

  // Confirmación de borrado con texto
  const [accountToDelete, setAccountToDelete] = useState(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Campos del formulario de creación
  const [formData, setFormData] = useState({
    name: '',
    account_type: 'checking', // 'checking' | 'investment'
    initial_balance: '',
    iban: '',
    opening_date: ''
  });

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await api.getAccounts();
      if (res.success) {
        setBankGroups(res.data.bank_groups || []);
        setSummary(res.data.summary || {
          total_balance: 0,
          total_checking: 0,
          total_investment: 0,
          banks_count: 0,
          accounts_count: 0
        });
      }
    } catch (err) {
      console.error('Error cargando cuentas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const openCreateModal = () => {
    setSelectedBank(null);
    setCreateStep(1);
    setFormData({
      name: '',
      account_type: 'checking',
      initial_balance: '',
      iban: '',
      opening_date: ''
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSelectBank = (bank) => {
    setSelectedBank(bank);
    setFormData(prev => ({
      ...prev,
      name: prev.name || (prev.account_type === 'investment' ? `Cartera ${bank.name}` : `Cuenta Nómina ${bank.name}`)
    }));
    setCreateStep(2);
  };

  const handleBackToStep1 = () => {
    setCreateStep(1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBank) return;

    if (!formData.name.trim()) {
      setFormError('Por favor introduce un nombre para la cuenta.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');
      
      const payload = {
        bank_id: selectedBank.id,
        name: formData.name.trim(),
        account_type: formData.account_type,
        initial_balance: formData.initial_balance ? parseFloat(formData.initial_balance) : 0,
        iban: formData.iban ? formData.iban.trim() : null,
        opening_date: formData.opening_date || null
      };

      const res = await api.createAccount(payload);
      if (res.success) {
        setIsModalOpen(false);
        await fetchAccounts();
      }
    } catch (err) {
      setFormError(err.message || 'Error al guardar la cuenta');
    } finally {
      setSubmitting(false);
    }
  };

  // Apertura de modal de edición
  const handleOpenEdit = (acc, bank) => {
    setEditingAccount({ ...acc, bank });
    setEditFormData({
      name: acc.name || '',
      account_type: acc.account_type || 'checking',
      balance: acc.balance !== undefined && acc.balance !== null ? acc.balance : '',
      initial_balance: acc.initial_balance ?? '',
      iban: acc.iban || '',
      opening_date: acc.opening_date || ''
    });
    setEditError('');
    setIsEditModalOpen(true);
  };

  // Guardar edición
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingAccount) return;

    if (!editFormData.name.trim()) {
      setEditError('Por favor introduce un nombre para la cuenta.');
      return;
    }

    try {
      setSubmitting(true);
      setEditError('');

      const payload = {
        name: editFormData.name.trim(),
        account_type: editFormData.account_type,
        balance: editFormData.balance !== '' ? parseFloat(editFormData.balance) : 0,
        ...(editFormData.account_type === 'investment' && editFormData.initial_balance !== ''
          ? { initial_balance: parseFloat(editFormData.initial_balance) }
          : {}),
        iban: editFormData.iban ? editFormData.iban.trim() : null,
        opening_date: editFormData.opening_date || null
      };

      const res = await api.updateAccount(editingAccount.id, payload);
      if (res.success) {
        setIsEditModalOpen(false);
        setEditingAccount(null);
        await fetchAccounts();
      }
    } catch (err) {
      setEditError(err.message || 'Error al actualizar la cuenta');
    } finally {
      setSubmitting(false);
    }
  };

  // Abrir popup de confirmación de borrado
  const handleRequestDelete = (acc) => {
    setAccountToDelete(acc);
    setDeleteConfirmationText('');
    setDeleteError('');
  };

  // Confirmar y procesar borrado
  const handleConfirmDelete = async (e) => {
    e.preventDefault();
    if (!accountToDelete) return;

    if (deleteConfirmationText.trim().toLowerCase() !== 'eliminar') {
      setDeleteError('Debes escribir exactamente la palabra "ELIMINAR" para confirmar.');
      return;
    }

    try {
      setDeleting(true);
      setDeleteError('');
      await api.deleteAccount(accountToDelete.id);
      setAccountToDelete(null);
      await fetchAccounts();
    } catch (err) {
      setDeleteError(err.message || 'No se pudo eliminar la cuenta');
    } finally {
      setDeleting(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR'
    }).format(val || 0);
  };

  const formatIban = (iban) => {
    if (!iban) return null;
    return iban.replace(/(.{4})/g, '$1 ').trim();
  };

  return (
    <div className="accounts-view animate-fade-in">
      {/* Barra superior de Resumen y Acción */}
      <div className="accounts-header">
        <div>
          <h1 className="accounts-title">
            <Landmark className="title-icon" size={28} />
            Mis Entidades y Cuentas
          </h1>
          <p className="accounts-subtitle">
            Estructura jerárquica Banco &gt; Cuentas &gt; Movimientos
          </p>
        </div>

        <button 
          onClick={openCreateModal}
          className="btn-add-account shadow-glow"
        >
          <Plus size={18} />
          <span>Añadir Cuenta</span>
        </button>
      </div>

      {/* Métricas Globales Rápidas */}
      <div className="accounts-stats-row">
        <div className="stat-pill glass-panel">
          <div className="stat-pill-icon bg-blue">
            <Coins size={18} />
          </div>
          <div>
            <div className="stat-pill-label">Patrimonio Total</div>
            <div className="stat-pill-val">{formatCurrency(summary.total_balance)}</div>
          </div>
        </div>

        <div className="stat-pill glass-panel">
          <div className="stat-pill-icon bg-emerald">
            <CreditCard size={18} />
          </div>
          <div>
            <div className="stat-pill-label">Cuentas Corrientes</div>
            <div className="stat-pill-val">{formatCurrency(summary.total_checking)}</div>
          </div>
        </div>

        <div className="stat-pill glass-panel">
          <div className="stat-pill-icon bg-purple">
            <TrendingUp size={18} />
          </div>
          <div>
            <div className="stat-pill-label">Inversión / Cartera</div>
            <div className="stat-pill-val">{formatCurrency(summary.total_investment)}</div>
          </div>
        </div>

        <div className="stat-pill glass-panel">
          <div className="stat-pill-icon bg-amber">
            <Building2 size={18} />
          </div>
          <div>
            <div className="stat-pill-label">Bancos Activos</div>
            <div className="stat-pill-val">{summary.banks_count}</div>
          </div>
        </div>
      </div>

      {/* Listado de Tarjetas de Bancos */}
      {loading ? (
        <div className="accounts-loading glass-panel">
          <div className="spinner"></div>
          <p>Sincronizando entidades bancarias...</p>
        </div>
      ) : bankGroups.length === 0 ? (
        <div className="empty-state-card glass-panel">
          <div className="empty-icon-wrap">
            <WalletCards size={48} />
          </div>
          <h3>Aún no has añadido ninguna cuenta</h3>
          <p>Empieza seleccionando tu banco principal y registra tu primera cuenta corriente o de inversión.</p>
          <button onClick={openCreateModal} className="btn-add-account">
            <Plus size={18} />
            <span>Crear mi primera cuenta</span>
          </button>
        </div>
      ) : (
        <div className="banks-grid">
          {bankGroups.map((group) => {
            const bankData = BANK_DIRECTORY.find(b => b.id === group.bank.id) || group.bank;
            return (
              <div 
                key={group.bank.id} 
                className="bank-card glass-panel"
                style={{ '--bank-color': bankData.color || '#0284c7' }}
              >
                {/* Cabecera del Banco */}
                <div className="bank-card-header">
                  <div className="bank-badge-title">
                    <div 
                      className="bank-logo-chip" 
                      style={{ backgroundColor: bankData.color || '#3b82f6' }}
                    >
                      {bankData.initials || bankData.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="bank-name">{bankData.name}</h2>
                      <span className="bank-accounts-count">
                        {group.accounts.length} {group.accounts.length === 1 ? 'cuenta' : 'cuentas'}
                      </span>
                    </div>
                  </div>

                  <div className="bank-total-badge">
                    <span className="total-label">Saldo Total</span>
                    <span className="total-amount">{formatCurrency(group.total_balance)}</span>
                  </div>
                </div>

                {/* Lista de Cuentas dentro de la tarjeta del Banco */}
                <div className="bank-accounts-list">
                  {group.accounts.map((acc) => {
                    const isInvestment = acc.account_type === 'investment';
                    return (
                      <div
                        key={acc.id}
                        className="account-row-item"
                        onClick={() => onOpenTransactions?.(acc, bankData)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="account-col-left">
                          <span className="acc-name-compact" title={acc.name}>{acc.name}</span>
                          {acc.iban && (
                            <span className="acc-iban-small" title={acc.iban}>
                              {formatIban(acc.iban)}
                            </span>
                          )}
                        </div>

                        <div className="account-col-right">
                          <span className="acc-balance-val">{formatCurrency(acc.balance)}</span>
                          <span className={`acc-type-text ${isInvestment ? 'investment' : 'checking'}`}>
                            {isInvestment ? 'Inversión' : 'Corriente'}
                          </span>

                          {/* Iconos discretos de modificar y borrar abajo a la derecha en hover */}
                          <div className="acc-actions-hover-corner">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleOpenEdit(acc, bankData); }}
                              className="btn-icon-discreet btn-icon-edit"
                              title="Modificar cuenta"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleRequestDelete(acc); }}
                              className="btn-icon-discreet btn-icon-delete"
                              title="Borrar cuenta"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Modificación de Cuenta */}
      {isEditModalOpen && editingAccount && (
        <div className="modal-backdrop" onClick={() => !submitting && setIsEditModalOpen(false)}>
          <div 
            className="modal-container glass-panel animate-scale-up" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="step-badge">Modificar Cuenta</span>
                <h2>{editingAccount.name}</h2>
              </div>
              <button 
                onClick={() => setIsEditModalOpen(false)} 
                className="modal-close-btn"
                disabled={submitting}
              >
                <X size={20} />
              </button>
            </div>

            {editError && (
              <div className="modal-alert-error">
                <AlertCircle size={16} />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="step-account-form">
              <div className="form-group">
                <label htmlFor="edit-acc-name">Nombre completo de la cuenta *</label>
                <input
                  id="edit-acc-name"
                  type="text"
                  required
                  placeholder="Ej. Cuenta Nómina Principal"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="modal-input"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Tipo de Cuenta *</label>
                <div className="account-type-selector">
                  <button
                    type="button"
                    className={`type-choice-btn ${editFormData.account_type === 'checking' ? 'active' : ''}`}
                    onClick={() => setEditFormData({ ...editFormData, account_type: 'checking' })}
                  >
                    <CreditCard size={20} />
                    <div className="type-choice-text">
                      <span className="type-name">Cuenta Corriente</span>
                      <span className="type-desc">Para operativa diaria, nóminas y recibos</span>
                    </div>
                    {editFormData.account_type === 'checking' && <Check size={18} className="check-icon" />}
                  </button>

                  <button
                    type="button"
                    className={`type-choice-btn ${editFormData.account_type === 'investment' ? 'active' : ''}`}
                    onClick={() => setEditFormData({ ...editFormData, account_type: 'investment' })}
                  >
                    <TrendingUp size={20} />
                    <div className="type-choice-text">
                      <span className="type-name">Cuenta de Inversión</span>
                      <span className="type-desc">Carteras indexadas, fondos, acciones o depósitos</span>
                    </div>
                    {editFormData.account_type === 'investment' && <Check size={18} className="check-icon" />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-acc-balance">Saldo (€)</label>
                <input
                  id="edit-acc-balance"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={editFormData.balance}
                  onChange={(e) => setEditFormData({ ...editFormData, balance: e.target.value })}
                  className="modal-input"
                />
              </div>

              {editFormData.account_type === 'investment' && (
                <div className="form-group">
                  <label htmlFor="edit-acc-initial">Capital invertido inicial (€)</label>
                  <input
                    id="edit-acc-initial"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={editFormData.initial_balance}
                    onChange={(e) => setEditFormData({ ...editFormData, initial_balance: e.target.value })}
                    className="modal-input"
                  />
                  <span className="form-hint">Lo aportado al abrirla. Se usa para calcular la plusvalía y los impuestos.</span>
                </div>
              )}

              <div className="form-row-two">
                <div className="form-group">
                  <label htmlFor="edit-acc-iban">IBAN</label>
                  <input
                    id="edit-acc-iban"
                    type="text"
                    placeholder="ES00 0000 0000 0000 0000"
                    value={editFormData.iban}
                    onChange={(e) => setEditFormData({ ...editFormData, iban: e.target.value })}
                    className="modal-input monospace"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="edit-acc-date">Fecha de Apertura</label>
                  <input
                    id="edit-acc-date"
                    type="date"
                    value={editFormData.opening_date}
                    onChange={(e) => setEditFormData({ ...editFormData, opening_date: e.target.value })}
                    className="modal-input"
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  onClick={() => setIsEditModalOpen(false)} 
                  className="btn-modal-secondary"
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-modal-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Guardando cambios...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Popup de Confirmación para Borrar Cuenta con Texto Obligatorio */}
      {accountToDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setAccountToDelete(null)}>
          <div 
            className="modal-container delete-confirm-modal glass-panel animate-scale-up" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header delete-modal-header">
              <div className="modal-title-wrap">
                <div className="delete-badge-wrap">
                  <AlertTriangle size={20} className="delete-alert-icon" />
                  <span className="delete-step-badge">Acción Destructiva</span>
                </div>
                <h2>Confirmar eliminación de cuenta</h2>
              </div>
              <button 
                onClick={() => setAccountToDelete(null)} 
                className="modal-close-btn"
                disabled={deleting}
              >
                <X size={20} />
              </button>
            </div>

            {deleteError && (
              <div className="modal-alert-error">
                <AlertCircle size={16} />
                <span>{deleteError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmDelete} className="delete-confirm-body">
              <p className="delete-warning-text">
                Estás a punto de borrar la cuenta <strong className="text-highlight">"{accountToDelete.name}"</strong> con saldo de <strong>{formatCurrency(accountToDelete.balance)}</strong>.
              </p>
              <p className="delete-instruction-text">
                Para prevenir eliminaciones accidentales, por favor escribe exactamente la palabra <strong className="text-danger-code">ELIMINAR</strong> en el siguiente campo:
              </p>

              <div className="form-group">
                <input
                  type="text"
                  required
                  placeholder="Escribe ELIMINAR para confirmar"
                  value={deleteConfirmationText}
                  onChange={(e) => {
                    setDeleteConfirmationText(e.target.value);
                    if (deleteError) setDeleteError('');
                  }}
                  className="modal-input delete-confirm-input"
                  autoFocus
                />
              </div>

              <div className="modal-actions delete-actions">
                <button 
                  type="button" 
                  onClick={() => setAccountToDelete(null)} 
                  className="btn-modal-secondary"
                  disabled={deleting}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-modal-danger"
                  disabled={deleting || deleteConfirmationText.trim().toLowerCase() !== 'eliminar'}
                >
                  {deleting ? 'Eliminando...' : 'Eliminar Cuenta Permanentemente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Multi-paso de Creación de Cuenta */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => !submitting && setIsModalOpen(false)}>
          <div 
            className="modal-container glass-panel animate-scale-up" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="step-badge">Paso {createStep} de 2</span>
                <h2>{createStep === 1 ? 'Selecciona tu Entidad Bancaria' : `Configurar Cuenta en ${selectedBank?.name}`}</h2>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="modal-close-btn"
                disabled={submitting}
              >
                <X size={20} />
              </button>
            </div>

            {/* Error Message */}
            {formError && (
              <div className="modal-alert-error">
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            {/* PASO 1: Selección visual de Banco */}
            {createStep === 1 && (
              <div className="step-banks-select">
                <p className="step-instruction">
                  Elige el banco o plataforma para vincular tu nueva cuenta:
                </p>

                <div className="banks-selector-grid">
                  {BANK_DIRECTORY.map((bank) => (
                    <button
                      key={bank.id}
                      type="button"
                      className="bank-pick-card"
                      onClick={() => handleSelectBank(bank)}
                      style={{ '--bank-color': bank.color }}
                    >
                      <div 
                        className="bank-pick-avatar" 
                        style={{ backgroundColor: bank.color }}
                      >
                        {bank.initials}
                      </div>
                      <div className="bank-pick-name">{bank.name}</div>
                      <ArrowRight size={16} className="bank-pick-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PASO 2: Datos de la Cuenta */}
            {createStep === 2 && selectedBank && (
              <form onSubmit={handleSubmit} className="step-account-form">
                {/* Resumen del banco seleccionado */}
                <div 
                  className="selected-bank-banner"
                  style={{ borderLeftColor: selectedBank.color }}
                >
                  <div 
                    className="selected-bank-chip"
                    style={{ backgroundColor: selectedBank.color }}
                  >
                    {selectedBank.initials}
                  </div>
                  <div>
                    <span className="banner-subtitle">Banco seleccionado</span>
                    <h4 className="banner-title">{selectedBank.name}</h4>
                  </div>
                  <button 
                    type="button" 
                    onClick={handleBackToStep1} 
                    className="btn-change-bank"
                  >
                    Cambiar entidad
                  </button>
                </div>

                <div className="form-group">
                  <label htmlFor="acc-name">Nombre descriptivo de la cuenta *</label>
                  <input
                    id="acc-name"
                    type="text"
                    required
                    placeholder="Ej. Cuenta Nómina Principal, Fondo Indexado Vanguard..."
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="modal-input"
                    autoFocus
                  />
                </div>

                {/* Selector de Tipo de Cuenta */}
                <div className="form-group">
                  <label>Tipo de Cuenta *</label>
                  <div className="account-type-selector">
                    <button
                      type="button"
                      className={`type-choice-btn ${formData.account_type === 'checking' ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, account_type: 'checking' })}
                    >
                      <CreditCard size={20} />
                      <div className="type-choice-text">
                        <span className="type-name">Cuenta Corriente</span>
                        <span className="type-desc">Para operativa diaria, nóminas y recibos</span>
                      </div>
                      {formData.account_type === 'checking' && <Check size={18} className="check-icon" />}
                    </button>

                    <button
                      type="button"
                      className={`type-choice-btn ${formData.account_type === 'investment' ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, account_type: 'investment' })}
                    >
                      <TrendingUp size={20} />
                      <div className="type-choice-text">
                        <span className="type-name">Cuenta de Inversión</span>
                        <span className="type-desc">Carteras indexadas, fondos, acciones o depósitos</span>
                      </div>
                      {formData.account_type === 'investment' && <Check size={18} className="check-icon" />}
                    </button>
                  </div>
                </div>

                {/* Saldo Inicial */}
                <div className="form-group">
                  <label htmlFor="acc-balance">Saldo Inicial (€)</label>
                  <input
                    id="acc-balance"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.initial_balance}
                    onChange={(e) => setFormData({ ...formData, initial_balance: e.target.value })}
                    className="modal-input"
                  />
                </div>

                {/* Fila de campos opcionales */}
                <div className="form-row-two">
                  <div className="form-group">
                    <label htmlFor="acc-iban">IBAN (Opcional)</label>
                    <input
                      id="acc-iban"
                      type="text"
                      placeholder="ES00 0000 0000 0000 0000"
                      value={formData.iban}
                      onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                      className="modal-input monospace"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="acc-date">Fecha de Apertura (Opcional)</label>
                    <input
                      id="acc-date"
                      type="date"
                      value={formData.opening_date}
                      onChange={(e) => setFormData({ ...formData, opening_date: e.target.value })}
                      className="modal-input"
                    />
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="modal-actions">
                  <button 
                    type="button" 
                    onClick={handleBackToStep1} 
                    className="btn-modal-secondary"
                    disabled={submitting}
                  >
                    Atrás
                  </button>
                  <button 
                    type="submit" 
                    className="btn-modal-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Guardando cuenta...' : 'Guardar Cuenta'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
