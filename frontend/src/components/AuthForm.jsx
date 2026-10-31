import React, { useState } from 'react';
import { ShieldCheck, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import './AuthForm.css';

export default function AuthForm({ onLoginSuccess, allowRegistration }) {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    if (error) setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (isLogin) {
        const res = await api.login({
          email: formData.email,
          password: formData.password,
        });
        setSuccessMsg('¡Bienvenido de vuelta! Accediendo a tu portal...');
        setTimeout(() => {
          onLoginSuccess(res.data.user);
        }, 700);
      } else {
        const res = await api.register({
          name: formData.name,
          email: formData.email,
          password: formData.password,
        });
        setSuccessMsg('¡Cuenta financiera creada exitosamente!');
        setTimeout(() => {
          onLoginSuccess(res.data.user);
        }, 800);
      }
    } catch (err) {
      setError(err.message || 'Error en la operación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card glass-panel animate-fade-in">
        <div className="auth-header">
          <div className="brand-badge">
            <ShieldCheck size={28} className="brand-icon" />
          </div>
          <h1 className="brand-title">FinHub <span>2.0</span></h1>
          <p className="brand-subtitle">
            {isLogin ? 'Accede a tus finanzas personales' : 'Crea tu cuenta'}
          </p>
        </div>

        {allowRegistration && <div className="auth-tabs">
          <button
            type="button"
            className={`tab-btn ${isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(true); setError(null); setSuccessMsg(null); }}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            className={`tab-btn ${!isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(false); setError(null); setSuccessMsg(null); }}
          >
            Registrarse
          </button>
        </div>}

        {error && (
          <div className="alert-box alert-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="alert-box alert-success">
            <CheckCircle2 size={18} />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="input-group">
              <label htmlFor="name">Nombre Completo</label>
              <div className="input-inner">
                <User size={18} className="field-icon" />
                <input
                  id="name"
                  type="text"
                  name="name"
                  placeholder="Ej. Roberto Mendoza"
                  value={formData.name}
                  onChange={handleChange}
                  required={!isLogin}
                  autoComplete="name"
                />
              </div>
            </div>
          )}

          <div className="input-group">
            <label htmlFor="email">Correo Electrónico</label>
            <div className="input-inner">
              <Mail size={18} className="field-icon" />
              <input
                id="email"
                type="email"
                name="email"
                placeholder="usuario@finanzas.com"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="input-group">
            <div className="label-row">
              <label htmlFor="password">Contraseña</label>
              {!isLogin && <span className="password-tip">Mín. 8 caracteres (A-Z, a-z, 0-9)</span>}
            </div>
            <div className="input-inner">
              <Lock size={18} className="field-icon" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                placeholder="••••••••••••"
                value={formData.password}
                onChange={handleChange}
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="submit-btn" 
            disabled={loading}
          >
            {loading ? (
              <span className="spinner-row">
                <span className="spinner"></span> Procesando…
              </span>
            ) : (
              <>
                <span>{isLogin ? 'Entrar' : 'Crear cuenta'}</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {allowRegistration && <div className="auth-footer">
          <p>
            {isLogin ? '¿Aún no tienes cuenta?' : '¿Ya tienes una cuenta registrada?'}{' '}
            <button
              type="button"
              className="switch-link"
              onClick={() => { setIsLogin(!isLogin); setError(null); setSuccessMsg(null); }}
            >
              {isLogin ? 'Regístrate aquí' : 'Inicia sesión'}
            </button>
          </p>
        </div>}
      </div>
    </div>
  );
}
