import React, { useState, useMemo, useRef } from 'react';
import { X, AlertCircle, ArrowLeft, Upload, ClipboardPaste, FileSpreadsheet } from 'lucide-react';
import { api } from '../services/api';
import { COLUMN_ROLES, ACCEPTED_FILES, splitRows, readImportFile, guessMapping, buildTransactions } from '../utils/importParser';

const PREVIEW_ROWS = 8;

/**
 * Carga masiva en dos pasos: pegar el texto o subir el fichero del banco, y asignar columnas.
 * onDone recibe { imported, categorized, discarded } al terminar.
 */
export default function ImportTransactionsModal({ account, onClose, onDone }) {
  const [step, setStep]           = useState('paste'); // 'paste' | 'map'
  const [text, setText]           = useState('');
  const [parsed, setParsed]       = useState({ rows: [], columnCount: 0 });
  const [roles, setRoles]         = useState([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError]         = useState('');
  const [fileName, setFileName]   = useState('');
  const [dragging, setDragging]   = useState(false);
  const fileInputRef              = useRef(null);

  const goToMapping = (result, emptyMessage) => {
    if (result.rows.length === 0) { setError(emptyMessage); return; }
    if (result.columnCount < 3) { setError('No se han detectado columnas. Usa el fichero original del banco o copia las filas directamente de él.'); return; }
    const guess = guessMapping(result.rows, result.columnCount);
    setParsed(result);
    setRoles(guess.roles);
    setHasHeader(guess.hasHeader);
    setError('');
    setStep('map');
  };

  const handleContinue = (e) => {
    e.preventDefault();
    setFileName('');
    goToMapping(splitRows(text), 'Pega al menos una fila.');
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const result = await readImportFile(file);
      setFileName(file.name);
      goToMapping(result, 'No se han encontrado movimientos en el fichero.');
    } catch (err) {
      setError(err.message || 'No se pudo leer el fichero.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  // Cada rol (salvo "Ignorar") solo puede estar en una columna
  const setColumnRole = (index, role) => {
    setRoles((prev) => prev.map((r, i) => {
      if (i === index) return role;
      return role !== 'ignore' && r === role ? 'ignore' : r;
    }));
  };

  const missingRoles = ['date', 'concept', 'amount'].filter((r) => !roles.includes(r));

  const built = useMemo(
    () => (missingRoles.length === 0 ? buildTransactions(parsed.rows, roles, hasHeader) : null),
    [parsed, roles, hasHeader, missingRoles.length]
  );

  const handleImport = async () => {
    if (!built || built.valid.length === 0) return;
    try {
      setImporting(true);
      setError('');
      const res = await api.importTransactions(account.id, built.valid);
      const discarded = [...built.invalid, ...(res.data?.skipped ?? [])].sort((a, b) => a.line - b.line);
      onDone({ imported: res.data?.imported ?? 0, categorized: res.data?.categorized ?? 0, discarded });
    } catch (err) {
      setError(err.message || 'No se pudo completar la importación.');
      setImporting(false);
    }
  };

  const close = () => !importing && onClose();
  const roleLabel = (id) => COLUMN_ROLES.find((r) => r.id === id)?.label;
  const previewRows = parsed.rows.slice(0, PREVIEW_ROWS + (hasHeader ? 1 : 0));

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className={`modal-container glass-panel animate-scale-up ${step === 'map' ? 'import-map-modal' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="step-badge">
              {step === 'paste' ? 'Importar · Paso 1 de 2' : 'Importar · Paso 2 de 2'}
            </span>
            <h2>{step === 'paste' ? 'Sube o pega los movimientos' : 'Asigna las columnas'}</h2>
            {step === 'map' && fileName && <span className="import-file-name">{fileName}</span>}
          </div>
          <button className="modal-close-btn" onClick={close} disabled={importing}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="modal-alert-error"><AlertCircle size={16} /><span>{error}</span></div>
        )}

        {step === 'paste' ? (
          <form onSubmit={handleContinue} className="tx-form step-account-form">
            <div
              className={`import-dropzone ${dragging ? 'is-dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
            >
              <FileSpreadsheet size={28} />
              <span className="import-dropzone-title">Arrastra aquí el fichero del banco o haz clic para seleccionarlo</span>
              <span className="import-dropzone-hint">CSV, TXT o XLS tal como lo descargas del banco</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILES}
                hidden
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>

            <div className="import-divider"><span>o pega las filas</span></div>

            <textarea
              className="modal-input import-textarea"
              placeholder={'28/10/2026\tNOMINA ...\t28/10/2026\t2427,51\t34884,11'}
              value={text}
              onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
              spellCheck={false}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="btn-modal-secondary" onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="btn-modal-primary" disabled={!text.trim()}>
                <ClipboardPaste size={16} />
                <span>Continuar</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="tx-form step-account-form">
            <p className="import-help">
              Indica qué columna es la <strong>fecha</strong>, el <strong>concepto</strong> y el{' '}
              <strong>importe</strong>. El resto se ignoran. Los importes negativos se registran como gastos
              y los positivos como ingresos.
            </p>

            <label className="tx-rule-option import-header-option">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span>La primera fila es una cabecera</span>
            </label>

            <div className="import-preview-wrap">
              <table className="import-preview">
                <thead>
                  <tr>
                    {roles.map((role, i) => (
                      <th key={i}>
                        <select
                          className={`import-role-select role-${role}`}
                          value={role}
                          onChange={(e) => setColumnRole(i, e.target.value)}
                          aria-label={`Columna ${i + 1}`}
                        >
                          {COLUMN_ROLES.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={row.line} className={hasHeader && ri === 0 ? 'is-header' : ''}>
                      {row.cells.map((cell, ci) => (
                        <td key={ci} className={`role-${roles[ci]}`} title={cell}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > previewRows.length && (
              <span className="import-more">… y {parsed.rows.length - previewRows.length} filas más</span>
            )}

            <div className="import-summary">
              {missingRoles.length > 0 ? (
                <span className="import-summary-warn">
                  Falta asignar: {missingRoles.map(roleLabel).join(', ')}
                </span>
              ) : (
                <>
                  <span><strong>{built.valid.length}</strong> listas para importar</span>
                  {built.invalid.length > 0 && (
                    <span className="import-summary-warn">{built.invalid.length} con errores se descartarán</span>
                  )}
                  <span className="import-summary-note">Los duplicados se detectan al importar</span>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-modal-secondary" onClick={() => setStep('paste')} disabled={importing}>
                <ArrowLeft size={16} />
                <span>Volver</span>
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={handleImport}
                disabled={importing || !built || built.valid.length === 0}
              >
                <Upload size={16} />
                <span>{importing ? 'Importando...' : `Importar ${built?.valid.length ?? 0} transacciones`}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
