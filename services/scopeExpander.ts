/**
 * scopeExpander — expande un resumen breve del encargo en un PLAN DE TRABAJO
 * estructurado (premisas, marco jurídico, fases con tareas/documentos/horas/
 * entregables) mediante Claude (claude-opus-4-8) con salida estructurada.
 *
 * Principios (alineados con las reglas del proyecto):
 *  - El LLM SÓLO redacta el alcance/plan. NUNCA fija ni inventa honorarios: recibe
 *    las horas recomendadas de la calculadora y las DISTRIBUYE entre las fases
 *    (regla 12). Los importes y las cláusulas jurídicas se generan de forma
 *    determinista en proposalGenerator.ts.
 *  - Confidencialidad: sólo se envía el "tipo de trabajo" (descripción + área),
 *    nunca el nombre/CIF del Cliente (esos se rellenan localmente como marcadores).
 *  - Si no hay ANTHROPIC_API_KEY, o el SDK no está instalado, o la llamada falla,
 *    devuelve null y el generador continúa en modo determinista (sin romper nada).
 *  - Todo el resultado es un BORRADOR: el marco jurídico debe verificarlo el letrado.
 */

import type { ProposalKind, ScopePlan } from '../backend/models/index.ts';

export interface ScopeExpanderInput {
  description: string | null;      // resumen del encargo redactado por el abogado
  serviceLabel: string;            // área/servicio (de la calculadora)
  kind: ProposalKind;              // reduced | intermediate | extended (controla profundidad)
  currency: string;
  hoursRecommended: number | null; // total a distribuir entre fases
  hoursMin: number | null;
  hoursMax: number | null;
  feeMin: number | null;           // sólo contexto; el LLM no repite importes
  feeRecommended: number | null;
  feeMax: number | null;
  model?: string;                  // por defecto claude-opus-4-8
}

const DEFAULT_MODEL = 'claude-opus-4-8';

/** ¿Está disponible la expansión por IA? (hay clave de API configurada). */
export function scopeExpansionEnabled(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === 'string'
    && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

/** Nº de fases orientativo según el formato. */
function phaseGuidance(kind: ProposalKind): string {
  if (kind === 'reduced') return 'entre 2 y 3 fases';
  if (kind === 'extended') return 'entre 4 y 6 fases';
  return 'entre 3 y 4 fases';
}

const SYSTEM_PROMPT = [
  'Eres el redactor de la sección de ALCANCE Y PLAN DE TRABAJO de las hojas de encargo (propuestas de honorarios) de ILP Abogados, un despacho español.',
  'A partir de un resumen breve del encargo, elaboras un plan de proyecto detallado y específico para ese asunto, no genérico.',
  '',
  'REGLAS ESTRICTAS:',
  '1. Redacta SIEMPRE en español de España, registro jurídico profesional, claro y concreto.',
  '2. NO fijas ni inventas honorarios ni importes en euros. Recibes un total de horas estimadas y lo DISTRIBUYES entre las fases, de modo que la suma de estimated_hours de las fases sea aproximadamente igual a ese total. total_hours debe ser ese total.',
  '3. Marco jurídico aplicable: cita normativa española y de la UE REAL y pertinente al asunto (p. ej., RGPD 2016/679 y LO 3/2018; Ley 10/2010 de blanqueo; Reglamento (UE) 2023/1114 MiCA; Reglamento (UE) 2024/1689 de IA; Estatuto General de la Abogacía RD 135/2021; etc.). Es una relación ORIENTATIVA que el letrado verificará: no inventes números de artículo de los que no estés seguro; en la duda, nombra el instrumento sin citar el artículo.',
  '4. Fases: usa un número de fases acorde al formato indicado. Cada fase debe tener objetivo, actuaciones concretas (verbos de acción), documentos que se revisarán, documentos que se elaborarán, horas estimadas y entregables.',
  '5. Premisas: separa lo que INCLUYE el encargo, lo que queda EXCLUIDO salvo pacto, y lo que corre a cargo del CLIENTE (colaboración/insumos).',
  '6. Equipo: indica perfiles genéricos (socio/a, asociado/a senior, asociado/a), sin nombres de personas.',
  '7. No redactes cláusulas jurídicas (honorarios, responsabilidad, confidencialidad, jurisdicción, etc.): eso se genera aparte. Céntrate exclusivamente en el alcance y el plan de trabajo.',
  '8. Sé específico del asunto descrito y evita relleno. No repitas literalmente el resumen del abogado.',
].join('\n');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'assumptions_included', 'assumptions_excluded', 'assumptions_client',
    'legal_framework', 'phases', 'deliverables', 'team', 'total_hours',
  ],
  properties: {
    assumptions_included: { type: 'array', items: { type: 'string' } },
    assumptions_excluded: { type: 'array', items: { type: 'string' } },
    assumptions_client: { type: 'array', items: { type: 'string' } },
    legal_framework: {
      type: 'object',
      additionalProperties: false,
      required: ['laws', 'regulations', 'standards', 'best_practices'],
      properties: {
        laws: { type: 'array', items: { type: 'string' } },
        regulations: { type: 'array', items: { type: 'string' } },
        standards: { type: 'array', items: { type: 'string' } },
        best_practices: { type: 'array', items: { type: 'string' } },
      },
    },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'objective', 'tasks', 'documents_reviewed', 'documents_produced', 'estimated_hours', 'deliverables'],
        properties: {
          name: { type: 'string' },
          objective: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' } },
          documents_reviewed: { type: 'array', items: { type: 'string' } },
          documents_produced: { type: 'array', items: { type: 'string' } },
          estimated_hours: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          deliverables: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    deliverables: { type: 'array', items: { type: 'string' } },
    team: { type: 'array', items: { type: 'string' } },
    total_hours: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
};

function buildUserPrompt(input: ScopeExpanderInput): string {
  const horas = input.hoursRecommended != null ? `${input.hoursRecommended} horas` : 'no facilitado';
  const rango = (input.hoursMin != null && input.hoursMax != null)
    ? `${input.hoursMin}–${input.hoursMax} horas` : 'no facilitado';
  return [
    `Área/servicio: ${input.serviceLabel}`,
    `Formato de la propuesta: ${input.kind} (usa ${phaseGuidance(input.kind)}).`,
    `Total de horas estimadas a distribuir entre las fases: ${horas} (rango ${rango}). total_hours = este total.`,
    '',
    'Resumen del encargo redactado por el abogado:',
    (input.description && input.description.trim()) ? input.description.trim() : '[el abogado no ha facilitado descripción; infiere un alcance razonable para el área indicada y márcalo como orientativo]',
    '',
    'Devuelve el plan de trabajo estructurado conforme al esquema. No incluyas importes en euros.',
  ].join('\n');
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0);
}
function asNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Valida/normaliza defensivamente la respuesta del modelo. Devuelve null si no es utilizable. */
function normalizePlan(raw: unknown, model: string, fallbackHours: number | null): ScopePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const lf = (o.legal_framework && typeof o.legal_framework === 'object')
    ? o.legal_framework as Record<string, unknown> : {};
  const phasesRaw = Array.isArray(o.phases) ? o.phases : [];
  const phases = phasesRaw
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const pp = p as Record<string, unknown>;
      const objective = typeof pp.objective === 'string' ? pp.objective.trim() : '';
      if (!objective) return null;
      return {
        name: typeof pp.name === 'string' && pp.name.trim() ? pp.name.trim() : null,
        objective,
        tasks: asStringArray(pp.tasks),
        documents_reviewed: asStringArray(pp.documents_reviewed),
        documents_produced: asStringArray(pp.documents_produced),
        estimated_hours: asNumOrNull(pp.estimated_hours),
        deliverables: asStringArray(pp.deliverables),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (phases.length === 0) return null; // sin fases no aporta nada -> fallback determinista

  return {
    assumptions_included: asStringArray(o.assumptions_included),
    assumptions_excluded: asStringArray(o.assumptions_excluded),
    assumptions_client: asStringArray(o.assumptions_client),
    legal_framework: {
      laws: asStringArray(lf.laws),
      regulations: asStringArray(lf.regulations),
      standards: asStringArray(lf.standards),
      best_practices: asStringArray(lf.best_practices),
    },
    phases,
    deliverables: asStringArray(o.deliverables),
    team: asStringArray(o.team),
    total_hours: asNumOrNull(o.total_hours) ?? fallbackHours,
    generated_by: model,
  };
}

/**
 * Llama a Claude para expandir el alcance. Devuelve el plan estructurado o null.
 * Nunca lanza: cualquier fallo (sin clave, sin SDK, error de red, JSON inválido)
 * se registra y se resuelve como null para que la propuesta se genere igualmente.
 */
export async function expandScope(input: ScopeExpanderInput): Promise<ScopePlan | null> {
  if (!scopeExpansionEnabled()) return null;
  const model = (input.model && input.model.trim()) || DEFAULT_MODEL;
  try {
    // Carga perezosa: el SDK sólo se requiere cuando hay clave y se usa la función.
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = (mod as { default: new (opts?: unknown) => unknown }).default;
    const client = new Anthropic() as {
      messages: { create: (args: unknown) => Promise<unknown> };
    };

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    }) as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };

    if (response.stop_reason === 'refusal') {
      console.warn('[scopeExpander] la solicitud fue rechazada por seguridad; se usa el modo determinista.');
      return null;
    }
    const textBlock = (response.content || []).find((b) => b && b.type === 'text' && typeof b.text === 'string');
    if (!textBlock || !textBlock.text) return null;
    const parsed = JSON.parse(textBlock.text) as unknown;
    return normalizePlan(parsed, model, input.hoursRecommended);
  } catch (err) {
    console.warn('[scopeExpander] no se pudo expandir el alcance con IA; se usa el modo determinista:',
      err instanceof Error ? err.message : String(err));
    return null;
  }
}
