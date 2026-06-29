/* Tests de caseEstimator — estimación de horas y honorarios desde lenguaje natural.
   Categorías aisladas (ids sin "_" inicial) + limpieza. NUNCA repo.clear(). */

import { test } from 'node:test';
import assert from 'node:assert';
import { recordsRepo, calculationsRepo } from '../backend/storage/index.ts';
import { estimateCase, estimateAndSaveCase, identifyTasks } from '../services/caseEstimator.ts';
import type { ExtractedWorkRecord } from '../backend/models/index.ts';

const DESC = 'El cliente necesita revisar un contrato de distribución internacional, '
  + 'preparar comentarios, participar en una reunión de negociación y entregar una versión revisada del documento.';

function mkApproved(id: string, cat: string, hours: number): ExtractedWorkRecord {
  return {
    id, document_id: 'doc_x', client_name: 'Fix SL', matter_name: null,
    service_category: cat, service_subcategory: null, service_description: 'fix',
    date: '2025-01-01', total_fee: hours * 250, currency: 'EUR', fee_type: 'hourly',
    hours_worked: hours, hourly_rate: 250, professional_role: null, number_of_professionals: null,
    complexity_level: 'medium', urgency_level: 'normal', discounts: null, payment_terms: null,
    extracted_from: 'fix', source_location: [], confidence_level: 'high',
    review_status: 'approved', approved_by: 'tester', approved_at: '2025-01-02T00:00:00.000Z',
    rejected_reason: null, created_at: '2025-01-01T00:00:00.000Z',
  };
}

test('identifyTasks: separa la descripción en varias tareas con verbos de acción', () => {
  const tasks = identifyTasks('revisar el contrato, preparar comentarios y participar en la reunión');
  assert.ok(tasks.length >= 2, `esperaba >=2 tareas, hubo ${tasks.length}`);
});

test('estimateCase: descripción detallada => estima horas y honorarios con tarifa base 250', () => {
  const e = estimateCase({ description: DESC, area: 'Contratos mercantiles' });
  assert.strictEqual(e.needs_more_info, false);
  assert.ok((e.hours_recommended ?? 0) > 0, 'estima horas');
  assert.ok((e.fee_recommended ?? 0) > 0, 'estima honorarios');
  assert.strictEqual(e.rate_used, 250, 'usa tarifa base sin tarifa personalizada');
  assert.strictEqual(e.used_base_rate, true);
  assert.ok(['low', 'medium', 'high'].includes(e.confidence_level));
});

test('estimateCase: tarifa personalizada => coherencia fee = horas × tarifa × factores', () => {
  const e = estimateCase({ description: DESC, hourly_rate: 400, complexity: 'high', urgency: 'urgent' });
  assert.strictEqual(e.rate_used, 400);
  assert.strictEqual(e.used_base_rate, false);
  const expected = Math.round((e.hours_recommended as number) * 400 * e.complexity_factor * e.urgency_factor * e.discount_factor * 100) / 100;
  assert.strictEqual(e.fee_recommended, expected, 'el honorario recomendado es coherente con horas×tarifa×factores');
});

test('estimateCase: descripción vaga => pide más información, no inventa', () => {
  const e = estimateCase({ description: 'ayuda' });
  assert.strictEqual(e.needs_more_info, true);
  assert.strictEqual(e.fee_recommended, null);
  assert.strictEqual(e.hours_recommended, null);
});

test('estimateCase: sin trabajos aprobados en el área => no inventa comparables', () => {
  const e = estimateCase({ description: DESC, area: 'Otros' });
  // 'Otros' no tiene registros approved con horas en datos de prueba aislados.
  assert.ok(Array.isArray(e.comparable_records));
});

test('estimateCase: con >=3 trabajos aprobados, las horas salen del histórico', () => {
  const cat = '__test_case_hist__';
  const ids = ['tcase1', 'tcase2', 'tcase3'];
  try {
    [10, 20, 30].forEach((h, i) => recordsRepo.save(mkApproved(ids[i], cat, h)));
    const e = estimateCase({ description: DESC, area: cat });
    assert.strictEqual(e.hours_recommended, 20, 'mediana de [10,20,30] horas');
    assert.ok(e.comparable_records.length >= 3, 'incluye los trabajos comparables');
  } finally { ids.forEach((id) => recordsRepo.delete(id)); }
});

test('estimateAndSaveCase: guarda la estimación en el historial (R17)', () => {
  const e = estimateAndSaveCase({ description: DESC, area: 'Contratos mercantiles' }, 'tester');
  assert.ok(e.calculation_id, 'devuelve calculation_id');
  try {
    assert.ok(calculationsRepo.get(e.calculation_id as string) !== null, 'el cálculo está en el historial');
  } finally {
    if (e.calculation_id) calculationsRepo.delete(e.calculation_id);
  }
});
