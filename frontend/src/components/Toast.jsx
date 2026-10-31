import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import './Toast.css';

/**
 * Pila de notificaciones. Cada toast: { id, type: 'success' | 'warning', title, message?, items?, autoClose? }
 * items es una lista de líneas de detalle (p. ej. transacciones descartadas).
 */
export default function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast.autoClose) return undefined;
    const timer = setTimeout(() => onDismiss(toast.id), toast.autoClose);
    return () => clearTimeout(timer);
  }, [toast.id, toast.autoClose, onDismiss]);

  const Icon = toast.type === 'warning' ? AlertTriangle : CheckCircle2;

  return (
    <div className={`toast toast-${toast.type} animate-scale-up`}>
      <Icon size={18} className="toast-icon" />
      <div className="toast-body">
        <span className="toast-title">{toast.title}</span>
        {toast.message && <span className="toast-message">{toast.message}</span>}
        {toast.items?.length > 0 && (
          <ul className="toast-items">
            {toast.items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )}
      </div>
      <button className="toast-close" onClick={() => onDismiss(toast.id)} title="Cerrar">
        <X size={14} />
      </button>
    </div>
  );
}
