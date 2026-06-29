/**
 * Tests C1 (1-5) — DOCUMENTOS.
 *
 * Ejercitan services/documentTextExtractor.ts contra los fixtures en
 * tests/fixtures (sample-native.pdf, sample-scanned.pdf, sample-image.png) y
 * crea/borra al vuelo un .txt y un .csv temporales.
 *
 * Aislamiento: estos tests NO tocan los repositorios (sólo extracción pura),
 * salvo el .txt/.csv temporales que se crean y borran dentro de cada test.
 *
 * Nota OCR: tesseract.js es opcional. Si NO está instalado, el PDF escaneado y
 * la imagen toman el camino legítimo de warning / manual_review_needed (R12: no
 * se inventa texto). Los tests aceptan ese camino como correcto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';

import {
  extractFromFile,
  extractFromBuffer,
  parseCsv,
  detectFinancialColumns,
  isOcrAvailable,
} from '../services/documentTextExtractor.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const fixture = (name: string) => join(FIXTURES, name);

// Archivos temporales (con marca de aislamiento para que no choquen con nada).
const TMP_TXT = join(FIXTURES, '__test_doc__sample.txt');
const TMP_CSV = join(FIXTURES, '__test_doc__sample.csv');

const TXT_CONTENT =
  'FACTURA - ILP Abogados\n' +
  'Cliente: Beta Innovations SL\n' +
  'Servicio: Asesoramiento contractual\n' +
  'Total honorarios: 1800 EUR\n';

const CSV_CONTENT =
  'Cliente,Servicio,Horas,Importe,Tarifa,Moneda,Fecha\n' +
  'Acme SL,Registro de marca,10,2500,250,EUR,2025-03-14\n' +
  'Beta SL,Contrato,8,2000,250,EUR,2025-04-02\n';

/**
 * Test 1 — Se pueden subir/extraer PDF, DOCX(o TXT), TXT, CSV/XLSX e imagenes.
 * Comprobamos que cada tipo soportado produce un ExtractionResult bien formado
 * (status valido y un metodo conocido). No exige texto para los escaneados/imagen.
 */
test('1 — extrae todos los tipos soportados (PDF, TXT, CSV, imagen)', async () => {
  await writeFile(TMP_TXT, TXT_CONTENT, 'utf8');
  await writeFile(TMP_CSV, CSV_CONTENT, 'utf8');
  try {
    const VALID_STATUS = ['completed', 'failed'];
    const VALID_METHOD = ['native_text', 'ocr', 'spreadsheet_parser', 'manual_review_needed'];

    const pdf = await extractFromFile(fixture('sample-native.pdf'), 'pdf');
    const txt = await extractFromFile(TMP_TXT, 'txt');
    const csv = await extractFromFile(TMP_CSV, 'csv');
    const img = await extractFromFile(fixture('sample-image.png'), 'png');

    for (const [label, res] of [
      ['pdf', pdf], ['txt', txt], ['csv', csv], ['img', img],
    ] as const) {
      assert.ok(VALID_STATUS.includes(res.status), `${label}: status valido`);
      assert.ok(VALID_METHOD.includes(res.method), `${label}: metodo conocido`);
      assert.ok(Array.isArray(res.warnings), `${label}: warnings es array`);
      assert.ok(Array.isArray(res.tables), `${label}: tables es array`);
      assert.ok(['low', 'medium', 'high'].includes(res.confidence_level), `${label}: confidence valida`);
    }

    // El PDF nativo y el TXT deben traer texto real.
    assert.ok(typeof pdf.text === 'string' && pdf.text.length > 0, 'pdf nativo trae texto');
    assert.ok(typeof txt.text === 'string' && (txt.text as string).includes('Beta Innovations'), 'txt trae su contenido');
    assert.equal(txt.method, 'native_text');

    // El CSV debe parsearse como spreadsheet con al menos una tabla.
    assert.equal(csv.method, 'spreadsheet_parser');
    assert.ok(csv.tables.length >= 1, 'csv produce >=1 tabla');
  } finally {
    await unlink(TMP_TXT).catch(() => {});
    await unlink(TMP_CSV).catch(() => {});
  }
});

/**
 * Test 2 — PDF con texto nativo se extrae y el texto contiene "2500".
 */
test('2 — PDF nativo: texto extraido contiene "2500"', async () => {
  const res = await extractFromFile(fixture('sample-native.pdf'), 'pdf');
  assert.equal(res.status, 'completed');
  assert.equal(res.method, 'native_text');
  assert.ok(typeof res.text === 'string', 'hay texto');
  assert.ok((res.text as string).includes('2500'), 'el texto contiene "2500"');
  // Trazabilidad: registra al menos una source_location.
  assert.ok(res.source_locations.length >= 1, 'registra source_locations');
});

/**
 * Test 3 — PDF escaneado intenta OCR o marca warning claro / manual_review_needed
 * (sin texto inventado). Si OCR no esta instalado, el camino warning es valido.
 */
test('3 — PDF escaneado: OCR o warning claro / manual_review_needed (no inventa)', async () => {
  const ocr = await isOcrAvailable();
  const res = await extractFromFile(fixture('sample-scanned.pdf'), 'pdf');

  if (ocr && res.method === 'ocr' && res.text) {
    // Camino OCR: hay texto reconocido (no exigimos contenido concreto).
    assert.equal(res.method, 'ocr');
    assert.ok((res.text as string).trim().length > 0, 'OCR produjo texto');
  } else {
    // Camino sin OCR (o OCR sin resultado): NO se inventa texto.
    assert.equal(res.method, 'manual_review_needed', 'sin OCR -> manual_review_needed');
    assert.equal(res.text, null, 'no se inventa texto (text=null)');
    assert.ok(res.warnings.length >= 1, 'hay un warning claro');
    assert.ok(
      res.warnings.some((w) => /ocr|escane|revis/i.test(w)),
      'el warning explica el motivo (OCR/escaneado/revision)',
    );
  }
});

/**
 * Test 4 — CSV/XLSX detecta tablas (parseCsv y/o detectFinancialColumns
 * devuelven columnas).
 */
test('4 — CSV: parseCsv y detectFinancialColumns detectan tabla y columnas', async () => {
  // 4a) parseCsv directo sobre contenido en memoria.
  const table = parseCsv(CSV_CONTENT);
  assert.ok(table.headers.length > 0, 'headers detectados');
  assert.ok(table.rows.length === 2, 'dos filas de datos');
  const detected = table.detected_columns ?? {};
  assert.ok(Object.keys(detected).length > 0, 'detected_columns no vacio');
  // Columnas financieras clave presentes.
  assert.ok('client' in detected, 'detecta columna cliente');
  assert.ok('amount' in detected, 'detecta columna importe');
  assert.ok('hours' in detected, 'detecta columna horas');

  // 4b) detectFinancialColumns directamente sobre encabezados.
  const cols = detectFinancialColumns(['Cliente', 'Importe', 'Horas', 'Fecha']);
  assert.ok(Object.keys(cols).length >= 3, 'mapea varias columnas logicas');

  // 4c) extraccion completa de un .csv en disco -> tabla con columnas.
  await writeFile(TMP_CSV, CSV_CONTENT, 'utf8');
  try {
    const res = await extractFromFile(TMP_CSV, 'csv');
    assert.equal(res.method, 'spreadsheet_parser');
    assert.ok(res.tables.length >= 1, 'extraccion produce tabla');
    assert.ok(
      Object.keys(res.tables[0].detected_columns ?? {}).length > 0,
      'la tabla extraida trae detected_columns',
    );
  } finally {
    await unlink(TMP_CSV).catch(() => {});
  }
});

/**
 * Test 5 — Documento ilegible queda con extraction_status failed O con warning
 * claro. Probamos un .pdf vacio (0 bytes) y un .png basura.
 */
test('5 — documento ilegible: failed o warning claro (no inventa)', async () => {
  // 5a) PDF vacio (0 bytes) -> failed con warning.
  const emptyPdf = await extractFromBuffer(Buffer.alloc(0), 'pdf', 'vacio.pdf');
  assert.equal(emptyPdf.text, null, 'pdf vacio: sin texto inventado');
  assert.ok(
    emptyPdf.status === 'failed' || emptyPdf.warnings.length >= 1,
    'pdf vacio: failed o warning claro',
  );

  // 5b) PNG basura (bytes aleatorios que no son una imagen valida).
  const junk = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x42, 0x69]);
  const badPng = await extractFromBuffer(junk, 'png', 'basura.png');
  // Sin OCR -> manual_review_needed + warning; con OCR fallido -> tambien warning.
  assert.equal(badPng.text, null, 'png basura: sin texto inventado');
  assert.ok(
    badPng.status === 'failed' || badPng.warnings.length >= 1,
    'png basura: failed o warning claro',
  );
  assert.ok(
    badPng.method === 'manual_review_needed' || badPng.status === 'failed',
    'png basura: manual_review_needed o failed',
  );
});
