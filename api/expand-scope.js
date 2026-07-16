/**
 * Vercel Serverless Function — POST /api/expand-scope
 *
 * Expande un resumen breve del encargo en un PLAN DE TRABAJO estructurado
 * (premisas, marco jurídico, fases) llamando a Claude (claude-opus-4-8) con
 * salida estructurada. Permite que la versión web (estática) de la calculadora
 * use la expansión por IA sin exponer la clave: la ANTHROPIC_API_KEY vive SÓLO
 * como variable de entorno de Vercel (server-side), nunca en el bundle del cliente.
 *
 * Confidencialidad: el cliente sólo envía el "tipo de trabajo" (descripción + área),
 * nunca nombre/CIF del Cliente. Active Zero Data Retention (ZDR) en la organización.
 *
 * Robusto: si no hay clave, o la llamada falla, o el JSON es inválido, devuelve
 * { plan: null } con 200 para que la web genere la propuesta en modo determinista.
 * NUNCA fija honorarios: el modelo sólo distribuye las horas dadas (regla 12).
 */

const MODEL = 'claude-opus-4-8';

// Vercel: permite hasta 60 s de ejecución (la llamada a Claude puede tardar).
export const maxDuration = 60;

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
  required: ['assumptions_included', 'assumptions_excluded', 'assumptions_client', 'legal_framework', 'phases', 'deliverables', 'team', 'total_hours'],
  properties: {
    assumptions_included: { type: 'array', items: { type: 'string' } },
    assumptions_excluded: { type: 'array', items: { type: 'string' } },
    assumptions_client: { type: 'array', items: { type: 'string' } },
    legal_framework: {
      type: 'object', additionalProperties: false,
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
        type: 'object', additionalProperties: false,
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

function phaseGuidance(kind) {
  if (kind === 'reduced') return 'entre 2 y 3 fases';
  if (kind === 'extended') return 'entre 4 y 6 fases';
  return 'entre 3 y 4 fases';
}

function buildUserPrompt(input) {
  const horas = input.hoursRecommended != null ? `${input.hoursRecommended} horas` : 'no facilitado';
  const rango = (input.hoursMin != null && input.hoursMax != null) ? `${input.hoursMin}–${input.hoursMax} horas` : 'no facilitado';
  const desc = (input.description && String(input.description).trim())
    ? String(input.description).trim()
    : '[el abogado no ha facilitado descripción; infiere un alcance razonable para el área indicada y márcalo como orientativo]';
  return [
    `Área/servicio: ${input.serviceLabel || '[no facilitada]'}`,
    `Formato de la propuesta: ${input.kind || 'intermediate'} (usa ${phaseGuidance(input.kind)}).`,
    `Total de horas estimadas a distribuir entre las fases: ${horas} (rango ${rango}). total_hours = este total.`,
    '',
    'Resumen del encargo redactado por el abogado:',
    desc,
    '',
    'Devuelve el plan de trabajo estructurado conforme al esquema. No incluyas importes en euros.',
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.trim()) {
    res.status(200).json({ plan: null, reason: 'no_key' });
    return;
  }
  let input = req.body;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
  input = input || {};

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[expand-scope] anthropic', r.status, t.slice(0, 300));
      res.status(200).json({ plan: null, reason: `api_${r.status}` });
      return;
    }
    const j = await r.json();
    if (j.stop_reason === 'refusal') { res.status(200).json({ plan: null, reason: 'refusal' }); return; }
    const tb = (j.content || []).find((b) => b && b.type === 'text' && typeof b.text === 'string');
    if (!tb) { res.status(200).json({ plan: null, reason: 'no_text' }); return; }
    let parsed;
    try { parsed = JSON.parse(tb.text); } catch { res.status(200).json({ plan: null, reason: 'bad_json' }); return; }
    if (!parsed || !Array.isArray(parsed.phases) || parsed.phases.length === 0) {
      res.status(200).json({ plan: null, reason: 'empty_plan' });
      return;
    }
    parsed.generated_by = MODEL;
    res.status(200).json({ plan: parsed });
  } catch (e) {
    console.error('[expand-scope]', e && e.message ? e.message : e);
    res.status(200).json({ plan: null, reason: 'error' });
  }
}
