/* Tests de services/referencePricing.ts — biblioteca de referencias de precios.
   Usa una categoría AISLADA y limpia sus fixtures al terminar (no toca seed). */

import { test } from 'node:test';
import assert from 'node:assert';
import { recordsRepo } from '../backend/storage/index.ts';
import { buildReference, listReferences } from '../services/referencePricing.ts';
import type { ExtractedWorkRecord, ReviewStatus } from '../backend/models/index.ts';

const CAT = '__test_ref__';

function mkRecord(id: string, fee: number | null, status: ReviewStatus, hourly: number | null = null): ExtractedWorkRecord {
  return {
    id,
    document_id: 'doc_test',
    client_name: 'Fixture SL',
    matter_name: 'Asunto fixture',
    service_category: CAT,
    service_subcategory: 'Sub',
    service_description: 'fixture',
    date: '2025-01-01',
    total_fee: fee,
    currency: 'EUR',
    fee_type: 'hourly',
    hours_worked: null,
    hourly_rate: hourly,
    professional_role: null,
    number_of_professionals: null,
    complexity_level: 'medium',
    urgency_level: 'normal',
    discounts: null,
    payment_terms: null,
    extracted_from: 'fixture',
    source_location: [],
    confidence_level: 'high',
    review_status: status,
    approved_by: status === 'approved' ? 'tester' : null,
    approved_at: status === 'approved' ? '2025-01-02T00:00:00.000Z' : null,
    rejected_reason: null,
    created_at: '2025-01-01T00:00:00.000Z',
  };
}

test('referencia: agrega sólo acuerdos approved con importe (R3) y calcula la mediana', () => {
  const ids: string[] = [];
  try {
    [3000, 5000, 7000].forEach((fee, i) => {
      const r = mkRecord(`tref_a${i}`, fee, 'approved', 250);
      recordsRepo.save(r); ids.push(r.id);
    });
    // Un pendiente NO debe contar (R3).
    const p = mkRecord('tref_pending', 99999, 'pending_review');
    recordsRepo.save(p); ids.push(p.id);

    const ref = buildReference(CAT);
    assert.strictEqual(ref.sample_size, 3, 'sólo los 3 aprobados con importe cuentan');
    assert.strictEqual(ref.fee_median, 5000, 'mediana de [3000,5000,7000]');
    assert.strictEqual(ref.fee_min, 3000);
    assert.strictEqual(ref.fee_max, 7000);
    assert.ok(!ref.based_on_record_ids.includes('tref_pending'), 'el pendiente no aparece');
    assert.ok(['medium', 'high'].includes(ref.confidence_level));
    assert.strictEqual(ref.hourly_rate_median, 250, 'tarifa/hora típica de los aprobados');
  } finally {
    ids.forEach((id) => recordsRepo.delete(id));
  }
});

test('referencia: área sin acuerdos aprobados => información insuficiente (R11/R12)', () => {
  const ref = buildReference('__test_ref_vacio__');
  assert.strictEqual(ref.sample_size, 0);
  assert.strictEqual(ref.confidence_level, 'low');
  assert.match(ref.note, /insuficiente/i);
  assert.strictEqual(ref.fee_median, null, 'no inventa importes');
});

test('listReferences incluye una entrada para la categoría con datos aprobados', () => {
  const ids: string[] = [];
  try {
    [1000, 2000].forEach((fee, i) => {
      const r = mkRecord(`tref_l${i}`, fee, 'approved');
      recordsRepo.save(r); ids.push(r.id);
    });
    const refs = listReferences();
    const mine = refs.filter((x) => x.service_category === CAT);
    assert.ok(mine.length >= 1, 'aparece la categoría de prueba en la biblioteca');
    assert.ok(mine.some((x) => x.sample_size === 2));
  } finally {
    ids.forEach((id) => recordsRepo.delete(id));
  }
});
