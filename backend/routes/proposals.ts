/**
 * Rutas /api/proposals — "Generar propuesta de honorarios".
 *
 *  POST   /api/proposals                  -> generar desde una estimación/cálculo
 *  GET    /api/proposals                  -> listar (?calculation_id= filtra)
 *  GET    /api/proposals/:id              -> detalle
 *  PUT    /api/proposals/:id              -> editar (secciones, partes, cifras…)
 *  DELETE /api/proposals/:id              -> eliminar
 *  POST   /api/proposals/:id/export-word  -> genera .docx (base64 en JSON)
 *
 * Orquesta los servicios; no reimplementa lógica de negocio.
 */

import {
  createProposal, getProposal, listProposals, updateProposal, deleteProposal,
  findProposalsByCalculation,
} from '../../services/proposalGenerator.ts';
import type { ProposalInput, ProposalPartyInput } from '../../services/proposalGenerator.ts';
import { saveProposalDocx } from '../../services/wordProposalExporter.ts';
import { expandScope } from '../../services/scopeExpander.ts';
import { PROPOSAL_KIND_VALUES } from '../models/index.ts';
import type { ProposalKind, ConfidenceLevel, FeeProposal } from '../models/index.ts';
import {
  ok, created, badRequest, notFound, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === 'string').map((x) => (x as string));
}

function partyInput(value: unknown): ProposalPartyInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const s = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  return {
    name: s('name'), legal_form: s('legal_form'), tax_id: s('tax_id'),
    address: s('address'), representative: s('representative'),
  };
}

export async function handleProposals(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, query, body } = ctx;
  const id = segments[1];
  const action = segments[2];

  // ---- POST /api/proposals ----
  if (method === 'POST' && !id) {
    const o = asObject(body);
    const category = str(o, 'service_category');
    if (!category || category.trim() === '') {
      return badRequest('Falta "service_category" para generar la propuesta.');
    }
    const kindRaw = str(o, 'kind') ?? 'intermediate';
    const kind: ProposalKind = (PROPOSAL_KIND_VALUES as string[]).includes(kindRaw)
      ? (kindRaw as ProposalKind) : 'intermediate';
    const confRaw = str(o, 'confidence_level');
    const confidence: ConfidenceLevel | null = confRaw === 'high' || confRaw === 'medium' || confRaw === 'low'
      ? (confRaw as ConfidenceLevel) : null;

    const input: ProposalInput = {
      kind,
      case_or_calculation_id: str(o, 'case_or_calculation_id') ?? str(o, 'calculation_id'),
      breakdown_id: str(o, 'breakdown_id'),
      service_category: category.trim(),
      service_subcategory: str(o, 'service_subcategory'),
      title: str(o, 'title'),
      reference: str(o, 'reference'),
      date: str(o, 'date'),
      confidential: typeof o.confidential === 'boolean' ? (o.confidential as boolean) : undefined,
      firm: partyInput(o.firm),
      client: partyInput(o.client),
      currency: str(o, 'currency'),
      rate_used: numOrNull(o.rate_used),
      hours_min: numOrNull(o.hours_min),
      hours_recommended: numOrNull(o.hours_recommended),
      hours_max: numOrNull(o.hours_max),
      fee_min: numOrNull(o.fee_min),
      fee_recommended: numOrNull(o.fee_recommended),
      fee_max: numOrNull(o.fee_max),
      confidence_level: confidence,
      vat_included: typeof o.vat_included === 'boolean' ? (o.vat_included as boolean) : undefined,
      expenses_included: typeof o.expenses_included === 'boolean' ? (o.expenses_included as boolean) : undefined,
      validity_days: numOrNull(o.validity_days),
      description: str(o, 'description'),
      tasks: strArray(o.tasks),
      included_elements: strArray(o.included_elements),
      excluded_services: strArray(o.excluded_services),
      billing_terms: str(o, 'billing_terms'),
    };
    const createdBy = str(o, 'created_by') ?? str(o, 'createdBy') ?? 'usuario_interno';
    // Expande el alcance con IA (sólo si hay ANTHROPIC_API_KEY). Si no hay clave o
    // falla, plan = null y la propuesta se genera en modo determinista. Nunca bloquea.
    const useAi = o.ai_scope !== false;
    const plan = useAi
      ? await expandScope({
          description: input.description ?? null,
          serviceLabel: input.service_subcategory
            ? `${input.service_category} / ${input.service_subcategory}`
            : input.service_category,
          kind,
          currency: input.currency ?? 'EUR',
          hoursRecommended: input.hours_recommended ?? null,
          hoursMin: input.hours_min ?? null,
          hoursMax: input.hours_max ?? null,
          feeMin: input.fee_min ?? null,
          feeRecommended: input.fee_recommended ?? null,
          feeMax: input.fee_max ?? null,
        })
      : null;
    const prop = createProposal(input, createdBy, plan);
    return created(prop);
  }

  // ---- GET /api/proposals ----
  if (method === 'GET' && !id) {
    const calcId = query.get('calculation_id');
    if (calcId) return ok(findProposalsByCalculation(calcId));
    return ok(listProposals());
  }

  // ---- GET /api/proposals/:id ----
  if (method === 'GET' && id && !action) {
    const prop = getProposal(id);
    if (!prop) return notFound(`Propuesta "${id}" no encontrada.`);
    return ok(prop);
  }

  // ---- PUT /api/proposals/:id ----
  if (method === 'PUT' && id && !action) {
    const patch = asObject(body) as Partial<FeeProposal>;
    const updated = updateProposal(id, patch);
    if (!updated) return notFound(`Propuesta "${id}" no encontrada.`);
    return ok(updated);
  }

  // ---- DELETE /api/proposals/:id ----
  if (method === 'DELETE' && id && !action) {
    const okDel = deleteProposal(id);
    if (!okDel) return notFound(`Propuesta "${id}" no encontrada.`);
    return ok({ deleted: true, id });
  }

  // ---- POST /api/proposals/:id/export-word ----
  if (method === 'POST' && id && action === 'export-word') {
    const prop = getProposal(id);
    if (!prop) return notFound(`Propuesta "${id}" no encontrada.`);
    const o = asObject(body);
    const generatedBy = str(o, 'generated_by') ?? str(o, 'generatedBy') ?? 'usuario_interno';
    const firmName = str(o, 'firm_name') ?? str(o, 'firmName');
    const { record, buffer } = saveProposalDocx(prop, generatedBy, { firmName });
    return ok({
      record,
      file_name: record.file_name,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_base64: buffer.toString('base64'),
    });
  }

  return badRequest(`Operación no soportada en /api/proposals (${method} ${segments.join('/')}).`);
}
