import React, { useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, Settings, ShieldCheck, User, XCircle,
} from 'lucide-react';
import { api } from '../services/api';
import './AuthForm.css';
import './InstallWizard.css';

const STEPS = [
  { key: 'requirements', label: 'Requisitos', icon: ShieldCheck },
  { key: 'database', label: 'Base de datos', icon: Database },
  { key: 'admin', label: 'Administrador', icon: User },
  { key: 'settings', label: 'Ajustes', icon: Settings },
];

const browserTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'; } catch { return 'Europe/Madrid'; }
};

const timezones = () => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return [browserTimezone()]; }
};

/**
 * Asistente de la primera instalación: requisitos del servidor, conexión a la base de datos, cuenta de
 * administrador y ajustes. Solo aparece mientras no existe api/config/config.local.php.
 */
export default function InstallWizard({ status, onInstalled }) {
  const [step, setStep] = useState(0);
  const [db, setDb] = useState({ host: 'localhost', port: '3306', database: 'finhub', username: '', password: '' });
  const [dbCheck, setDbCheck] = useState(null); // resultado de la última prueba correcta
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', confirm: '' });
  const [settings, setSettings] = useState({ timezone: browserTimezone(), allow_registration: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const zones = useMemo(() => timezones(), []);

  const requirementsOk = status.requirements.every((r) => r.ok || !r.required);
  const existing = dbCheck?.existing_install;
  // Con una instalación previa en la base de datos no se crea administrador: se conservan sus usuarios
  const steps = existing ? STEPS.filter((s) => s.key !== 'admin') : STEPS;
  const current = steps[step].key;

  const fail = (err) => setError(err.errors ? Object.values(err.errors).join(' ') : err.message);

  const setDbField = (key) => (e) => { setDb({ ...db, [key]: e.target.value }); setDbCheck(null); setError(null); };
  const setAdminField = (key) => (e) => { setAdmin({ ...admin, [key]: e.target.value }); setError(null); };

  const testDb = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.testInstallDatabase({ ...db, port: Number(db.port) });
      setDbCheck({ ...res.data, message: res.message });
    } catch (err) {
      setDbCheck(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const adminError = () => {
    if (admin.name.trim().length < 2) return 'Indica tu nombre.';
    if (!/^\S+@\S+\.\S+$/.test(admin.email)) return 'El correo electrónico no es válido.';
    if (admin.password.length < 8 || !/[A-Z]/.test(admin.password) || !/[a-z]/.test(admin.password) || !/\d/.test(admin.password)) {
      return 'La contraseña necesita 8 caracteres como mínimo, con mayúsculas, minúsculas y números.';
    }
    if (admin.password !== admin.confirm) return 'Las contraseñas no coinciden.';
    return null;
  };

  const next = () => {
    if (current === 'admin') {
      const message = adminError();
      if (message) { setError(message); return; }
    }
    setError(null);
    setStep(step + 1);
  };

  const back = () => { setError(null); setStep(step - 1); };

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.install({
        db: { ...db, port: Number(db.port) },
        admin: existing ? undefined : { name: admin.name, email: admin.email, password: admin.password },
        settings,
      });
      setDone(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="install-done">
          <CheckCircle2 size={44} />
          <h2>FinHub está listo</h2>
          <p>
            {existing
              ? 'Se ha conectado con la base de datos existente. Inicia sesión con tu cuenta de siempre.'
              : `Inicia sesión con ${admin.email} y la contraseña que acabas de elegir.`}
          </p>
          <p className="install-hint">
            Por seguridad, ya puedes quitar el permiso de escritura de la carpeta <code>api/config</code>.
          </p>
          <button type="button" className="submit-btn" onClick={onInstalled}>
            <span>Ir a iniciar sesión</span><ArrowRight size={18} />
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <ol className="install-steps">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.key} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>
              <Icon size={15} /> <span>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="alert-box alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {current === 'requirements' && (
        <section className="install-section">
          <p className="install-intro">
            Vamos a preparar FinHub en este servidor. Necesitarás los datos de una base de datos MySQL o MariaDB.
          </p>
          <ul className="install-reqs">
            {status.requirements.map((r) => (
              <li key={r.key} className={r.ok ? 'is-ok' : r.required ? 'is-fail' : 'is-warn'}>
                {r.ok ? <CheckCircle2 size={17} /> : r.required ? <XCircle size={17} /> : <AlertTriangle size={17} />}
                <span>
                  <strong>{r.label}</strong>
                  <small>{r.detail}</small>
                </span>
              </li>
            ))}
          </ul>
          {!status.https && (
            <div className="install-note">
              <AlertTriangle size={16} />
              <span>
                Estás usando HTTP sin cifrar. En una red local es aceptable, pero si vas a acceder desde fuera
                configura HTTPS en el servidor (en Synology: Panel de control → Seguridad → Certificado).
              </span>
            </div>
          )}
          {!requirementsOk && (
            <p className="install-hint">Corrige los requisitos marcados en rojo y recarga esta página.</p>
          )}
        </section>
      )}

      {current === 'database' && (
        <section className="install-section">
          <p className="install-intro">
            Crea antes un usuario de base de datos para FinHub (en Synology, con phpMyAdmin). Si la base de datos no
            existe, el asistente la creará si el usuario tiene permiso.
          </p>
          <div className="install-grid">
            <Field label="Servidor" value={db.host} onChange={setDbField('host')} placeholder="localhost" />
            <Field label="Puerto" value={db.port} onChange={setDbField('port')} type="number" hint="MySQL: 3306 · MariaDB 10 en Synology: 3307" />
          </div>
          <Field label="Nombre de la base de datos" value={db.database} onChange={setDbField('database')} />
          <div className="install-grid">
            <Field label="Usuario" value={db.username} onChange={setDbField('username')} autoComplete="off" />
            <Field label="Contraseña" value={db.password} onChange={setDbField('password')} type="password" autoComplete="new-password" />
          </div>
          <button type="button" className="install-secondary" onClick={testDb} disabled={busy || !db.host || !db.username || !db.database}>
            <Database size={16} /> {busy ? 'Probando…' : 'Probar conexión'}
          </button>
          {dbCheck && (
            <div className="alert-box alert-success">
              <CheckCircle2 size={18} />
              <span>{dbCheck.message} <small className="install-server">({dbCheck.server})</small></span>
            </div>
          )}
        </section>
      )}

      {current === 'admin' && (
        <section className="install-section">
          <p className="install-intro">Esta será la cuenta de administrador. Podrás usarla también para tus finanzas.</p>
          <Field label="Nombre" value={admin.name} onChange={setAdminField('name')} autoComplete="name" />
          <Field label="Correo electrónico" value={admin.email} onChange={setAdminField('email')} type="email" autoComplete="email" />
          <div className="install-grid">
            <Field label="Contraseña" value={admin.password} onChange={setAdminField('password')} type="password" autoComplete="new-password"
              hint="Mín. 8 caracteres (A-Z, a-z, 0-9)" />
            <Field label="Repite la contraseña" value={admin.confirm} onChange={setAdminField('confirm')} type="password" autoComplete="new-password" />
          </div>
        </section>
      )}

      {current === 'settings' && (
        <section className="install-section">
          <div className="input-group">
            <label htmlFor="install-tz">Zona horaria</label>
            <select id="install-tz" className="install-input" value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
            </select>
            <span className="password-tip">Decide qué es «hoy» para el resumen del mes, los gastos previstos y las proyecciones.</span>
          </div>
          <label className="install-check">
            <input type="checkbox" checked={settings.allow_registration}
              onChange={(e) => setSettings({ ...settings, allow_registration: e.target.checked })} />
            <span>
              <strong>Permitir que otras personas se registren</strong>
              <small>
                Cada persona tendrá sus propias cuentas y datos. Déjalo desactivado si FinHub es solo para ti
                o si es accesible desde fuera de tu red.
              </small>
            </span>
          </label>
          <dl className="install-summary">
            <div><dt>Base de datos</dt><dd>{db.database} en {db.host}:{db.port}</dd></div>
            <div><dt>Administrador</dt><dd>{existing ? 'Se conservan los usuarios existentes' : admin.email}</dd></div>
          </dl>
        </section>
      )}

      <div className="install-nav">
        {step > 0 && (
          <button type="button" className="install-secondary" onClick={back} disabled={busy}>
            <ArrowLeft size={16} /> Atrás
          </button>
        )}
        {current === 'settings' ? (
          <button type="button" className="submit-btn" onClick={install} disabled={busy}>
            {busy ? <span className="spinner-row"><span className="spinner"></span> Instalando…</span> : <><span>Instalar FinHub</span><ArrowRight size={18} /></>}
          </button>
        ) : (
          <button type="button" className="submit-btn" onClick={next}
            disabled={busy || (current === 'requirements' && !requirementsOk) || (current === 'database' && !dbCheck)}>
            <span>Continuar</span><ArrowRight size={18} />
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="auth-wrapper">
      <div className="auth-card glass-panel animate-fade-in install-card">
        <div className="auth-header">
          <div className="brand-badge"><ShieldCheck size={28} className="brand-icon" /></div>
          <h1 className="brand-title">FinHub <span>instalación</span></h1>
          <p className="brand-subtitle">Configuración inicial del servidor</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, ...props }) {
  const id = `install-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="install-input" required {...props} />
      {hint && <span className="password-tip">{hint}</span>}
    </div>
  );
}
