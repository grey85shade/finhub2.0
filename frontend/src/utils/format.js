// Formatos y utilidades de fecha compartidos por las vistas de resumen.

// useGrouping 'always': en es-ES los importes de 4 cifras no llevan separador de miles por defecto
const currencyFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const compactFmt = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export const formatCurrency = (v) => currencyFmt.format(v ?? 0);
export const formatCompact = (v) => `${compactFmt.format(v)} €`;
export const formatPct = (v) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;

const pad = (n) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD. */
export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso) => new Date(`${iso}T00:00:00`);

export const monthName = (iso, style = 'long') => fromIso(iso).toLocaleDateString('es-ES', { month: style });
export const monthLabel = (ym) =>
  fromIso(`${ym}-01`).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }).replace('.', '');
export const formatDay = (iso, opts = { day: '2-digit', month: '2-digit', year: '2-digit' }) =>
  fromIso(iso).toLocaleDateString('es-ES', opts);
