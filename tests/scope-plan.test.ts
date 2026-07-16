/**
 * Pruebas del alcance expandido por IA (plan de trabajo estructurado).
 * NO llaman a la API: inyectan un ScopePlan simulado en generateProposal para
 * verificar el renderizado. También comprueban que, sin plan, el comportamiento
 * determinista no cambia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProposal } from '../services/proposalGenerator.ts';
import type { ProposalInput } from '../services/proposalGenerator.ts';
import type { ScopePlan } from '../backend/models/index.ts';

const INPUT: ProposalInput = {
  kind: 'extended',
  service_category: 'Protección de datos',
  description: 'Preparar un marco de gobernanza de IA y una política de uso de IA para una fintech.',
  hours_recommended: 30, hours_min: 24, hours_max: 40,
  fee_recommended: 7500, fee_min: 6000, fee_max: 10000,
  rate_used: 250, confidence_level: 'medium',
};

const PLAN: ScopePlan = {
  assumptions_included: ['Diagnóstico del marco de gobernanza de IA existente', 'Redacción de la política de uso de IA'],
  assumptions_excluded: ['La implementación técnica de los controles en los sistemas'],
  assumptions_client: ['Facilitar el inventario de sistemas de IA y la documentación interna'],
  legal_framework: {
    laws: ['Ley Orgánica 3/2018 (LOPDGDD)'],
    regulations: ['Reglamento (UE) 2024/1689 (Reglamento de IA)', 'Reglamento (UE) 2016/679 (RGPD)'],
    standards: ['ISO/IEC 42001'],
    best_practices: ['Directrices del Comité Europeo de Protección de Datos'],
  },
  phases: [
    {
      name: 'Diagnóstico', objective: 'Evaluar el estado actual de la gobernanza de IA',
      tasks: ['Inventariar los sistemas de IA', 'Analizar los riesgos y las brechas'],
      documents_reviewed: ['Políticas internas vigentes'], documents_produced: ['Informe de diagnóstico'],
      estimated_hours: 12, deliverables: ['Informe de brechas'],
    },
    {
      name: 'Diseño del marco', objective: 'Diseñar el modelo de gobernanza y redactar las políticas',
      tasks: ['Redactar la política de uso de IA', 'Definir el modelo de gobernanza'],
      documents_reviewed: [], documents_produced: ['Política de uso de IA'],
      estimated_hours: 18, deliverables: ['Marco de gobernanza de IA', 'Política de uso de IA'],
    },
  ],
  deliverables: ['Marco de gobernanza de IA', 'Política de uso de IA', 'Informe de diagnóstico'],
  team: ['Socio/a responsable', 'Asociado/a senior'],
  total_hours: 30,
  generated_by: 'claude-opus-4-8 (test)',
};

function findSection(prop: ReturnType<typeof generateProposal>, needle: string) {
  return prop.sections.find((s) => s.heading.includes(needle));
}

test('con plan: inserta Premisas, Marco jurídico y Plan de trabajo por fases', () => {
  const prop = generateProposal(INPUT, PLAN);

  const premisas = findSection(prop, 'Premisas y alcance del encargo');
  assert.ok(premisas, 'debe existir la sección de Premisas');
  assert.match(premisas!.body, /Se incluye en el presente encargo/);
  assert.match(premisas!.body, /A cargo del Cliente/);

  const marco = findSection(prop, 'Marco jurídico aplicable');
  assert.ok(marco, 'debe existir la sección de Marco jurídico');
  assert.match(marco!.body, /Reglamento de IA/);
  assert.match(marco!.body, /RGPD/);
  assert.match(marco!.body, /ISO\/IEC 42001/);

  const fases = findSection(prop, 'Plan de trabajo y fases');
  assert.ok(fases, 'debe existir la sección de Plan de trabajo');
  assert.match(fases!.body, /Fase 1\. Diagnóstico/);
  assert.match(fases!.body, /12 h estimadas/);
  assert.match(fases!.body, /Fase 2\. Diseño del marco/);
  assert.match(fases!.body, /Marco de gobernanza de IA/);
  assert.match(fases!.body, /30 horas/);
  assert.match(fases!.body, /Equipo asignado/);
});

test('con plan: Objeto es introducción breve y remite a los apartados siguientes', () => {
  const prop = generateProposal(INPUT, PLAN);
  const objeto = findSection(prop, 'Objeto y descripción del servicio');
  assert.ok(objeto, 'debe existir el Objeto');
  assert.match(objeto!.body, /se estructura y ejecutará conforme a las premisas/);
});

test('con plan: se conserva y se añaden cautelas de verificación (IA)', () => {
  const prop = generateProposal(INPUT, PLAN);
  assert.ok(prop.scope_plan, 'debe conservar el plan en scope_plan');
  assert.equal(prop.scope_plan!.generated_by, 'claude-opus-4-8 (test)');
  assert.ok(prop.warnings.some((w) => /Marco jurídico generado por IA/.test(w)),
    'debe advertir de verificar el marco jurídico');
  assert.ok(prop.assumptions.some((a) => /redactado automáticamente/.test(a)),
    'debe indicar que el alcance se redactó con IA');
});

test('sin plan: comportamiento determinista intacto (no hay secciones de plan)', () => {
  const prop = generateProposal(INPUT);
  assert.equal(prop.scope_plan, null);
  assert.equal(findSection(prop, 'Plan de trabajo y fases'), undefined);
  assert.equal(findSection(prop, 'Marco jurídico aplicable'), undefined);
  // El Objeto vuelve a listar actuaciones (o el marcador), no la introducción breve.
  const objeto = findSection(prop, 'Objeto y descripción del servicio');
  assert.ok(objeto);
  assert.doesNotMatch(objeto!.body, /se estructura y ejecutará conforme a las premisas/);
});
