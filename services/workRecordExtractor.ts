/**
 * workRecordExtractor — extracción de registros históricos (ExtractedWorkRecord)
 * a partir de un UploadedDocument YA extraído (texto y/o tablas).
 *
 * Reglas aplicadas:
 *  - R5/R6: todo registro nace SIEMPRE en `review_status: "pending_review"`.
 *  - R8: cada registro lleva `document_id` + `source_location` (página/línea/celda/
 *    snippet) para trazabilidad.
 *  - R12: NUNCA inventa cifras. Lo que no se encuentra => `null` o `"unknown"`.
 *  - R14: `confidence_level` "low" cuando hay ambigüedad (texto libre, pocos
 *    datos), "medium" cuando viene de tablas con columnas financieras detectadas.
 *  - R4: sólo extrae/sugiere; jamás aprueba (approved_by/at/rejected_reason null).
 *
 * La clasificación de servicio (service_category/subcategory) se delega de forma
 * OPCIONAL en ./serviceClassifier.ts mediante import() dinámico dentro de
 * try/catch. Si no está disponible, se deja "unknown" (R12).
 */

import { recordsRepo } from '../backend/storage/index.ts';
import { DEFAULT_CURRENCY } from '../backend/config/factors.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import type {
  UploadedDocument, ExtractedWorkRecord, ExtractedTable, SourceLocation,
  FeeType, ConfidenceLevel,
} from '../backend/models/index.ts';
import { FEE_TYPE_VALUES } from '../backend/models/index.ts';

// ----------------------------------------------------------------------------
// Tipos internos auxiliares (no se exportan: detalle de implementación)
// ----------------------------------------------------------------------------

/** Datos crudos extraídos de una fuente (fila o bloque de texto) antes de armar el registro. */
interface RawFields {
  client_name: string | null;
  matter_name: string | null;
  service_description: string | null;
  date: string | null;
  total_fee: number | null;
  currency: string | null;
  fee_type: FeeType;
  hours_worked: number | null;
  hourly_rate: number | null;
  discounts: number | null;
  source_location: SourceLocation[];
}

// ----------------------------------------------------------------------------
// Utilidades de parseo numérico / fechas (deterministas, sin inventar)
// ----------------------------------------------------------------------------

/**
 * Convierte un texto en número respetando formatos europeos y anglosajones.
 * Devuelve null si no hay un número claro (R12: no inventa).
 * Ejemplos: "2.500,50 €" -> 2500.5 ; "2,500.50" -> 2500.5 ; "1500" -> 1500.
 */
function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (s === '') return null;
  // Quita símbolos de moneda y espacios; conserva dígitos, signos y separadores.
  s = s.replace(/[€$£%]/g, '').replace(/eur|euros?|usd|gbp/gi, '').trim();
  // Captura el primer token numérico (admite . y , como separadores).
  const m = s.match(/-?\d[\d.,\s]*\d|-?\d/);
  if (!m) return null;
  let token = m[0].replace(/\s/g, '');
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');
  if (hasComma && hasDot) {
    // El último separador que aparezca es el decimal.
    if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
      token = token.replace(/\./g, '').replace(',', '.'); // formato europeo
    } else {
      token = token.replace(/,/g, ''); // formato anglosajón
    }
  } else if (hasComma) {
    // Una sola coma: decimal si hay 1-2 dígitos tras ella, si no separador de miles.
    const parts = token.split(',');
    if (parts.length === 2 && parts[1].length <= 2) token = token.replace(',', '.');
    else token = token.replace(/,/g, '');
  } else if (hasDot) {
    const parts = token.split('.');
    // Varios puntos => separadores de miles; un punto con 3 decimales => miles.
    if (parts.length > 2) token = token.replace(/\./g, '');
    else if (parts.length === 2 && parts[1].length === 3) token = token.replace(/\./g, '');
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** Normaliza una moneda detectada en texto a su código (o null). */
function parseCurrency(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  if (/€|eur|euros?/i.test(s)) return 'EUR';
  if (/\$|usd|d[oó]lar/i.test(s)) return 'USD';
  if (/£|gbp|libra/i.test(s)) return 'GBP';
  return null;
}

/**
 * Intenta interpretar una fecha y devolverla como ISO (YYYY-MM-DD) o null.
 * Admite dd/mm/yyyy, dd-mm-yyyy y yyyy-mm-dd. No inventa: si no es válida -> null.
 */
function parseDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return toIsoDate(Number(y), Number(mo), Number(d));
  }
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return toIsoDate(year, Number(mo), Number(d));
  }
  return null;
}

function toIsoDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  // Verifica que no haya overflow (p.ej. 31/02).
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Deriva el tipo de fee a partir de texto, validando contra FEE_TYPE_VALUES. */
function detectFeeType(text: string | null): FeeType {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (/precio fijo|tarifa plana|importe fijo|fixed|fija/.test(t)) return 'fixed';
  if (/mensual|cuota|monthly|iguala/.test(t)) return 'monthly';
  if (/éxito|exito|success|resultado|contingen/.test(t)) return 'success_fee';
  if (/mixt|blended/.test(t)) return 'blended';
  if (/por hora|\/h|hora|hourly|hora?s? trabajada/.test(t)) return 'hourly';
  return 'unknown';
}

function normalizeFeeType(value: string | null): FeeType {
  if (!value) return 'unknown';
  const v = value.trim().toLowerCase();
  if ((FEE_TYPE_VALUES as string[]).includes(v)) return v as FeeType;
  return detectFeeType(value);
}

const trimOrNull = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const snippetOf = (s: string, max = 160): string =>
  s.replace(/\s+/g, ' ').trim().slice(0, max);

// ----------------------------------------------------------------------------
// Clasificación opcional vía serviceClassifier (import dinámico, R12 si falla)
// ----------------------------------------------------------------------------

interface ClassificationLike {
  service_category: string;
  service_subcategory: string | null;
  confidence_level: ConfidenceLevel;
}

/**
 * Intenta clasificar usando ./serviceClassifier.ts si existe. Es OPCIONAL:
 * ante cualquier fallo (módulo ausente, firma distinta) devuelve "unknown".
 */
async function classifyOptional(
  description: string | null,
  documentText: string | null,
): Promise<ClassificationLike> {
  const fallback: ClassificationLike = {
    service_category: 'unknown',
    service_subcategory: null,
    confidence_level: 'low',
  };
  try {
    const mod: any = await import('./serviceClassifier.ts');
    if (mod && typeof mod.classify === 'function') {
      const res = mod.classify({
        service_description: description,
        document_text: documentText,
      });
      if (res && typeof res.service_category === 'string') {
        return {
          service_category: res.service_category || 'unknown',
          service_subcategory: res.service_subcategory ?? null,
          confidence_level: res.confidence_level ?? 'low',
        };
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Limpia el nombre de archivo para usarlo como SEÑAL fuerte de clasificación.
 * Los nombres reales son muy descriptivos ("PCS_Iguala_Laboral", "ALQUIMA_Fusión",
 * "GAM_Revision Compliance"). Quita "Nº.147.-", años, "anon", extensión y ruido.
 */
function cleanFilename(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\.anon$/i, '')
    .replace(/anon/ig, '')
    .replace(/N[ºo]\.?\s*\d+\s*(bis)?\.?\s*-?/ig, '')
    .replace(/\b(bis|es la misma( que)?|otro nombre|firmada?|aceptada|rev|dentro de \w+)\b/ig, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/[_().-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Construye la señal de clasificación: descripción del servicio o, si falta, el
 * nombre del documento (muy informativo). El cuerpo se acota a la APERTURA para
 * evitar el boilerplate de RGPD/privacidad del pie, que contamina la categoría.
 */
function classificationSignal(doc: UploadedDocument, raw: RawFields): { hint: string | null; body: string } {
  const hint = raw.service_description ?? (cleanFilename(doc.original_filename) || raw.matter_name);
  const body = (doc.extracted_text ?? '').slice(0, 1200);
  return { hint, body };
}

// ----------------------------------------------------------------------------
// Extracción desde TABLAS
// ----------------------------------------------------------------------------

/** Palabras lógicas que puede traer table.detected_columns. */
const COL_KEYS = {
  client: ['cliente', 'client'],
  matter: ['asunto', 'matter', 'caso', 'expediente'],
  service: ['servicio', 'service', 'concepto', 'descripcion', 'descripción'],
  hours: ['horas', 'hours'],
  amount: ['importe', 'amount', 'total', 'honorarios', 'fee'],
  date: ['fecha', 'date'],
  rate: ['tarifa', 'rate', 'precio_hora'],
  currency: ['moneda', 'currency'],
  fee_type: ['fee_type', 'tipo', 'tipo_fee'],
};

/** Resuelve el índice de una columna lógica desde detected_columns o por header. */
function colIndex(
  table: ExtractedTable,
  logicalKeys: string[],
): number | null {
  const detected = table.detected_columns ?? {};
  for (const k of logicalKeys) {
    if (typeof detected[k] === 'number') return detected[k];
  }
  // Fallback: busca por header (coincidencia laxa).
  const headers = (table.headers ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  for (let i = 0; i < headers.length; i++) {
    if (logicalKeys.some((k) => headers[i].includes(k))) return i;
  }
  return null;
}

function cellValue(row: (string | number | null)[], idx: number | null): string | number | null {
  if (idx === null || idx < 0 || idx >= row.length) return null;
  return row[idx];
}

/** Convierte un índice de columna 0-based a letra de celda tipo hoja (A, B, ...). */
function colLetter(idx: number): string {
  let n = idx;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function extractFromTable(
  table: ExtractedTable,
  rowIndex: number,
  row: (string | number | null)[],
): RawFields | null {
  const idx = {
    client: colIndex(table, COL_KEYS.client),
    matter: colIndex(table, COL_KEYS.matter),
    service: colIndex(table, COL_KEYS.service),
    hours: colIndex(table, COL_KEYS.hours),
    amount: colIndex(table, COL_KEYS.amount),
    date: colIndex(table, COL_KEYS.date),
    rate: colIndex(table, COL_KEYS.rate),
    currency: colIndex(table, COL_KEYS.currency),
    fee_type: colIndex(table, COL_KEYS.fee_type),
  };

  // Una fila es relevante si tiene al menos cliente o importe (señales financieras).
  const rawClient = trimOrNull(cellValue(row, idx.client) as string | null);
  const totalFee = parseNumber(cellValue(row, idx.amount));
  const hours = parseNumber(cellValue(row, idx.hours));
  const rate = parseNumber(cellValue(row, idx.rate));
  if (!rawClient && totalFee === null && hours === null && rate === null) return null;

  const sheet = trimOrNull(table.name ?? null);
  // Excel-like row number: +1 por header, +1 por base 1.
  const excelRow = rowIndex + 2;
  const loc = (logicalIdx: number | null, field: string): SourceLocation | null => {
    if (logicalIdx === null) return null;
    const v = cellValue(row, logicalIdx);
    return {
      field,
      sheet,
      cell: `${colLetter(logicalIdx)}${excelRow}`,
      line: excelRow,
      snippet: v === null ? null : snippetOf(String(v)),
    };
  };

  const source_location: SourceLocation[] = [
    loc(idx.client, 'client_name'),
    loc(idx.matter, 'matter_name'),
    loc(idx.service, 'service_description'),
    loc(idx.date, 'date'),
    loc(idx.amount, 'total_fee'),
    loc(idx.hours, 'hours_worked'),
    loc(idx.rate, 'hourly_rate'),
  ].filter((x): x is SourceLocation => x !== null);

  const currencyCell = cellValue(row, idx.currency);
  const amountCell = cellValue(row, idx.amount);
  const currency = parseCurrency(currencyCell) ?? parseCurrency(amountCell) ?? null;

  const feeTypeCell = trimOrNull(cellValue(row, idx.fee_type) as string | null);
  const serviceText = trimOrNull(cellValue(row, idx.service) as string | null);
  let fee_type = normalizeFeeType(feeTypeCell);
  if (fee_type === 'unknown' && hours !== null && rate !== null) fee_type = 'hourly';
  if (fee_type === 'unknown' && serviceText) fee_type = detectFeeType(serviceText);

  return {
    client_name: rawClient,
    matter_name: trimOrNull(cellValue(row, idx.matter) as string | null),
    service_description: serviceText,
    date: parseDate(cellValue(row, idx.date)),
    total_fee: totalFee,
    currency,
    fee_type,
    hours_worked: hours,
    hourly_rate: rate,
    discounts: null,
    source_location,
  };
}

// ----------------------------------------------------------------------------
// Extracción desde TEXTO LIBRE (regex + palabras clave)
// ----------------------------------------------------------------------------

/** Busca un valor etiquetado del tipo "Etiqueta: valor" en una línea. */
function findLabeled(
  lines: string[],
  labels: string[],
): { value: string; line: number; raw: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:\\-]\\s*(.+)`, 'i');
      const m = line.match(re);
      if (m && m[1].trim() !== '') {
        return { value: m[1].trim(), line: i + 1, raw: line };
      }
    }
  }
  return null;
}

/**
 * Frases que, justo ANTES de una cifra, indican que esa cifra es el honorario.
 * Cubre el lenguaje real de las propuestas españolas: "cantidad fija global de…",
 * "importe mensual… de…", "presupuesto de…", "honorarios… ascenderían a…", etc.
 */
const FEE_PREFIX = /(fij[oa]\s+(global\s+)?(de|y total)?|cantidad\s+fija(\s+global)?(\s+de)?|importe\s+(mensual\s+)?(de|ser[íi]a de)?|presupuesto\s+de|honorarios?\s+[^.]{0,40}\b(de|ascend\w+ a|ser[íi]an? de)|asciend\w+ a|ascend\w+ a|raz[oó]n de|cuota\s+(mensual\s+)?de|por (un )?importe de|por la cantidad de)\s*$/i;

export interface ProseFee {
  total_fee: number | null;
  hourly_rate: number | null;
  fee_type: FeeType;
  currency: string | null;
  snippet: string | null;
}

/**
 * Extrae honorarios escritos en PROSA (no en formato "Etiqueta: valor").
 * Enfoque centrado en la cifra: localiza cada importe, lo valida por su contexto
 * (debe llevar € adyacente o una frase de honorarios pegada) y lo clasifica como
 * mensual (iguala) / fijo (cantidad fija global) / por hora / éxito.
 *
 * Reglas: R12 (no inventa: descarta años y cifras sin señal de honorarios).
 * Prioridad: mensual > fijo (la cifra fija mayor = honorario "global") > éxito > hora.
 */
export function extractFeeFromProse(text: string): ProseFee | null {
  const t = text.replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  const re = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{4,}(?:,\d{1,2})?|\d{3}(?:,\d{1,2})?/g;
  // Contextos que NO son honorarios sino cuantía del asunto (no confundir con el fee).
  const MATTER_VALUE = /(reclamaci|reclamad|cuant[ií]a|deuda|principal|importe de la operaci|valor de|capital social|indemnizaci|sanci[oó]n|multa|impagad|nominal|por importe de \d)/;
  // Techo de cordura: un honorario de estos asuntos rara vez supera ~600k €.
  const FEE_CEILING = 600_000;
  const cands: { amount: number; type: FeeType; feeBound: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const idx = m.index;
    const tok = m[0];
    const amount = parseNumber(tok);
    if (amount === null || amount < 150 || amount > FEE_CEILING) continue;
    const after = low.slice(idx + tok.length, idx + tok.length + 6);
    const before = low.slice(Math.max(0, idx - 45), idx);
    const followedByCur = /\s*(€|eur|euros?)/.test(after);
    const precededByFee = FEE_PREFIX.test(before);
    if (!followedByCur && !precededByFee) continue;
    // Descarta años (1990-2099) sin moneda adyacente ni separador de miles.
    if (Number.isInteger(amount) && amount >= 1990 && amount <= 2099 && !followedByCur && !/[.,]/.test(tok)) continue;
    const ctx = low.slice(Math.max(0, idx - 60), idx + tok.length + 25);
    // Excluye cuantías del litigio / importes reclamados, salvo si está pegado a
    // una frase de honorarios (FEE_PREFIX).
    if (MATTER_VALUE.test(ctx) && !precededByFee) continue;
    let type: FeeType = 'fixed';
    if (/mensual|iguala|al mes|\/mes|mensualmente/.test(ctx)) type = 'monthly';
    else if (/la hora|por hora|\/h|hora\b/.test(ctx)) type = 'hourly';
    else if (/[eé]xito/.test(ctx)) type = 'success_fee';
    cands.push({ amount, type, feeBound: precededByFee });
  }
  if (cands.length === 0) return null;

  const currency = parseCurrency(t.slice(0, 4000)) ?? 'EUR';
  const monthly = cands.filter((c) => c.type === 'monthly');
  const fixed = cands.filter((c) => c.type === 'fixed');
  const exito = cands.filter((c) => c.type === 'success_fee');
  const hourly = cands.filter((c) => c.type === 'hourly');

  if (monthly.length) {
    const boundM = monthly.filter((c) => c.feeBound);
    const a = (boundM.length ? boundM : monthly).sort((x, y) => x.amount - y.amount)[0].amount; // mensual base
    return { total_fee: a, hourly_rate: null, fee_type: 'monthly', currency, snippet: `Honorario mensual detectado: ${a} ${currency}` };
  }
  if (fixed.length) {
    // Prioriza importes pegados a "honorarios/cantidad fija/presupuesto"; de esos, el
    // mayor (cubre presupuestos por fases). Si ninguno es fee-bound, el mayor restante.
    const boundF = fixed.filter((c) => c.feeBound);
    const a = (boundF.length ? boundF : fixed).sort((x, y) => y.amount - x.amount)[0].amount;
    return { total_fee: a, hourly_rate: null, fee_type: 'fixed', currency, snippet: `Cantidad fija detectada: ${a} ${currency}` };
  }
  if (exito.length) {
    return { total_fee: exito[0].amount, hourly_rate: null, fee_type: 'success_fee', currency, snippet: `Honorario de éxito detectado: ${exito[0].amount} ${currency}` };
  }
  const r = hourly.sort((x, y) => y.amount - x.amount)[0].amount;
  return { total_fee: null, hourly_rate: r, fee_type: 'hourly', currency, snippet: `Tarifa por hora detectada: ${r} ${currency}` };
}

/**
 * Extrae HORAS escritas en prosa ("máximo de 75 horas presupuestadas", "50 horas
 * de trabajo"). Sólo cuenta cifras de horas con contexto de trabajo/presupuesto,
 * para no confundir plazos ("entrega en 24 horas") con horas de trabajo. Devuelve
 * la mayor cifra con contexto, o null (R12: no inventa). NUNCA toma "X € la hora"
 * (eso es tarifa, no horas).
 */
export function extractHoursFromProse(text: string): number | null {
  const t = text.replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  const re = /(\d{1,4})\s*horas?\b/gi;
  const WORK = /(presupuest|estimad|trabajo|m[aá]xim|m[ií]nim|dedicaci|incurrid|realizaci|honorari|jornada|previst|emplead)/;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const n = parseNumber(m[1]);
    if (n === null || n <= 0 || n > 5000) continue;
    const ctx = low.slice(Math.max(0, m.index - 35), m.index + m[0].length + 20);
    if (WORK.test(ctx)) {
      if (best === null || n > best) best = n;
    }
  }
  return best;
}

function extractFromText(text: string): RawFields | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const source_location: SourceLocation[] = [];

  const pushLoc = (field: string, hit: { line: number; raw: string } | null) => {
    if (hit) source_location.push({ field, line: hit.line, snippet: snippetOf(hit.raw) });
  };

  const clientHit = findLabeled(lines, ['cliente', 'client', 'razón social', 'razon social']);
  const matterHit = findLabeled(lines, ['asunto', 'matter', 'caso', 'expediente', 'concepto']);
  const serviceHit = findLabeled(lines, ['servicio', 'service', 'descripción', 'descripcion']);
  const dateHit = findLabeled(lines, ['fecha', 'date']);
  const totalHit = findLabeled(lines, ['total', 'importe', 'honorarios', 'amount', 'fee']);
  const hoursHit = findLabeled(lines, ['horas', 'hours']);
  const rateHit = findLabeled(lines, ['tarifa', 'rate', 'precio/hora', 'precio hora', 'hourly']);
  const discountHit = findLabeled(lines, ['descuento', 'discount']);

  const client_name = clientHit ? clientHit.value : null;
  const matter_name = matterHit ? matterHit.value : null;
  const service_description = serviceHit ? serviceHit.value : null;
  const date = dateHit ? parseDate(dateHit.value) : null;
  let total_fee = totalHit ? parseNumber(totalHit.value) : null;
  let hours_worked = hoursHit ? parseNumber(hoursHit.value) : null;
  let hourly_rate = rateHit ? parseNumber(rateHit.value) : null;
  const discounts = discountHit ? parseNumber(discountHit.value) : null;

  pushLoc('client_name', clientHit);
  pushLoc('matter_name', matterHit);
  pushLoc('service_description', serviceHit);
  pushLoc('date', dateHit);
  pushLoc('total_fee', totalHit);
  pushLoc('hours_worked', hoursHit);
  pushLoc('hourly_rate', rateHit);
  pushLoc('discounts', discountHit);

  let fee_type = detectFeeType(text);
  let currency =
    parseCurrency(totalHit?.value ?? null) ??
    parseCurrency(rateHit?.value ?? null) ??
    parseCurrency(text.slice(0, 400)) ??
    null;

  // Si no hay importe ni tarifa etiquetados, lee los honorarios en PROSA
  // (lenguaje real de propuestas: "cantidad fija global de…", "importe mensual… de…").
  if (total_fee === null && hourly_rate === null) {
    const prose = extractFeeFromProse(text);
    if (prose) {
      if (prose.fee_type === 'hourly') hourly_rate = prose.hourly_rate;
      else total_fee = prose.total_fee;
      if (prose.fee_type !== 'unknown') fee_type = prose.fee_type;
      if (currency === null) currency = prose.currency;
      if (prose.snippet) source_location.push({ field: 'total_fee', snippet: prose.snippet });
    }
  }

  // Horas escritas en prosa ("75 horas presupuestadas") si no había etiqueta "Horas:".
  if (hours_worked === null) {
    const ph = extractHoursFromProse(text);
    if (ph !== null) {
      hours_worked = ph;
      source_location.push({ field: 'hours_worked', snippet: `Horas detectadas en prosa: ${ph}` });
    }
  }

  if (fee_type === 'unknown' && hours_worked !== null && hourly_rate !== null) fee_type = 'hourly';

  // Sin ninguna señal financiera ni cliente -> no hay registro que extraer (R12).
  if (
    client_name === null && total_fee === null &&
    hours_worked === null && hourly_rate === null
  ) {
    return null;
  }

  return {
    client_name,
    matter_name,
    service_description,
    date,
    total_fee,
    currency,
    fee_type,
    hours_worked,
    hourly_rate,
    discounts: discounts !== null && discounts >= 0 && discounts <= 100 ? discounts : null,
    source_location,
  };
}

// ----------------------------------------------------------------------------
// Ensamblado de un ExtractedWorkRecord a partir de RawFields
// ----------------------------------------------------------------------------

/**
 * Decide el nivel de confianza. R14:
 *  - "low" si hay ambigüedad (faltan importe Y horas, o viene de texto libre con poco).
 *  - "medium" si proviene de tabla con columnas financieras y trae importe.
 */
function assessConfidence(raw: RawFields, fromTable: boolean): ConfidenceLevel {
  const hasMoney = raw.total_fee !== null;
  const hasHoursAndRate = raw.hours_worked !== null && raw.hourly_rate !== null;
  if (fromTable && (hasMoney || hasHoursAndRate)) return 'medium';
  if (hasMoney && (raw.client_name !== null || raw.service_description !== null)) return 'medium';
  return 'low';
}

function buildRecord(
  doc: UploadedDocument,
  raw: RawFields,
  classification: ClassificationLike,
  fromTable: boolean,
  extractedFrom: string,
): ExtractedWorkRecord {
  // Coherencia mínima sin inventar (R12): si falta una de las tres no se deriva.
  const total_fee = raw.total_fee;
  const hours_worked = raw.hours_worked;
  const hourly_rate = raw.hourly_rate;

  const confidence = assessConfidence(raw, fromTable);
  const now = nowIso();

  return {
    id: newId('rec'),
    document_id: doc.id,
    client_name: raw.client_name,
    matter_name: raw.matter_name,
    service_category: classification.service_category || 'unknown',
    service_subcategory: classification.service_subcategory ?? null,
    service_description: raw.service_description,
    date: raw.date,
    total_fee,
    currency: total_fee !== null || hourly_rate !== null ? (raw.currency ?? DEFAULT_CURRENCY) : raw.currency,
    fee_type: raw.fee_type,
    hours_worked,
    hourly_rate,
    professional_role: null,
    number_of_professionals: null,
    complexity_level: 'unknown',
    urgency_level: 'unknown',
    discounts: raw.discounts,
    payment_terms: null,
    extracted_from: extractedFrom,
    source_location: raw.source_location,
    confidence_level: confidence,
    review_status: 'pending_review', // R5/R6: SIEMPRE pendiente al crear.
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
    created_at: now,
    notes: null,
  };
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

/**
 * Extrae 1..N ExtractedWorkRecord de un documento YA extraído.
 * No persiste nada. Todos los registros nacen en `pending_review` (R5/R6).
 * Función SÍNCRONA: la clasificación opcional se intenta de forma best-effort
 * pero, para mantener la firma del contrato, se resuelve aquí sin await usando
 * un cache si el módulo ya estaba cargado; si no, se deja "unknown" (R12).
 */
export function extractRecords(doc: UploadedDocument): ExtractedWorkRecord[] {
  const records: ExtractedWorkRecord[] = [];

  // 1) Tablas con columnas financieras detectadas -> un registro por fila relevante.
  const tables = Array.isArray(doc.extracted_tables) ? doc.extracted_tables : [];
  for (const table of tables) {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    for (let r = 0; r < rows.length; r++) {
      const raw = extractFromTable(table, r, rows[r]);
      if (!raw) continue;
      const sig = classificationSignal(doc, raw);
      const classification = classifySync(sig.hint, sig.body);
      const where = table.name ? `tabla "${table.name}" fila ${r + 2}` : `tabla fila ${r + 2}`;
      records.push(buildRecord(doc, raw, classification, true, where));
    }
  }

  // 2) Texto libre -> intento de un registro por documento (cliente/importe/horas/tarifa).
  if (records.length === 0 && typeof doc.extracted_text === 'string' && doc.extracted_text.trim() !== '') {
    const raw = extractFromText(doc.extracted_text);
    if (raw) {
      const sig = classificationSignal(doc, raw);
      const classification = classifySync(sig.hint, sig.body);
      records.push(buildRecord(doc, raw, classification, false, 'texto libre del documento'));
    }
  }

  return records;
}

/**
 * Versión que persiste los registros vía recordsRepo. Intenta clasificar de forma
 * asíncrona (serviceClassifier opcional) y guarda. Devuelve los registros guardados.
 */
export async function extractAndSaveRecords(doc: UploadedDocument): Promise<ExtractedWorkRecord[]> {
  const records: ExtractedWorkRecord[] = [];

  const tables = Array.isArray(doc.extracted_tables) ? doc.extracted_tables : [];
  for (const table of tables) {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    for (let r = 0; r < rows.length; r++) {
      const raw = extractFromTable(table, r, rows[r]);
      if (!raw) continue;
      const sig = classificationSignal(doc, raw);
      const classification = await classifyOptional(sig.hint, sig.body);
      const where = table.name ? `tabla "${table.name}" fila ${r + 2}` : `tabla fila ${r + 2}`;
      records.push(buildRecord(doc, raw, classification, true, where));
    }
  }

  if (records.length === 0 && typeof doc.extracted_text === 'string' && doc.extracted_text.trim() !== '') {
    const raw = extractFromText(doc.extracted_text);
    if (raw) {
      const sig = classificationSignal(doc, raw);
      const classification = await classifyOptional(sig.hint, sig.body);
      records.push(buildRecord(doc, raw, classification, false, 'texto libre del documento'));
    }
  }

  for (const rec of records) recordsRepo.save(rec);
  return records;
}

// ----------------------------------------------------------------------------
// Clasificación síncrona best-effort (cache del módulo ya cargado)
// ----------------------------------------------------------------------------

let cachedClassifier: { classify?: (input: unknown) => unknown } | null | undefined;

/**
 * Dispara la carga del clasificador en segundo plano (para que la próxima
 * llamada síncrona pueda usarlo) y devuelve "unknown" si aún no está disponible.
 * Nunca inventa (R12).
 */
function classifySync(description: string | null, documentText: string | null): ClassificationLike {
  const fallback: ClassificationLike = {
    service_category: 'unknown',
    service_subcategory: null,
    confidence_level: 'low',
  };
  if (cachedClassifier === undefined) {
    cachedClassifier = null; // marca "cargando" para no relanzar en bucle
    import('./serviceClassifier.ts')
      .then((mod: any) => { cachedClassifier = mod ?? null; })
      .catch(() => { cachedClassifier = null; });
    return fallback;
  }
  if (cachedClassifier && typeof cachedClassifier.classify === 'function') {
    try {
      const res = cachedClassifier.classify({
        service_description: description,
        document_text: documentText,
      }) as ClassificationLike | undefined;
      if (res && typeof res.service_category === 'string' && res.service_category !== '') {
        return {
          service_category: res.service_category,
          service_subcategory: res.service_subcategory ?? null,
          confidence_level: res.confidence_level ?? 'low',
        };
      }
    } catch {
      return fallback;
    }
  }
  return fallback;
}
