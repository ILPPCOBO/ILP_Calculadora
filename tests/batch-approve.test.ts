/* Tests de aprobación por lotes + que la estimación pasa a usar el PRECIO histórico
   una vez aprobados los registros del área. Categoría aislada + limpieza. */

import { test } from 'node:test';
import assert from 'node:assert';
import { recordsRepo } from '../backend/storage/index.ts';
import { approveBatch } from '../services/recordReview.ts';
import { estimateCase } from '../services/caseEstimator.ts';
import type { ExtractedWorkRecord } from '../backend/models/index.ts';

const CAT = '__test_batch__';

function mkPending(id: string, fee: number): ExtractedWorkRecord {
  return {
    id, document_id: 'doc_x', client_name: 'X SL', matter_name: null,
    service_category: CAT, service_subcategory: null, service_description: 'asunto fijo',
    date: '2025-01-01', total_fee: fee, currency: 'EUR', fee_type: 'fixed',
    hours_worked: null, hourly_rate: null, professional_role: null, number_of_professionals: null,
    complexity_level: 'medium', urgency_level: 'normal', discounts: null, payment_terms: null,
    extracted_from: 'fix', source_location: [], confidence_level: 'medium',
    review_status: 'pending_review', approved_by: null, approved_at: null,
    rejected_reason: null, created_at: '2025-01-01T00:00:00.000Z',
  };
}

test('approveBatch aprueba todos los pendientes del área y la estimación usa el precio histórico', () => {
  const ids = ['tb1', 'tb2', 'tb3'];
  try {
    [6000, 9000, 12000].forEach((f, i) => recordsRepo.save(mkPending(ids[i], f)));

    const res = approveBatch('tester', CAT);
    assert.strictEqual(res.approved, 3, 'aprueba los 3 pendientes del área');
    ids.forEach((id) => assert.strictEqual(recordsRepo.get(id)?.review_status, 'approved'));

    // Ahora la estimación se ancla al precio histórico (mediana 9000 €), no a baseline.
    const e = estimateCase({ description: 'Encargo de este tipo: preparar, revisar y entregar la documentación correspondiente.', area: CAT });
    assert.strictEqual(e.fee_recommended, 9000, 'honorario recomendado = mediana del precio histórico (9000)');
    assert.ok(e.comparable_records.length >= 3);
    assert.match(e.explanation, /precio histórico/i);
  } finally {
    ids.forEach((id) => recordsRepo.delete(id));
  }
});

test('approveBatch sólo afecta al área indicada (no toca otras áreas ni datos reales)', () => {
  const id = 'tb_solo';
  try {
    recordsRepo.save(mkPending(id, 5000));
    // Filtrar por una categoría inexistente no aprueba nada.
    assert.strictEqual(approveBatch('tester', '__test_batch_inexistente__').approved, 0);
    // El registro de prueba sigue pendiente (no se tocó otra área).
    assert.strictEqual(recordsRepo.get(id)?.review_status, 'pending_review');
    // Filtrando por SU categoría aislada sí se aprueba.
    assert.strictEqual(approveBatch('tester', CAT).approved, 1);
    assert.strictEqual(recordsRepo.get(id)?.review_status, 'approved');
  } finally {
    recordsRepo.delete(id);
  }
});
