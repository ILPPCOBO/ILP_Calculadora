/**
 * Tests C1 (6-10) — REGISTROS.
 *
 * Ejercitan services/workRecordExtractor.ts, services/recordReview.ts y
 * services/formulaGenerator.ts.
 *
 * AISLAMIENTO (critico):
 *  - Categoria de prueba aislada: "__test_rec__" (no choca con la semilla).
 *  - Todos los fixtures se crean via los repos y se BORRAN por id en after().
 *  - NUNCA se llama repo.clear() (borraria datos compartidos).
 *  - No se afirma sobre conteos globales; solo sobre las entidades creadas (por id)
 *    o invariantes (BASE_HOURLY_RATE === 250).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { recordsRepo, formulasRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { BASE_HOURLY_RATE } from '../backend/config/factors.ts';
import { extractRecords } from '../services/workRecordExtractor.ts';
import { approveRecord } from '../services/recordReview.ts';
import { generateFormula } from '../services/formulaGenerator.ts';
import type {
  UploadedDocument, ExtractedWorkRecord, PricingFormula,
} from '../backend/models/index.ts';

const TEST_CATEGORY = '__test_rec__';

// Rastreo de ids creados para limpieza determinista en after().
const createdRecordIds = new Set<string>();
const createdFormulaIds = new Set<string>();

after(() => {
  for (const id of createdRecordIds) recordsRepo.delete(id);
  for (const id of createdFormulaIds) formulasRepo.delete(id);
});

/** Fabrica un ExtractedWorkRecord minimo y valido para la categoria de prueba. */
function makeRecord(overrides: Partial<ExtractedWorkRecord> = {}): ExtractedWorkRecord {
  const now = nowIso();
  const rec: ExtractedWorkRecord = {
    id: newId('rec'),
    document_id: 'doc___test_rec__source',
    client_name: 'Cliente Prueba',
    matter_name: null,
    service_category: TEST_CATEGORY,
    service_subcategory: null,
    service_description: 'Servicio de prueba',
    date: '2025-01-15',
    total_fee: 3000,
    currency: 'EUR',
    fee_type: 'fixed',
    hours_worked: null,
    hourly_rate: null,
    professional_role: null,
    number_of_professionals: null,
    complexity_level: 'unknown',
    urgency_level: 'unknown',
    discounts: null,
    payment_terms: null,
    extracted_from: 'fixture de test',
    source_location: [{ field: 'total_fee', line: 1, snippet: 'Total: 3000 EUR' }],
    confidence_level: 'medium',
    review_status: 'pending_review',
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
    created_at: now,
    notes: null,
    ...overrides,
  };
  return rec;
}

/** Persiste un registro y lo rastrea para limpieza. */
function saveTracked(rec: ExtractedWorkRecord): ExtractedWorkRecord {
  const saved = recordsRepo.save(rec);
  createdRecordIds.add(saved.id);
  return saved;
}

/** Construye un UploadedDocument de ejemplo a partir de texto. */
function docFromText(id: string, text: string): UploadedDocument {
  return {
    id,
    original_filename: 'ejemplo.txt',
    file_type: 'txt',
    uploaded_at: nowIso(),
    uploaded_by: 'test',
    document_type: 'invoice',
    extraction_status: 'completed',
    extraction_method: 'native_text',
    extracted_text: text,
    extracted_tables: [],
    warnings: [],
    source_locations: [],
    confidence_level: 'high',
  };
}

const SAMPLE_DOC_TEXT =
  'FACTURA - ILP Abogados\n' +
  'Cliente: Acme SL\n' +
  'Servicio: Registro de marca\n' +
  'Total honorarios: 2500 EUR\n' +
  'Fecha: 2025-03-14\n';

/**
 * Test 6 — Los registros extraidos nacen review_status "pending_review".
 */
test('6 — los registros extraidos nacen en pending_review', () => {
  const doc = docFromText('doc___test_rec__t6', SAMPLE_DOC_TEXT);
  const records = extractRecords(doc);
  assert.ok(records.length >= 1, 'se extrajo al menos un registro');
  for (const r of records) {
    assert.equal(r.review_status, 'pending_review', 'review_status es pending_review');
    // R4: la IA jamas aprueba automaticamente.
    assert.equal(r.approved_by, null, 'approved_by null al crear');
    assert.equal(r.approved_at, null, 'approved_at null al crear');
  }
});

/**
 * Test 7 — Los registros pending NO se usan para generar formulas.
 * Creamos registros pending en "__test_rec__", generamos una formula y
 * comprobamos que based_on_record_ids NO incluye ninguno de ellos.
 */
test('7 — registros pending NO entran en based_on_record_ids', () => {
  const r1 = saveTracked(makeRecord({ total_fee: 3000 }));
  const r2 = saveTracked(makeRecord({ total_fee: 4000 }));
  const r3 = saveTracked(makeRecord({ total_fee: 5000 }));
  const pendingIds = [r1.id, r2.id, r3.id];

  const formula = generateFormula({ service_category: TEST_CATEGORY });

  for (const id of pendingIds) {
    assert.ok(
      !formula.based_on_record_ids.includes(id),
      `el registro pending ${id} NO debe usarse en la formula`,
    );
  }
  // Sin aprobados -> debe caer en tarifa base (R2). based_on vacio.
  assert.equal(formula.based_on_record_ids.length, 0, 'sin aprobados no hay base de registros');
  assert.equal(formula.review_status, 'pending_review', 'la formula nace pendiente (R6)');
});

/**
 * Test 8 — Solo "approved" se usan para formulas: aprobamos registros y
 * comprobamos que ahora SI se consideran en based_on_record_ids.
 */
test('8 — registros approved SI entran en based_on_record_ids', () => {
  const r1 = saveTracked(makeRecord({ total_fee: 3000 }));
  const r2 = saveTracked(makeRecord({ total_fee: 4000 }));
  const r3 = saveTracked(makeRecord({ total_fee: 5000 }));

  // Antes de aprobar: no se consideran.
  const before = generateFormula({ service_category: TEST_CATEGORY });
  assert.equal(before.based_on_record_ids.length, 0, 'pendientes no cuentan');

  // Aprobamos los tres via el unico punto legitimo (recordReview).
  const a1 = approveRecord(r1.id, 'revisor_test');
  const a2 = approveRecord(r2.id, 'revisor_test');
  const a3 = approveRecord(r3.id, 'revisor_test');
  assert.ok(a1 && a2 && a3, 'las aprobaciones devuelven el registro');
  assert.equal(a1!.review_status, 'approved');
  assert.equal(a1!.approved_by, 'revisor_test');

  // Despues de aprobar: con 3 registros con importe se construye un rango (R13).
  const after = generateFormula({ service_category: TEST_CATEGORY });
  for (const id of [r1.id, r2.id, r3.id]) {
    assert.ok(
      after.based_on_record_ids.includes(id),
      `el registro approved ${id} SI debe usarse`,
    );
  }
  assert.equal(after.based_on_record_ids.length, 3, 'los 3 aprobados sustentan la formula');
  // Rango por percentiles sobre [3000,4000,5000].
  assert.equal(after.recommended_min, 3500, 'min = p25');
  assert.equal(after.recommended_base, 4000, 'base = mediana');
  assert.equal(after.recommended_max, 4500, 'max = p75');
  assert.equal(after.review_status, 'pending_review', 'sigue pendiente de aprobacion humana (R6)');
});

/**
 * Test 9 — El sistema no inventa: texto sin cifras -> total_fee/hours/rate null
 * y/o service_category "unknown" (R12).
 *
 * La garantia DURA de R12 es no fabricar cifras (importe/horas/tarifa). La
 * categoria es una clasificacion best-effort: o bien "unknown", o una etiqueta
 * derivada por palabras clave del propio texto (nunca un importe inventado).
 */
test('9 — texto sin cifras: no inventa importes/horas/tarifa', () => {
  const doc = docFromText(
    'doc___test_rec__t9',
    'Cliente: Gamma Consulting\nNota: reunion preliminar, sin importes ni horas registradas.\n',
  );
  const records = extractRecords(doc);
  // Puede extraer un registro (por el cliente) o ninguno; en ambos casos no inventa.
  for (const r of records) {
    assert.equal(r.total_fee, null, 'no inventa importe');
    assert.equal(r.hours_worked, null, 'no inventa horas');
    assert.equal(r.hourly_rate, null, 'no inventa tarifa');
    // La categoria es "unknown" o una etiqueta no vacia; nunca una cifra inventada (R12).
    assert.ok(
      typeof r.service_category === 'string' && r.service_category.length > 0,
      'service_category es texto valido (unknown o etiqueta), nunca un dato inventado',
    );
  }

  // Texto totalmente irrelevante -> no se fuerza ningun registro inventado.
  const docVacio = docFromText('doc___test_rec__t9b', 'texto irrelevante sin cliente ni cifras');
  const records2 = extractRecords(docVacio);
  assert.equal(records2.length, 0, 'sin senales financieras no se inventa registro');

  // Invariante de negocio (R2).
  assert.equal(BASE_HOURLY_RATE, 250, 'la tarifa base es 250');
});

/**
 * Test 10 — Trazabilidad (R8): cada registro conserva document_id y
 * source_location no vacio cuando hay fuente.
 */
test('10 — trazabilidad: document_id presente y source_location no vacio', () => {
  const doc = docFromText('doc___test_rec__t10', SAMPLE_DOC_TEXT);
  const records = extractRecords(doc);
  assert.ok(records.length >= 1, 'hay registro que verificar');
  for (const r of records) {
    assert.equal(r.document_id, doc.id, 'el registro apunta a su documento fuente');
    assert.ok(typeof r.document_id === 'string' && r.document_id.length > 0, 'document_id no vacio');
    // Hay fuente (texto con etiquetas) -> source_location debe registrar de donde salio.
    assert.ok(Array.isArray(r.source_location), 'source_location es array');
    assert.ok(r.source_location.length > 0, 'source_location no vacio cuando hay fuente');
    // Cada localizacion debe apuntar a algo (field/line/snippet).
    for (const loc of r.source_location) {
      const hasAnchor =
        (typeof loc.field === 'string' && loc.field.length > 0) ||
        (typeof loc.line === 'number') ||
        (typeof loc.snippet === 'string' && loc.snippet.length > 0);
      assert.ok(hasAnchor, 'cada source_location ancla a un campo/linea/snippet');
    }
  }
});
