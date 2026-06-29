/* Tests de deleteDocument — borrado de documentos subidos con cascada de registros
   y salvaguarda de registros aprobados. Usa ids aislados (sin "_" inicial, que el
   repositorio JSON ignora) y limpia todo lo que crea. */

import { test } from 'node:test';
import assert from 'node:assert';
import { documentsRepo, recordsRepo } from '../backend/storage/index.ts';
import { deleteDocument } from '../services/documentUploadService.ts';
import type { UploadedDocument, ExtractedWorkRecord, ReviewStatus } from '../backend/models/index.ts';

function mkDoc(id: string): UploadedDocument {
  return {
    id,
    original_filename: `${id}.txt`,
    file_type: 'txt',
    uploaded_at: '2025-01-01T00:00:00.000Z',
    uploaded_by: 'tester',
    document_type: 'other',
    extraction_status: 'completed',
    extraction_method: 'native_text',
    extracted_text: 'fixture',
    extracted_tables: [],
    warnings: [],
    source_locations: [],
    confidence_level: 'low',
    stored_path: null, // sin binario real
  };
}

function mkRec(id: string, docId: string, status: ReviewStatus): ExtractedWorkRecord {
  return {
    id,
    document_id: docId,
    client_name: 'Fix SL',
    matter_name: null,
    service_category: '__test_del__',
    service_subcategory: null,
    service_description: 'fix',
    date: null,
    total_fee: 1000,
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
    extracted_from: 'fix',
    source_location: [],
    confidence_level: 'low',
    review_status: status,
    approved_by: status === 'approved' ? 'tester' : null,
    approved_at: status === 'approved' ? '2025-01-02T00:00:00.000Z' : null,
    rejected_reason: null,
    created_at: '2025-01-01T00:00:00.000Z',
  };
}

test('deleteDocument: borra el documento y sus registros pendientes en cascada', () => {
  const docId = 'tdeldoc_a';
  const recIds = ['tdel_a1', 'tdel_a2'];
  documentsRepo.save(mkDoc(docId));
  recordsRepo.save(mkRec(recIds[0], docId, 'pending_review'));
  recordsRepo.save(mkRec(recIds[1], docId, 'rejected'));

  const res = deleteDocument(docId);
  assert.ok(res, 'devuelve resultado');
  assert.strictEqual(res!.deleted, true);
  assert.strictEqual(res!.blocked, false);
  assert.strictEqual(res!.records_deleted, 2);
  assert.strictEqual(documentsRepo.get(docId), null, 'el documento ya no existe');
  assert.strictEqual(recordsRepo.get(recIds[0]), null, 'registro pendiente borrado');
  assert.strictEqual(recordsRepo.get(recIds[1]), null, 'registro rechazado borrado');
});

test('deleteDocument: bloquea si hay registros APROBADOS y no se fuerza', () => {
  const docId = 'tdeldoc_b';
  const recId = 'tdel_b1';
  documentsRepo.save(mkDoc(docId));
  recordsRepo.save(mkRec(recId, docId, 'approved'));

  try {
    const res = deleteDocument(docId); // sin force
    assert.ok(res);
    assert.strictEqual(res!.deleted, false, 'no borra sin confirmación');
    assert.strictEqual(res!.blocked, true);
    assert.strictEqual(res!.records_approved, 1);
    assert.ok(documentsRepo.get(docId) !== null, 'el documento sigue existiendo');
    assert.ok(recordsRepo.get(recId) !== null, 'el registro aprobado sigue existiendo');

    // Con force => borra todo, incluidos los aprobados.
    const forced = deleteDocument(docId, { force: true });
    assert.strictEqual(forced!.deleted, true);
    assert.strictEqual(forced!.records_deleted, 1);
    assert.strictEqual(documentsRepo.get(docId), null);
    assert.strictEqual(recordsRepo.get(recId), null);
  } finally {
    documentsRepo.delete(docId);
    recordsRepo.delete(recId);
  }
});

test('deleteDocument: documento inexistente => null (para 404)', () => {
  assert.strictEqual(deleteDocument('no_existe_xyz'), null);
});
