import React, { useState, useEffect } from 'react';
import AuthForm from './components/AuthForm';
import Dashboard from './components/Dashboard';
import InstallWizard from './components/InstallWizard';
import { api } from './services/api';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);

  // Estado del servidor: sin instalar se muestra el asistente; instalado, si admite registros
  const loadStatus = async () => {
    try {
      setStatusError(null);
      const res = await api.getStatus();
      setStatus(res.data);
      return res.data;
    } catch (err) {
      setStatusError(err.message || 'No se puede conectar con la API.');
      return null;
    }
  };

  useEffect(() => {
    // Verificar si existe una sesión previa válida
    const checkSession = async () => {
      const current = await loadStatus();
      if (!current?.installed) {
        setInitializing(false);
        return;
      }
      const token = api.getToken();
      if (!token) {
        setInitializing(false);
        return;
      }

      try {
        const response = await api.getProfile();
        if (response.success && response.data?.user) {
          setCurrentUser(response.data.user);
        } else {
          api.setToken(null);
        }
      } catch (err) {
        // Token expirado o inválido
        api.setToken(null);
      } finally {
        setInitializing(false);
      }
    };

    checkSession();
  }, []);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
  };

  if (initializing) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-muted)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 1rem' }}></div>
          <p style={{ fontSize: '0.9rem', letterSpacing: '0.02em' }}>Iniciando FinHub…</p>
        </div>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card glass-panel" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-main)', marginBottom: '0.5rem' }}>No se puede conectar con la API de FinHub.</p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{statusError}</p>
          <button type="button" className="submit-btn" onClick={loadStatus}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (status && !status.installed) {
    return <InstallWizard status={status} onInstalled={loadStatus} />;
  }

  return (
    <div>
      {currentUser ? (
        <Dashboard user={currentUser} onLogout={handleLogout} />
      ) : (
        <AuthForm onLoginSuccess={handleLoginSuccess} allowRegistration={!!status?.allow_registration} />
      )}
    </div>
  );
}

export default App;
