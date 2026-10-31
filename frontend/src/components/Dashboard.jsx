import React, { useState } from 'react';
import { 
  ShieldCheck, 
  LogOut, 
  CreditCard,
  Lock,
  Home,
  Receipt,
  Tags,
  Scale,
  Sparkles,
  PieChart,
  Settings
} from 'lucide-react';
import Dock from './Dock';
import AccountsView from './AccountsView';
import CategoriesView from './CategoriesView';
import TransactionsView from './TransactionsView';
import DashboardHome from './DashboardHome';
import ExpensesView from './ExpensesView';
import BalanceView from './BalanceView';
import ProjectionView from './ProjectionView';
import InvestmentsView from './InvestmentsView';
import './Dashboard.css';

export default function Dashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('inicio');
  const [selectedAccount, setSelectedAccount] = useState(null); // { account, bankData }
  const [expensesFocus, setExpensesFocus] = useState(null); // filtro inicial al abrir Gastos desde el resumen

  const navCategories = [
    { id: 'inicio', label: 'Inicio', icon: <Home /> },
    { id: 'cuentas', label: 'Cuentas', icon: <CreditCard /> },
    { id: 'gastos', label: 'Gastos', icon: <Receipt /> },
    { id: 'categorias', label: 'Categorías', icon: <Tags /> },
    { id: 'balances', label: 'Balances', icon: <Scale /> },
    { id: 'proyecciones', label: 'Proyecciones', icon: <Sparkles /> },
    { id: 'inversiones', label: 'Inversiones', icon: <PieChart /> },
    { id: 'ajustes', label: 'Ajustes', icon: <Settings /> },
  ];
  return (
    <div className="dashboard-container animate-fade-in">
      <header className="dash-header glass-panel">
        <div className="dash-brand">
          <div className="dash-logo">
            <ShieldCheck size={24} />
          </div>
          <div className="dash-title-wrap">
            <span className="dash-title">FinHub <span>2.0</span></span>
            <span className="dash-badge"><Lock size={12} /> Cifrado Activo</span>
          </div>
        </div>

        <div className="dash-user-controls">
          <div className="user-profile-badge" title={`${user?.name || 'Usuario'} · ${user?.email || ''}`}>
            <div className="user-avatar">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="user-details">
              <span className="user-name">{user?.name || 'Usuario'}</span>
              <span className="user-email">{user?.email}</span>
            </div>
          </div>
          <button onClick={onLogout} className="logout-btn" title="Cerrar sesión">
            <LogOut size={18} />
            <span className="logout-label">Salir</span>
          </button>
        </div>
      </header>

      <main className="dash-content">
        {selectedAccount ? (
          <TransactionsView
            account={selectedAccount.account}
            bankData={selectedAccount.bankData}
            onBack={() => setSelectedAccount(null)}
          />
        ) : activeTab === 'cuentas' ? (
          <AccountsView onOpenTransactions={(account, bankData) => setSelectedAccount({ account, bankData })} />
        ) : activeTab === 'gastos' ? (
          <ExpensesView key={expensesFocus ? `${expensesFocus.type}-${expensesFocus.key}` : 'all'} initialFocus={expensesFocus} />
        ) : activeTab === 'balances' ? (
          <BalanceView />
        ) : activeTab === 'proyecciones' ? (
          <ProjectionView />
        ) : activeTab === 'inversiones' ? (
          <InvestmentsView onOpenAccount={(account, bankData) => setSelectedAccount({ account, bankData })} />
        ) : activeTab === 'categorias' ? (
          <CategoriesView />
        ) : activeTab === 'inicio' ? (
          <DashboardHome
            user={user}
            onOpenAccount={(account, bankData) => setSelectedAccount({ account, bankData })}
            onOpenExpenses={(focus) => { setExpensesFocus(focus); setActiveTab('gastos'); }}
          />
        ) : (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', borderRadius: '16px' }}>
            <h3 style={{ fontSize: '1.25rem', color: '#f8fafc', marginBottom: '0.5rem' }}>
              Módulo de {navCategories.find(c => c.id === activeTab)?.label}
            </h3>
            <p style={{ color: '#94a3b8' }}>Esta sección se implementará en los próximos pasos del roadmap.</p>
          </div>
        )}
      </main>

      {/* Menú Dock interactivo estilo macOS (React Bits) */}
      <Dock 
        items={navCategories}
        activeId={activeTab}
        onSelect={(id) => { setSelectedAccount(null); setExpensesFocus(null); setActiveTab(id); }}
        panelHeight={44}
        baseItemSize={34}
        magnification={54}
        roundness={0.6}
        distance={150}
      />
    </div>
  );
}
