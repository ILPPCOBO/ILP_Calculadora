/* Tests del cálculo por PRECIO FIJO e IGUALA MENSUAL (modelo español, sin horas),
   derivado de los acuerdos históricos APROBADOS del área. Categorías aisladas + limpieza. */

import { test } from 'node:test';
import assert from 'node:assert';
import { recordsRepo } from '../backend/storage/index.ts';
import { calculateFee } from '../services/feeCalculator.ts';
import type { ExtractedWorkRecord, FeeType } from '../backend/models/index.ts';

function mk(id: string, cat: string, fee: number, feeType: FeeType): ExtractedWorkRecord {
  return {
    id, document_id: 'doc_x', client_name: 'Fix SL', matter_name: null,
    service_category: cat, service_subcategory: null, service_description: 'fix',
    date: '2025-01-01', total_fee: fee, currency: 'EUR', fee_type: feeType,
    hours_worked: null, hourly_rate: null, professional_role: null, number_of_professionals: null,
    complexity_level: 'medium', urgency_level: 'normal', discounts: null, payment_terms: null,
    extracted_from: 'fix', source_location: [], confidence_level: 'high',
    review_status: 'approved', approved_by: 'tester', approved_at: '2025-01-02T00:00:00.000Z',
    rejected_reason: null, created_at: '2025-01-01T00:00:00.000Z',
  };
}

test('precio fijo: sin horas, recomienda la mediana histórica del área', () => {
  const cat = '__test_fixed__';
  const ids = ['tfx1', 'tfx2', 'tfx3'];
  try {
    [3000, 5000, 7000].forEach((f, i) => recordsRepo.save(mk(ids[i], cat, f, 'fixed')));
    const out = calculateFee({ service_category: cat, estimated_hours: null, fee_type: 'fixed' });
    assert.strictEqual(out.needs_input, false, 'no exige horas para precio fijo');
    assert.strictEqual(out.calculated_recommended, 5000, 'mediana de [3000,5000,7000]');
    assert.strictEqual(out.calculated_min, 4000, 'P25');
    assert.strictEqual(out.calculated_max, 6000, 'P75');
    assert.match(out.formula_used, /[Pp]recio fijo/);
  } finally { ids.forEach((id) => recordsRepo.delete(id)); }
});

test('iguala mensual: recomienda la mensualidad mediana; × meses si se indica', () => {
  const cat = '__test_monthly__';
  const ids = ['tm1', 'tm2', 'tm3'];
  try {
    [600, 800, 1000].forEach((f, i) => recordsRepo.save(mk(ids[i], cat, f, 'monthly')));
    const oneMonth = calculateFee({ service_category: cat, estimated_hours: null, fee_type: 'monthly' });
    assert.strictEqual(oneMonth.needs_input, false);
    assert.strictEqual(oneMonth.calculated_recommended, 800, 'mediana mensual');
    assert.match(oneMonth.formula_used, /[Ii]guala mensual/);

    const threeMonths = calculateFee({ service_category: cat, estimated_hours: null, fee_type: 'monthly', estimated_months: 3 });
    assert.strictEqual(threeMonths.calculated_recommended, 2400, '800 × 3 meses');
  } finally { ids.forEach((id) => recordsRepo.delete(id)); }
});

test('auto: si el área es predominantemente fija, calcula fijo aunque no se pida tipo', () => {
  const cat = '__test_auto_fixed__';
  const ids = ['taf1', 'taf2', 'taf3'];
  try {
    [9000, 10000, 11000].forEach((f, i) => recordsRepo.save(mk(ids[i], cat, f, 'fixed')));
    const out = calculateFee({ service_category: cat, estimated_hours: null }); // sin fee_type
    assert.strictEqual(out.needs_input, false, 'usa el modelo predominante (fijo), no exige horas');
    assert.strictEqual(out.calculated_recommended, 10000);
    assert.strictEqual(out.reference?.predominant_fee_type, 'fixed');
  } finally { ids.forEach((id) => recordsRepo.delete(id)); }
});

test('precio fijo sin histórico => información insuficiente (R11), no inventa', () => {
  const out = calculateFee({ service_category: '__test_fixed_vacio__', estimated_hours: null, fee_type: 'fixed' });
  assert.strictEqual(out.calculated_recommended, null, 'no inventa un precio fijo');
  assert.strictEqual(out.needs_input, true);
  assert.match(out.warnings.join(' '), /insuficiente/i);
});

test('por horas sigue intacto: 10h sin tipo ni histórico => 2500 (tarifa base 250)', () => {
  const out = calculateFee({ service_category: '__test_hourly_intact__', estimated_hours: 10 });
  assert.strictEqual(out.calculated_recommended, 2500);
});
