/* Tests de valuationCriteria — criterios de valoración por materia y su
   integración en el estimador (Conflictos Societarios). No tocan repos. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  getValuationCriteria, listMatterCriteria,
} from '../services/valuationCriteria.ts';
import { estimateCase } from '../services/caseEstimator.ts';

const CONFLICT_DESC =
  'Defensa de los socios minoritarios (40% del capital) frente al socio mayoritario y '
  + 'administrador único: revisar la retribución del administrador, analizar la convocatoria y '
  + 'el quórum de las juntas, el reparto de dividendos y la dotación de reservas con posible '
  + 'abuso de la mayoría (art. 348 bis), preparar la impugnación de acuerdos y la acción de '
  + 'responsabilidad, y negociar por vía MASC y judicial un acuerdo de gobernanza.';

test('getValuationCriteria: casa por categoría + subcategoría exactas', () => {
  const c = getValuationCriteria('Asesoramiento corporativo', 'Conflictos Societarios');
  assert.ok(c, 'devuelve criterios');
  assert.strictEqual(c?.service_subcategory, 'Conflictos Societarios');
  assert.ok((c?.reference_fees.length ?? 0) >= 6, 'incluye el cuadro de honorarios');
});

test('getValuationCriteria: casa por señal de la descripción (>=2 keywords) sin subcategoría', () => {
  const c = getValuationCriteria('Asesoramiento corporativo', null, CONFLICT_DESC);
  assert.ok(c, 'detecta la materia por keywords');
  assert.strictEqual(c?.service_subcategory, 'Conflictos Societarios');
});

test('getValuationCriteria: también casa por descripción cuando la categoría es unknown', () => {
  const c = getValuationCriteria('unknown', null, CONFLICT_DESC);
  assert.ok(c, 'no exige categoría conocida si la descripción es clara');
});

test('getValuationCriteria: no cruza de área si la categoría conocida no coincide', () => {
  // Aunque la descripción tenga keywords societarias, si el área fijada es otra, no fuerza.
  const c = getValuationCriteria('Laboral', null, CONFLICT_DESC);
  assert.strictEqual(c, null);
});

test('getValuationCriteria: materia no capturada => null (no inventa, R12)', () => {
  const c = getValuationCriteria('Protección de datos', 'RGPD y LOPDGDD', 'adaptación a RGPD de una web');
  assert.strictEqual(c, null);
});

test('reference_fees: importes de referencia de la propuesta (10k/2k/7k/15k/10k y 60% a cuenta)', () => {
  const c = getValuationCriteria('Asesoramiento corporativo', 'Conflictos Societarios');
  const amounts = (c?.reference_fees ?? []).map((f) => f.amount);
  assert.ok(amounts.includes(10000), 'fase 1 y comisión de éxito: 10.000');
  assert.ok(amounts.includes(2000), 'MASC: 2.000');
  assert.ok(amounts.includes(7000), 'demanda civil/mercantil: 7.000');
  assert.ok(amounts.includes(15000), 'querella/penal: 15.000');
  const aCuenta = (c?.reference_fees ?? []).find((f) => f.model === 'a_cuenta');
  assert.strictEqual(aCuenta?.percentage, 60, 'cantidades a cuenta: 60%');
  // Penal se pondera por encima de civil (criterio de valoración).
  const penal = (c?.reference_fees ?? []).find((f) => f.concept.includes('querella'));
  const civil = (c?.reference_fees ?? []).find((f) => f.concept.includes('demanda'));
  assert.ok((penal?.amount ?? 0) > (civil?.amount ?? 0), 'penal > civil/mercantil');
});

test('listMatterCriteria: incluye Conflictos Societarios con base jurídica trazable', () => {
  const all = listMatterCriteria();
  const conf = all.find((m) => m.service_subcategory === 'Conflictos Societarios');
  assert.ok(conf, 'la materia está en el catálogo');
  assert.ok(conf!.legal_basis.some((l) => l.includes('348 bis')), 'cita el art. 348 bis LSC');
  assert.ok(conf!.legal_basis.some((l) => l.includes('217')), 'cita el art. 217 LSC');
  assert.ok(conf!.source.startsWith('docs/propuestas/'), 'apunta al documento de referencia versionado');
});

test('estimateCase: adjunta los criterios de la materia detectada y avisa de la estructura propia', () => {
  const e = estimateCase({ description: CONFLICT_DESC });
  assert.strictEqual(e.needs_more_info, false);
  assert.ok(e.valuation_criteria, 'la estimación lleva los criterios de valoración');
  assert.strictEqual(e.valuation_criteria?.service_subcategory, 'Conflictos Societarios');
  assert.ok(
    e.warnings.some((w) => w.toLowerCase().includes('fases') || w.toLowerCase().includes('actuación')),
    'avisa de que la materia se estructura por criterios propios',
  );
  // El motor por horas sigue produciendo su rango numérico (no se reescribe).
  assert.ok((e.fee_recommended ?? 0) > 0, 'mantiene el rango numérico por horas');
});

test('estimateCase: materia genérica => sin criterios de valoración (valuation_criteria null)', () => {
  const e = estimateCase({
    description: 'Revisar un contrato de distribución internacional y preparar comentarios para el cliente.',
  });
  assert.strictEqual(e.valuation_criteria, null);
});

test('estimateCase: descripción vaga => valuation_criteria null (no fuerza materia)', () => {
  const e = estimateCase({ description: 'ayuda' });
  assert.strictEqual(e.needs_more_info, true);
  assert.strictEqual(e.valuation_criteria, null);
});
