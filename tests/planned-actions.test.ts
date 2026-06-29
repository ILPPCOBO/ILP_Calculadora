/**
 * Tests del módulo "Desglose de actuaciones previstas" (plannedActionsBreakdown).
 * Cubre generación desde estimación y desde cálculo, valoración explicada,
 * conexión con tareas, no-invención ante mandato insuficiente, coherencia de
 * horas, edición (editar/valorar/añadir/eliminar) y guardado en historial.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  generateBreakdown, createBreakdown, getBreakdown, listBreakdowns,
  updateBreakdown, deleteBreakdown,
} from '../services/plannedActionsBreakdown.ts';
import type { BreakdownInput } from '../services/plannedActionsBreakdown.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const created: string[] = [];
after(() => { for (const id of created) deleteBreakdown(id); });

function estimateInput(over: Partial<BreakdownInput> = {}): BreakdownInput {
  return {
    source_type: 'automatic_estimate',
    case_or_calculation_id: 'calc_test_estimate',
    service_category: 'Concursal',
    description: 'Concurso de acreedores: solicitud, informe de la administración concursal, negociación con acreedores y fase común.',
    tasks: ['Diseñar la estrategia concursal', 'Redactar la solicitud de concurso', 'Negociar con los acreedores', 'Revisar la documentación contable', 'Gestión administrativa del expediente'],
    estimated_total_hours: 70,
    estimated_total_fee: 18000,
    rate_used: 250,
    complexity_level: 'high',
    urgency_level: 'normal',
    ...over,
  };
}

// 1. Genera desglose desde "Describir caso" (estimación automática).
test('1 genera desglose desde una estimación automática', () => {
  const b = generateBreakdown(estimateInput());
  assert.equal(b.source_type, 'automatic_estimate');
  assert.ok(b.planned_actions.length >= 4);
  assert.ok(b.id.startsWith('brk_'));
});

// 2. Genera desglose desde "Calculadora" (cálculo manual).
test('2 genera desglose desde un cálculo manual', () => {
  const b = generateBreakdown(estimateInput({ source_type: 'manual_calculation', tasks: [], description: null, service_category: 'Laboral', estimated_total_hours: 20, estimated_total_fee: 5000 }));
  assert.equal(b.source_type, 'manual_calculation');
  assert.ok(b.planned_actions.length > 0);
});

// 3. Cada actuación tiene valoración alta, media o baja.
test('3 cada actuación tiene value_level high|medium|low', () => {
  const b = generateBreakdown(estimateInput());
  for (const a of b.planned_actions) {
    assert.ok(['high', 'medium', 'low'].includes(a.value_level), `value_level inválido: ${a.value_level}`);
  }
});

// 4. Cada valoración incluye explicación.
test('4 cada valoración incluye motivo y etiqueta', () => {
  const b = generateBreakdown(estimateInput());
  for (const a of b.planned_actions) {
    assert.ok(a.reason_for_value_level && a.reason_for_value_level.length > 0);
    assert.ok(a.value_label.startsWith('Aportación'));
  }
});

// 5. Las actuaciones están conectadas al servicio o a las tareas detectadas.
test('5 las actuaciones se conectan a las tareas detectadas', () => {
  const b = generateBreakdown(estimateInput());
  const titles = b.planned_actions.map((a) => a.action_title.toLowerCase());
  assert.ok(titles.some((t) => t.includes('estrategia')));
  assert.ok(titles.some((t) => t.includes('solicitud') || t.includes('redactar')));
});

// 6. No inventa actuaciones cuando el mandato es insuficiente (preliminar, baja confianza).
test('6 mandato insuficiente -> desglose preliminar de baja confianza', () => {
  const b = generateBreakdown(estimateInput({ tasks: [], description: 'despido', service_category: 'Laboral', estimated_total_hours: 20, estimated_total_fee: 5000 }));
  assert.ok(b.planned_actions.every((a) => a.confidence_level === 'low'), 'todas deberían ser baja confianza');
  assert.ok(b.assumptions.some((s) => /PRELIMINAR/i.test(s)));
  // Determinista: títulos de la plantilla del área (no aleatorios).
  assert.ok(b.planned_actions.some((a) => /demanda|despido/i.test(a.action_title)));
});

// 7. Si falta información, se rellena missing_information.
test('7 sin horas/honorario -> missing_information', () => {
  const b = generateBreakdown(estimateInput({ estimated_total_hours: null, estimated_total_fee: null }));
  assert.ok(b.missing_information.length >= 1);
  assert.ok(b.missing_information.some((m) => /horas/i.test(m)));
});

// 8. Las horas por actuación son coherentes con las horas totales.
test('8 las horas por actuación suman el total estimado', () => {
  const b = generateBreakdown(estimateInput());
  const sum = b.planned_actions.reduce((a, x) => a + (x.estimated_hours_recommended || 0), 0);
  assert.ok(Math.abs(sum - 70) <= 0.5, `suma ${sum} vs 70`);
  assert.equal(b.warnings.filter((w) => w.startsWith('Las horas')).length, 0);
});

test('8b reparto incoherente tras edición -> warning (regla 9)', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  const acts = saved.planned_actions.map((a, i) => (i === 0 ? { ...a, estimated_hours_recommended: 1 } : a));
  const edited = updateBreakdown(saved.id, { planned_actions: acts });
  assert.ok(edited);
  assert.ok((edited as { warnings: string[] }).warnings.some((w) => w.startsWith('Las horas')));
});

// 9. El usuario puede editar actuaciones.
test('9 editar el título de una actuación', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  const acts = saved.planned_actions.map((a, i) => (i === 0 ? { ...a, action_title: 'TÍTULO EDITADO' } : a));
  const edited = updateBreakdown(saved.id, { planned_actions: acts });
  assert.equal(edited?.planned_actions[0].action_title, 'TÍTULO EDITADO');
});

// 10. El usuario puede cambiar la valoración de valor.
test('10 cambiar la valoración recalcula distribución y etiqueta', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  const acts = saved.planned_actions.map((a, i) => (i === 0 ? { ...a, value_level: 'low' as const } : a));
  const edited = updateBreakdown(saved.id, { planned_actions: acts });
  assert.equal(edited?.planned_actions[0].value_level, 'low');
  assert.equal(edited?.planned_actions[0].value_label, 'Aportación Baja de Valor');
  const total = (edited as { value_distribution: { high_value_count: number; medium_value_count: number; low_value_count: number } }).value_distribution;
  assert.equal(total.high_value_count + total.medium_value_count + total.low_value_count, edited?.planned_actions.length);
});

// 11. El usuario puede añadir actuación manual.
test('11 añadir actuación manual (recibe id pa_)', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  const before = saved.planned_actions.length;
  const acts = [...saved.planned_actions, {
    action_title: 'Actuación manual', action_description: 'añadida a mano', value_level: 'medium',
    reason_for_value_level: 'manual', estimated_hours_recommended: 2, deliverable: 'X',
    responsible_profile: 'asociado', client_visible: true, internal_only: false, confidence_level: 'medium',
  }];
  const edited = updateBreakdown(saved.id, { planned_actions: acts as never });
  assert.equal(edited?.planned_actions.length, before + 1);
  assert.ok(edited?.planned_actions[before].id.startsWith('pa_'));
});

// 12. El usuario puede eliminar actuación.
test('12 eliminar una actuación', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  const before = saved.planned_actions.length;
  const acts = saved.planned_actions.slice(1);
  const edited = updateBreakdown(saved.id, { planned_actions: acts });
  assert.equal(edited?.planned_actions.length, before - 1);
});

// 13. El desglose se guarda en historial (persistencia).
test('13 el desglose se guarda y se recupera', () => {
  const saved = createBreakdown(estimateInput(), 'tester'); created.push(saved.id);
  assert.ok(getBreakdown(saved.id));
  assert.ok(listBreakdowns().some((b) => b.id === saved.id));
  assert.equal(saved.created_by, 'tester');
});

// 20. El menú lateral incluye "Desglose de actuaciones".
test('20 el menú lateral y el router incluyen "Desglose de actuaciones"', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'index.html'), 'utf8');
  assert.ok(html.includes('data-route="planned-actions"'));
  assert.ok(html.includes('Desglose de actuaciones'));
  const appjs = readFileSync(join(ROOT, 'frontend', 'app.js'), 'utf8');
  assert.ok(appjs.includes("'planned-actions'"));
});
