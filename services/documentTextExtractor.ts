/**
 * documentTextExtractor — extracción de texto y tablas de documentos subidos.
 *
 * Detecta el tipo por extensión y elige el método de extracción adecuado.
 * Las dependencias pesadas (pdf-parse, mammoth, xlsx, tesseract.js) son
 * OPCIONALES: se cargan vía import() dinámico dentro de try/catch. Si una no
 * está instalada, NO se lanza una excepción: se devuelve un resultado razonable
 * con un warning explícito que nombra la dependencia necesaria.
 *
 * Reglas aplicadas:
 *  - R8 (trazabilidad): cada extracción registra source_locations (página, hoja,
 *    celda, snippet) cuando es posible.
 *  - R12 (no inventar): si un PDF parece escaneado y no hay OCR, NO se rellena
 *    con contenido inventado; se marca method "manual_review_needed" + warning.
 *  - R14 (confianza): confidence_level low | medium | high según el método y la
 *    calidad del resultado.
 *
 * Tipos: se IMPORTAN de backend/models. No se redefinen.
 */

import type {
  ExtractedTable,
  ExtractionMethod,
  ExtractionStatus,
  ConfidenceLevel,
  SourceLocation,
} from '../backend/models/index.ts';

// ----------------------------------------------------------------------------
// Resultado de extracción (firma de CONTRACTS.md)
// ----------------------------------------------------------------------------

export interface ExtractionResult {
  text: string | null;
  tables: ExtractedTable[];
  method: ExtractionMethod;
  status: ExtractionStatus;
  warnings: string[];
  source_locations: SourceLocation[];
  confidence_level: ConfidenceLevel;
}

// ----------------------------------------------------------------------------
// Tipos de archivo soportados
// ----------------------------------------------------------------------------

const TEXT_TYPES = ['txt'] as const;
const CSV_TYPES = ['csv'] as const;
const PDF_TYPES = ['pdf'] as const;
const DOCX_TYPES = ['docx'] as const;
const XLSX_TYPES = ['xlsx', 'xls'] as const;
const IMAGE_TYPES = ['png', 'jpg', 'jpeg'] as const;
const MSG_TYPES = ['msg'] as const;       // correo Outlook
const EML_TYPES = ['eml'] as const;       // correo MIME
const WORDDOC_TYPES = ['doc'] as const;   // Word antiguo (binario)

const SUPPORTED_TYPES = [
  ...TEXT_TYPES, ...CSV_TYPES, ...PDF_TYPES, ...DOCX_TYPES, ...XLSX_TYPES, ...IMAGE_TYPES,
  ...MSG_TYPES, ...EML_TYPES, ...WORDDOC_TYPES,
];

/** Normaliza una extensión/mimetype a una de las extensiones conocidas. */
function normalizeFileType(fileType: string, filename?: string): string {
  let ft = (fileType ?? '').trim().toLowerCase();

  // Mimetypes comunes -> extensión.
  const MIME_MAP: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xlsx',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
  };
  if (MIME_MAP[ft]) return MIME_MAP[ft];

  // Quita un punto inicial si lo trae ("pdf" vs ".pdf").
  if (ft.startsWith('.')) ft = ft.slice(1);

  // Si lo que llega no es una extensión conocida, intenta deducirla del nombre.
  if (!SUPPORTED_TYPES.includes(ft) && filename) {
    const dot = filename.lastIndexOf('.');
    if (dot >= 0) {
      const fromName = filename.slice(dot + 1).toLowerCase();
      if (SUPPORTED_TYPES.includes(fromName)) return fromName;
    }
  }
  // 'jpeg' lo tratamos igual que 'jpg' aguas abajo, pero lo conservamos tal cual.
  return ft;
}

// ----------------------------------------------------------------------------
// CSV / TXT parser propio (sin dependencias)
// ----------------------------------------------------------------------------

/**
 * Parser CSV propio que respeta comillas dobles y comas/saltos de línea dentro
 * de comillas. Soporta el escape RFC4180 de comilla doble ("" -> ").
 * Devuelve un ExtractedTable con headers (primera fila) y rows.
 */
export function parseCsv(content: string): ExtractedTable {
  const rows: (string | number | null)[][] = [];
  let field = '';
  let row: (string | number | null)[] = [];
  let inQuotes = false;
  let started = false; // si la fila actual tiene algún contenido/campo iniciado

  const pushField = () => {
    row.push(normalizeCell(field));
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    started = false;
  };

  // Normaliza saltos de línea CRLF/CR a LF antes de iterar.
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // salta la segunda comilla escapada
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      started = true;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      pushField();
      started = true;
    } else if (ch === '\n') {
      pushRow();
    } else {
      field += ch;
      started = true;
    }
  }

  // Último campo/fila si quedó contenido pendiente.
  if (started || field.length > 0 || row.length > 0) {
    pushRow();
  }

  // Descarta filas completamente vacías (p.ej. salto de línea final).
  const cleaned = rows.filter(
    (r) => !(r.length === 1 && (r[0] === null || r[0] === '')),
  );

  const headerRow = cleaned.length > 0 ? cleaned[0] : [];
  const headers = headerRow.map((c) => (c === null ? '' : String(c)));
  const dataRows = cleaned.slice(1);

  return {
    name: null,
    headers,
    rows: dataRows,
    detected_columns: detectFinancialColumns(headers),
  };
}

/** Convierte una celda a número si es claramente numérica; "" -> null. */
function normalizeCell(raw: string): string | number | null {
  const v = raw;
  if (v === '') return null;
  // Sólo convertimos a number si toda la celda es un número simple.
  // Evitamos romper IDs, fechas o texto que casualmente empiece por dígito.
  if (/^-?\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return v;
}

// ----------------------------------------------------------------------------
// Detección de columnas financieras por palabras clave (es / en)
// ----------------------------------------------------------------------------

/**
 * Mapea encabezados a columnas lógicas (cliente, servicio, horas, importe,
 * fecha, tarifa, moneda, fee_type) por coincidencia de palabras clave es/en.
 * Devuelve { nombre_logico: indice_de_columna }. Sólo incluye las detectadas.
 */
export function detectFinancialColumns(headers: string[]): Record<string, number> {
  const KEYWORDS: Record<string, string[]> = {
    client: ['cliente', 'client', 'customer', 'razon social', 'razón social', 'empresa', 'deudor', 'nombre cliente', 'nombre del cliente'],
    service: ['servicio', 'service', 'asunto', 'matter', 'concepto', 'descripcion', 'descripción', 'description', 'detalle', 'materia', 'expediente', 'expte', 'area', 'área', 'practica', 'práctica', 'tipo de asunto'],
    hours: ['horas', 'hours', 'hrs', 'horas trabajadas', 'horas imputadas', 'horas facturadas', 'horas dedicadas', 'dedicacion', 'dedicación', 'tiempo', 'time', 'no horas', 'num horas', 'nro horas', 'cantidad de horas'],
    amount: ['importe', 'importe facturado', 'importe neto', 'facturado', 'total', 'total factura', 'monto', 'amount', 'honorarios', 'honorarios profesionales', 'fee', 'fees', 'base imponible', 'cuantia', 'cuantía', 'coste', 'cost'],
    date: ['fecha', 'date', 'fecha factura', 'fecha de factura', 'fecha emision', 'fecha emisión', 'fecha apertura', 'invoice date'],
    rate: ['tarifa', 'rate', 'tarifa hora', 'tarifa por hora', 'tarifa horaria', 'hourly rate', 'precio hora', 'precio/hora', 'tarifa/hora', '€/h', 'eur/h', 'eur/hora'],
    currency: ['moneda', 'currency', 'divisa'],
    fee_type: ['tipo de fee', 'fee_type', 'fee type', 'tipo honorario', 'tipo de honorario', 'tipo de facturacion', 'tipo de facturación', 'modelo de facturacion', 'modelo', 'billing type'],
  };

  const detected: Record<string, number> = {};
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita acentos para comparar
      .trim();

  const normHeaders = headers.map(norm);
  const normKeywords: Record<string, string[]> = {};
  for (const [logical, words] of Object.entries(KEYWORDS)) {
    normKeywords[logical] = words.map(norm);
  }

  for (const [logical, words] of Object.entries(normKeywords)) {
    for (let i = 0; i < normHeaders.length; i++) {
      const h = normHeaders[i];
      if (!h) continue;
      // Coincidencia exacta primero (prioritaria), si no, "contiene".
      if (words.includes(h)) {
        detected[logical] = i;
        break;
      }
    }
    if (detected[logical] !== undefined) continue;
    for (let i = 0; i < normHeaders.length; i++) {
      const h = normHeaders[i];
      if (!h) continue;
      if (words.some((w) => h.includes(w))) {
        detected[logical] = i;
        break;
      }
    }
  }

  return detected;
}

// ----------------------------------------------------------------------------
// OCR availability
// ----------------------------------------------------------------------------

/**
 * Indica si la dependencia opcional de OCR (tesseract.js) está disponible.
 * NUNCA lanza: ante cualquier error devuelve false.
 */
export async function isOcrAvailable(): Promise<boolean> {
  try {
    await import('tesseract.js');
    return true;
  } catch {
    return false;
  }
}

/**
 * Intenta OCR sobre un buffer de IMAGEN (PNG/JPG) usando tesseract.js.
 * Devuelve el texto reconocido o null si no hay OCR / falla. No lanza.
 *
 * IMPORTANTE: tesseract.js NO puede leer PDFs (lanza un error de worker no
 * capturable que tumbaría el proceso). Por eso aquí SÓLO se pasan imágenes; los
 * PDF escaneados se rasterizan antes con rasterizePdfToImages().
 */
async function tryOcr(buf: Buffer): Promise<string | null> {
  try {
    const mod: any = await import('tesseract.js');
    const tesseract = mod.default ?? mod;
    // recognize acepta Buffer de imagen; idiomas español + inglés.
    const result = await tesseract.recognize(buf, 'spa+eng');
    const text: string = result?.data?.text ?? '';
    const trimmed = text.trim();
    return trimmed.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Rasteriza un PDF a imágenes PNG (una por página) con la dependencia opcional
 * "pdf-to-img". Necesario porque tesseract.js no lee PDFs directamente.
 * Devuelve [] si la dependencia falta, el PDF no se puede rasterizar o falla.
 * NUNCA lanza. Limita el nº de páginas para no disparar el coste en lotes grandes.
 */
async function rasterizePdfToImages(buf: Buffer, maxPages = 15): Promise<Buffer[]> {
  try {
    const mod: any = await import('pdf-to-img');
    const pdf = mod.pdf ?? mod.default?.pdf ?? mod.default;
    if (typeof pdf !== 'function') return [];
    const doc = await pdf(buf, { scale: 2 });
    const images: Buffer[] = [];
    for await (const page of doc) {
      images.push(page as Buffer);
      if (images.length >= maxPages) break;
    }
    return images;
  } catch {
    return [];
  }
}

/** ¿Está disponible el rasterizador de PDF (pdf-to-img)? No lanza. */
async function isPdfRasterAvailable(): Promise<boolean> {
  try {
    await import('pdf-to-img');
    return true;
  } catch {
    return false;
  }
}

/**
 * ¿El buffer tiene una firma (magic bytes) de imagen soportada (PNG/JPEG)?
 *
 * CRÍTICO: tesseract.js, ante un buffer que no es una imagen decodificable, no
 * rechaza la promesa sino que lanza un error desde su worker que NO es capturable
 * con try/catch y tumbaría el proceso (fatal en una importación de 500 docs).
 * Por eso validamos la firma antes de pasarlo al OCR.
 */
function isLikelyImage(buf: Buffer): boolean {
  if (!buf || buf.length < 4) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  return false;
}

/** OCR sobre una o varias imágenes; concatena el texto por página. No lanza. */
async function ocrImages(images: Buffer[]): Promise<string | null> {
  const parts: string[] = [];
  for (const img of images) {
    const t = await tryOcr(img);
    if (t && t.trim()) parts.push(t.trim());
  }
  const joined = parts.join('\n\n');
  return joined.trim().length > 0 ? joined : null;
}

/** Heurística: ¿el texto extraído está vacío o es casi inexistente? */
function isEmptyOrNearlyEmpty(text: string | null | undefined): boolean {
  if (!text) return true;
  // Cuenta caracteres "de contenido" (alfanuméricos). Un PDF escaneado suele
  // devolver "" o sólo espacios/saltos.
  const meaningful = text.replace(/\s+/g, '');
  return meaningful.length < 5;
}

// ----------------------------------------------------------------------------
// Extractores por tipo
// ----------------------------------------------------------------------------

function extractText(buf: Buffer): ExtractionResult {
  const text = buf.toString('utf8');
  const empty = isEmptyOrNearlyEmpty(text);
  return {
    text: empty ? (text.length === 0 ? null : text) : text,
    tables: [],
    method: 'native_text',
    status: 'completed',
    warnings: empty ? ['El archivo de texto está vacío o casi vacío.'] : [],
    source_locations: empty ? [] : [{ field: 'document', snippet: text.slice(0, 120) }],
    confidence_level: empty ? 'low' : 'high',
  };
}

function extractCsv(buf: Buffer): ExtractionResult {
  const content = buf.toString('utf8');
  const table = parseCsv(content);
  const hasData = table.headers.length > 0 || table.rows.length > 0;
  const warnings: string[] = [];
  if (!hasData) warnings.push('El CSV está vacío: no se detectaron filas ni encabezados.');
  if (hasData && Object.keys(table.detected_columns ?? {}).length === 0) {
    warnings.push('No se reconocieron columnas financieras en los encabezados del CSV; requerirá revisión manual del mapeo.');
  }
  return {
    text: content.length > 0 ? content : null,
    tables: hasData ? [table] : [],
    method: 'spreadsheet_parser',
    status: 'completed',
    warnings,
    source_locations: hasData
      ? [{ field: 'table', sheet: null, snippet: table.headers.join(', ') }]
      : [],
    confidence_level: !hasData
      ? 'low'
      : Object.keys(table.detected_columns ?? {}).length > 0
        ? 'high'
        : 'medium',
  };
}

async function extractPdf(buf: Buffer): Promise<ExtractionResult> {
  let pdfText: string | null = null;
  let numPages: number | null = null;
  let pdfParseFailed = false;
  const warnings: string[] = [];

  try {
    const mod: any = await import('pdf-parse');
    const pdfParse = mod.default ?? mod;
    const parsed = await pdfParse(buf);
    pdfText = typeof parsed?.text === 'string' ? parsed.text : null;
    numPages = typeof parsed?.numpages === 'number' ? parsed.numpages : null;
  } catch {
    pdfParseFailed = true;
    warnings.push('No se pudo extraer texto nativo del PDF: la dependencia opcional "pdf-parse" no está instalada o falló. Instálala (npm i pdf-parse) o sube el documento en otro formato.');
  }

  // Caso 1: texto nativo suficiente.
  if (!pdfParseFailed && !isEmptyOrNearlyEmpty(pdfText)) {
    return {
      text: pdfText,
      tables: [],
      method: 'native_text',
      status: 'completed',
      warnings,
      source_locations: [
        { field: 'document', page: numPages, snippet: (pdfText as string).trim().slice(0, 120) },
      ],
      confidence_level: 'high',
    };
  }

  // Caso 2: texto nativo vacío/casi vacío => parece escaneado. Intentar OCR.
  // tesseract.js NO lee PDFs: rasterizamos a imágenes PNG y OCR-eamos cada página.
  const ocrAvailable = await isOcrAvailable();
  if (ocrAvailable) {
    const pageImages = await rasterizePdfToImages(buf);
    const ocrText = pageImages.length > 0 ? await ocrImages(pageImages) : null;
    if (!isEmptyOrNearlyEmpty(ocrText)) {
      return {
        text: ocrText,
        tables: [],
        method: 'ocr',
        status: 'completed',
        warnings: [
          ...warnings,
          `El PDF parecía escaneado: el texto se obtuvo por OCR sobre ${pageImages.length} página(s) rasterizada(s) y puede contener errores. Revisión humana recomendada.`,
        ],
        source_locations: [
          { field: 'document', page: numPages ?? pageImages.length, snippet: (ocrText as string).trim().slice(0, 120) },
        ],
        confidence_level: 'low',
      };
    }
    // OCR disponible pero no produjo texto: distinguir si faltó el rasterizador.
    const rasterAvailable = await isPdfRasterAvailable();
    const reason = pageImages.length === 0 && !rasterAvailable
      ? 'PDF parece escaneado: para OCR de PDFs hace falta el rasterizador "pdf-to-img" (npm i pdf-to-img). No se extrajo texto y no se inventa contenido.'
      : 'PDF parece escaneado: el OCR no reconoció texto legible. Se requiere revisión manual. No se inventa contenido.';
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'completed',
      warnings: [...warnings, reason],
      source_locations: [],
      confidence_level: 'low',
    };
  }

  // Caso 3: parece escaneado y NO hay OCR disponible. NUNCA inventar (R12).
  return {
    text: null,
    tables: [],
    method: 'manual_review_needed',
    status: 'completed',
    warnings: [
      ...warnings,
      'PDF parece escaneado: se requiere OCR (dependencia tesseract.js no instalada). No se extrajo texto y no se inventa contenido. Instala tesseract.js o sube una versión con texto nativo.',
    ],
    source_locations: [],
    confidence_level: 'low',
  };
}

async function extractDocx(buf: Buffer): Promise<ExtractionResult> {
  try {
    const mod: any = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const result = await mammoth.extractRawText({ buffer: buf });
    const text: string = typeof result?.value === 'string' ? result.value : '';
    const empty = isEmptyOrNearlyEmpty(text);
    return {
      text: empty ? null : text,
      tables: [],
      method: empty ? 'manual_review_needed' : 'native_text',
      status: 'completed',
      warnings: empty
        ? ['El DOCX no contenía texto extraíble. Se requiere revisión manual.']
        : [],
      source_locations: empty
        ? []
        : [{ field: 'document', snippet: text.trim().slice(0, 120) }],
      confidence_level: empty ? 'low' : 'high',
    };
  } catch {
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'completed',
      warnings: [
        'No se pudo leer el DOCX: la dependencia opcional "mammoth" no está instalada o falló. Instálala (npm i mammoth) o sube el documento en otro formato. No se inventa contenido.',
      ],
      source_locations: [],
      confidence_level: 'low',
    };
  }
}

async function extractXlsx(buf: Buffer): Promise<ExtractionResult> {
  try {
    const mod: any = await import('xlsx');
    const XLSX = mod.default ?? mod;
    const wb = XLSX.read(buf, { type: 'buffer' });
    const tables: ExtractedTable[] = [];
    const sourceLocations: SourceLocation[] = [];
    const textChunks: string[] = [];

    for (const sheetName of wb.SheetNames as string[]) {
      const sheet = wb.Sheets[sheetName];
      // Matriz de filas; cada celda vacía -> null.
      const matrix: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: false,
      });
      if (!matrix || matrix.length === 0) continue;

      const headerRow = matrix[0] ?? [];
      const headers = headerRow.map((c) => (c === null || c === undefined ? '' : String(c)));
      const rows = matrix.slice(1).map((r) =>
        r.map((c) => (c === undefined ? null : (c as string | number | null))),
      );

      const table: ExtractedTable = {
        name: sheetName,
        headers,
        rows,
        detected_columns: detectFinancialColumns(headers),
      };
      tables.push(table);
      sourceLocations.push({ field: 'table', sheet: sheetName, snippet: headers.join(', ') });
      textChunks.push(`[${sheetName}]\n` + [headers.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n'));
    }

    const hasData = tables.length > 0;
    const anyDetected = tables.some(
      (t) => Object.keys(t.detected_columns ?? {}).length > 0,
    );
    const warnings: string[] = [];
    if (!hasData) warnings.push('El XLSX no contenía hojas con datos.');
    if (hasData && !anyDetected) {
      warnings.push('No se reconocieron columnas financieras en ninguna hoja; requerirá revisión manual del mapeo.');
    }

    return {
      text: hasData ? textChunks.join('\n\n') : null,
      tables,
      method: 'spreadsheet_parser',
      status: 'completed',
      warnings,
      source_locations: sourceLocations,
      confidence_level: !hasData ? 'low' : anyDetected ? 'high' : 'medium',
    };
  } catch {
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'completed',
      warnings: [
        'No se pudo leer el XLSX: la dependencia opcional "xlsx" no está instalada o falló. Instálala (npm i xlsx) o exporta la hoja a CSV. No se inventa contenido.',
      ],
      source_locations: [],
      confidence_level: 'low',
    };
  }
}

async function extractImage(buf: Buffer): Promise<ExtractionResult> {
  const ocrAvailable = await isOcrAvailable();
  if (ocrAvailable) {
    // No pasar a tesseract algo que no sea una imagen válida: evitaría un crash de
    // worker no capturable (R12: tampoco se inventa nada).
    if (!isLikelyImage(buf)) {
      return {
        text: null,
        tables: [],
        method: 'manual_review_needed',
        status: 'completed',
        warnings: [
          'El archivo no parece una imagen válida (PNG/JPG) o está corrupto; no se puede aplicar OCR. Se requiere revisión manual. No se inventa contenido.',
        ],
        source_locations: [],
        confidence_level: 'low',
      };
    }
    const ocrText = await tryOcr(buf);
    if (!isEmptyOrNearlyEmpty(ocrText)) {
      return {
        text: ocrText,
        tables: [],
        method: 'ocr',
        status: 'completed',
        warnings: [
          'Texto obtenido por OCR de una imagen; puede contener errores. Revisión humana recomendada.',
        ],
        source_locations: [
          { field: 'image', snippet: (ocrText as string).trim().slice(0, 120) },
        ],
        confidence_level: 'low',
      };
    }
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'completed',
      warnings: [
        'El OCR (tesseract.js) no reconoció texto legible en la imagen. Se requiere revisión manual. No se inventa contenido.',
      ],
      source_locations: [],
      confidence_level: 'low',
    };
  }

  // Sin OCR: NO fallar silenciosamente. status completed pero method manual_review_needed.
  return {
    text: null,
    tables: [],
    method: 'manual_review_needed',
    status: 'completed',
    warnings: [
      'Imagen recibida pero no hay OCR disponible: se requiere OCR (dependencia tesseract.js no instalada). No se extrajo texto y no se inventa contenido. Instala tesseract.js para procesar imágenes.',
    ],
    source_locations: [],
    confidence_level: 'low',
  };
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

function unsupportedResult(fileType: string): ExtractionResult {
  return {
    text: null,
    tables: [],
    method: 'manual_review_needed',
    status: 'failed',
    warnings: [
      `Tipo de archivo no soportado para extracción automática: "${fileType || 'desconocido'}". Tipos soportados: ${SUPPORTED_TYPES.join(', ')}. Se requiere revisión manual.`,
    ],
    source_locations: [],
    confidence_level: 'low',
  };
}

/**
 * Extrae texto/tablas de un Buffer según el tipo de archivo.
 * Nunca lanza por dependencias opcionales ausentes: devuelve warnings.
 */
/** Correo Outlook .msg (dependencia opcional @kenjiuno/msgreader). */
async function extractMsg(buf: Buffer): Promise<ExtractionResult> {
  try {
    const mod: any = await import('@kenjiuno/msgreader');
    const MsgReader = mod.default?.default ?? mod.default ?? mod.MsgReader;
    const data = new MsgReader(buf).getFileData();
    const parts = [data?.subject, data?.body].filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '');
    const text = parts.join('\n').trim();
    if (!text) {
      return { text: null, tables: [], method: 'manual_review_needed', status: 'completed', warnings: ['El correo .msg no contenía texto legible.'], source_locations: [], confidence_level: 'low' };
    }
    return { text, tables: [], method: 'native_text', status: 'completed', warnings: ['Texto extraído de un correo Outlook (.msg); puede incluir cadenas de respuestas.'], source_locations: [{ field: 'document', snippet: text.slice(0, 120) }], confidence_level: 'medium' };
  } catch {
    return { text: null, tables: [], method: 'manual_review_needed', status: 'completed', warnings: ['No se pudo leer el .msg (dependencia @kenjiuno/msgreader). Revisión manual.'], source_locations: [], confidence_level: 'low' };
  }
}

/** Correo MIME .eml (parser propio, sin dependencias). Toma la parte de texto y
 *  descarta adjuntos base64 (que ensuciarían la extracción de honorarios). */
function extractEml(buf: Buffer): ExtractionResult {
  const raw = buf.toString('utf8');
  const subjectMatch = raw.slice(0, 4000).match(/^subject:\s*(.+)$/im);
  const subject = subjectMatch ? subjectMatch[1].trim() : '';
  const decodeQP = (s: string) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  let bodyText = '';
  // Multipart: localiza el boundary y quédate con la parte text/plain (o text/html).
  const bMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
  if (bMatch) {
    const parts = raw.split(`--${bMatch[1]}`);
    const pickPart = (re: RegExp) => parts.find((p) => re.test(p.slice(0, 300)));
    const plain = pickPart(/content-type:\s*text\/plain/i);
    const html = pickPart(/content-type:\s*text\/html/i);
    let part = plain ?? html ?? '';
    const hsep = part.indexOf('\r\n\r\n') >= 0 ? part.indexOf('\r\n\r\n') + 4 : (part.indexOf('\n\n') >= 0 ? part.indexOf('\n\n') + 2 : 0);
    let content = part.slice(hsep);
    if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) content = decodeQP(content);
    if (part === html || /<html|<body|<div|<p[\s>]/i.test(content)) {
      content = content.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    }
    bodyText = content;
  } else {
    const sepCRLF = raw.indexOf('\r\n\r\n');
    const sep = sepCRLF >= 0 ? sepCRLF + 4 : 0;
    bodyText = raw.slice(sep);
    if (/content-transfer-encoding:\s*quoted-printable/i.test(raw)) bodyText = decodeQP(bodyText);
    if (/<html|<body|<div|<p[\s>]/i.test(bodyText)) bodyText = bodyText.replace(/<[^>]+>/g, ' ');
  }
  // Descarta runs largos base64 (adjuntos) y cabeceras de parte residuales.
  bodyText = bodyText
    .replace(/\b[A-Za-z0-9+/]{60,}={0,2}\b/g, ' ')
    .replace(/^(content-type|content-transfer-encoding|content-disposition|mime-version|--).*$/gim, ' ');
  const text = `${subject}\n${bodyText}`.replace(/\s+/g, ' ').trim().slice(0, 20000);
  if (!text) {
    return { text: null, tables: [], method: 'manual_review_needed', status: 'completed', warnings: ['El correo .eml no contenía texto legible.'], source_locations: [], confidence_level: 'low' };
  }
  return { text, tables: [], method: 'native_text', status: 'completed', warnings: ['Texto extraído de un correo (.eml).'], source_locations: [{ field: 'document', snippet: text.slice(0, 120) }], confidence_level: 'medium' };
}

/** Word antiguo .doc (dependencia opcional word-extractor; usa archivo temporal). */
async function extractDoc(buf: Buffer): Promise<ExtractionResult> {
  let tmp: string | null = null;
  try {
    const os = await import('node:os');
    const { join } = await import('node:path');
    const { writeFileSync, rmSync } = await import('node:fs');
    const { randomUUID } = await import('node:crypto');
    tmp = join(os.tmpdir(), `doc_${randomUUID().slice(0, 8)}.doc`);
    writeFileSync(tmp, buf);
    const mod: any = await import('word-extractor');
    const WordExtractor = mod.default ?? mod;
    const doc = await new WordExtractor().extract(tmp);
    const text = String(doc.getBody() ?? '').trim();
    try { rmSync(tmp); } catch { /* noop */ }
    if (!text) {
      return { text: null, tables: [], method: 'manual_review_needed', status: 'completed', warnings: ['El .doc no contenía texto legible.'], source_locations: [], confidence_level: 'low' };
    }
    return { text, tables: [], method: 'native_text', status: 'completed', warnings: ['Texto extraído de un Word antiguo (.doc).'], source_locations: [{ field: 'document', snippet: text.slice(0, 120) }], confidence_level: 'high' };
  } catch {
    if (tmp) { try { const { rmSync } = await import('node:fs'); rmSync(tmp); } catch { /* noop */ } }
    return { text: null, tables: [], method: 'manual_review_needed', status: 'completed', warnings: ['No se pudo leer el .doc (dependencia word-extractor). Revisión manual.'], source_locations: [], confidence_level: 'low' };
  }
}

export async function extractFromBuffer(
  buf: Buffer,
  fileType: string,
  filename?: string,
): Promise<ExtractionResult> {
  const ft = normalizeFileType(fileType, filename);

  if (!buf || buf.length === 0) {
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'failed',
      warnings: ['El archivo está vacío (0 bytes): no hay nada que extraer.'],
      source_locations: [],
      confidence_level: 'low',
    };
  }

  if (TEXT_TYPES.includes(ft)) return extractText(buf);
  if (CSV_TYPES.includes(ft)) return extractCsv(buf);
  if (PDF_TYPES.includes(ft)) return extractPdf(buf);
  if (DOCX_TYPES.includes(ft)) return extractDocx(buf);
  if (XLSX_TYPES.includes(ft)) return extractXlsx(buf);
  if (IMAGE_TYPES.includes(ft)) return extractImage(buf);
  if (MSG_TYPES.includes(ft)) return extractMsg(buf);
  if (EML_TYPES.includes(ft)) return extractEml(buf);
  if (WORDDOC_TYPES.includes(ft)) return extractDoc(buf);

  return unsupportedResult(ft);
}

/**
 * Lee el archivo de disco y delega en extractFromBuffer.
 */
export async function extractFromFile(
  filePath: string,
  fileType: string,
): Promise<ExtractionResult> {
  const { readFile } = await import('node:fs/promises');
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: null,
      tables: [],
      method: 'manual_review_needed',
      status: 'failed',
      warnings: [`No se pudo leer el archivo de disco "${filePath}": ${msg}.`],
      source_locations: [],
      confidence_level: 'low',
    };
  }
  const filename = filePath.split(/[\\/]/).pop();
  return extractFromBuffer(buf, fileType, filename);
}
