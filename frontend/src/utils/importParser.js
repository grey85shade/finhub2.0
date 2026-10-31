// Interpretación del texto pegado o de los ficheros de cada banco para la carga masiva.

export const COLUMN_ROLES = [
  { id: 'ignore',  label: 'Ignorar' },
  { id: 'date',    label: 'Fecha' },
  { id: 'concept', label: 'Concepto' },
  { id: 'amount',  label: 'Importe' },
];

export const ACCEPTED_FILES = '.csv,.tsv,.txt,.xls,.htm,.html';

// Filas con menos celdas rellenas se consideran cabeceras informativas del extracto
// (nº de cuenta, titular, saldo...) y no movimientos.
const MIN_FILLED_CELLS = 3;

/** Divide una línea respetando las comillas de CSV ("a, b" es una sola celda). */
function splitLine(raw, delimiter) {
  if (delimiter instanceof RegExp) return raw.split(delimiter);
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"' && raw[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Detecta el separador: tabulador, punto y coma, coma (si es consistente) o espacios múltiples. */
function detectDelimiter(lines) {
  if (lines.some((l) => l.includes('\t'))) return '\t';
  if (lines.some((l) => l.includes(';'))) return ';';
  // La coma también es separador decimal: solo se usa si todas las líneas tienen las mismas columnas
  const counts = lines.map((l) => splitLine(l, ',').length);
  if (counts[0] >= MIN_FILLED_CELLS && counts.every((c) => c === counts[0])) return ',';
  return /\s{2,}/;
}

/**
 * Limpia la tabla: descarta filas que no parecen movimientos y columnas siempre vacías,
 * y rellena las celdas que faltan al final (p. ej. el saldo de un movimiento pendiente).
 */
function normalizeTable(rawRows) {
  const rows = rawRows
    .map((r) => ({ ...r, cells: r.cells.map((c) => (c ?? '').replace(/\s+/g, ' ').trim()) }))
    .filter((r) => r.cells.filter(Boolean).length >= MIN_FILLED_CELLS);

  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const usedColumns = [...Array(width).keys()].filter((i) => rows.some((r) => r.cells[i]));
  const normalized = rows.map((r) => ({ line: r.line, cells: usedColumns.map((i) => r.cells[i] ?? '') }));

  return { rows: normalized, columnCount: usedColumns.length };
}

/** Divide el texto pegado (o un CSV) en filas y columnas. */
export function splitRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw, line: i + 1 }))
    .filter(({ raw }) => raw.trim() !== '');
  if (lines.length === 0) return { rows: [], columnCount: 0 };

  const delimiter = detectDelimiter(lines.map((l) => l.raw));
  return normalizeTable(lines.map(({ raw, line }) => ({ line, cells: splitLine(raw, delimiter) })));
}

/** Tabla HTML (los .xls que exportan muchos bancos son en realidad HTML). */
export function parseHtmlTable(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('tr')].map((tr, i) => {
    const cells = [];
    tr.querySelectorAll('td, th').forEach((td) => {
      cells.push(td.textContent);
      for (let c = 1; c < (parseInt(td.getAttribute('colspan'), 10) || 1); c++) cells.push('');
    });
    return { line: i + 1, cells };
  });
  return normalizeTable(rows);
}

/** Decodifica respetando el charset declarado en el HTML, o UTF-8 con alternativa Windows-1252. */
function decodeText(buffer) {
  const head = new TextDecoder('latin1').decode(buffer.slice(0, 2048));
  const declared = head.match(/charset=["']?([\w-]+)/i)?.[1];
  if (declared) {
    try { return new TextDecoder(declared).decode(buffer); } catch { /* charset desconocido */ }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Lee un fichero de banco (CSV/TXT o XLS en formato HTML). Lanza un Error con mensaje para el usuario. */
export async function readImportFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isBiff = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isZip || isBiff) {
    throw new Error('Este Excel no se puede leer directamente. Ábrelo y guárdalo como CSV, o copia las filas y pégalas.');
  }

  const text = decodeText(buffer);
  return /<table[\s>]/i.test(text) ? parseHtmlTable(text) : splitRows(text);
}

const pad = (n) => String(n).padStart(2, '0');

const toIsoDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Acepta "2026-10-03", "2026-10-03 18:09:23", "28/10/2026", "28-10-26", "28.10.2026". */
export function parseDate(value) {
  const s = (value ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return toIsoDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return toIsoDate(year, +m[2], +m[1]);
  }
  return null;
}

/** Acepta "-12,59", "2427,51", "-52.72", "1.234,56", "1,234.56", "52,72-", "-4 €". */
export function parseAmount(value) {
  let s = (value ?? '').replace(/[\s €]|EUR/gi, '').replace(/[−–]/g, '-');
  if (!s) return null;

  let negative = false;
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // El separador que aparece último es el decimal
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1 || lastDot !== -1) {
    // Un único separador seguido de exactamente 3 cifras ("1.234") se toma como miles
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = s.split(sep);
    const thousands = parts.length > 2 || parts[1].length === 3;
    s = thousands ? parts.join('') : parts.join('.');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  return negative ? -n : n;
}

const ratio = (values, test) => {
  const filled = values.filter((v) => v !== '');
  if (filled.length === 0) return 0;
  return filled.filter(test).length / filled.length;
};

/** Propone qué columna es la fecha, el concepto y el importe, y si la primera fila es cabecera. */
export function guessMapping(rows, columnCount) {
  const roles = Array(columnCount).fill('ignore');
  if (rows.length === 0) return { roles, hasHeader: false };

  const body = rows.length > 1 ? rows.slice(1) : rows;
  const column = (i) => body.map((r) => r.cells[i]);

  const dateCol = [...Array(columnCount).keys()].find((i) => ratio(column(i), (v) => parseDate(v) !== null) >= 0.6);
  if (dateCol !== undefined) roles[dateCol] = 'date';

  const amountCol = [...Array(columnCount).keys()].find(
    (i) => roles[i] === 'ignore' && ratio(column(i), (v) => parseAmount(v) !== null) >= 0.6
  );
  if (amountCol !== undefined) roles[amountCol] = 'amount';

  // El concepto es la columna de texto con más valores distintos
  let best = -1;
  let bestDistinct = 1;
  for (let i = 0; i < columnCount; i++) {
    if (roles[i] !== 'ignore') continue;
    const values = column(i).filter((v) => v !== '' && parseAmount(v) === null && parseDate(v) === null);
    const distinct = new Set(values).size;
    if (distinct > bestDistinct) { best = i; bestDistinct = distinct; }
  }
  if (best !== -1) roles[best] = 'concept';

  const hasHeader = rows.length > 1 && dateCol !== undefined && parseDate(rows[0].cells[dateCol]) === null;
  return { roles, hasHeader };
}

/**
 * Convierte las filas según la asignación de columnas.
 * Devuelve las válidas en orden cronológico y las descartadas con su motivo.
 */
export function buildTransactions(rows, roles, hasHeader) {
  const dateCol = roles.indexOf('date');
  const conceptCol = roles.indexOf('concept');
  const amountCol = roles.indexOf('amount');

  const valid = [];
  const invalid = [];
  (hasHeader ? rows.slice(1) : rows).forEach(({ line, cells }) => {
    const date = parseDate(cells[dateCol]);
    const concept = (cells[conceptCol] ?? '').replace(/\s+/g, ' ').trim();
    const amount = parseAmount(cells[amountCol]);
    const base = {
      line,
      date: date ?? cells[dateCol] ?? '',
      concept,
      amount: amount ?? cells[amountCol] ?? '',
      raw: cells.filter(Boolean).join(' · '),
    };

    if (!date) invalid.push({ ...base, reason: 'Fecha no válida' });
    else if (!concept) invalid.push({ ...base, reason: 'Concepto vacío' });
    else if (amount === null) invalid.push({ ...base, reason: 'Importe no válido' });
    else valid.push({ line, date, concept, amount });
  });

  // Muchos bancos exportan del más reciente al más antiguo: se invierte para conservar
  // el orden real dentro de un mismo día y después se ordena por fecha (orden estable).
  if (valid.length > 1 && valid[0].date > valid[valid.length - 1].date) valid.reverse();
  valid.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { valid, invalid };
}
