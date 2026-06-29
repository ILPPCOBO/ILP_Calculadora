/**
 * Ruta /api/dashboard — conteos agregados + tarifa base actual (R2).
 *
 * Sólo orquesta repositorios y config. Devuelve los conteos en el formato que
 * el frontend (frontend/pages/dashboard.js) sabe leer, incluyendo el campo
 * obligatorio `base_hourly_rate` proveniente de la config efectiva (que parte de
 * BASE_HOURLY_RATE = 250).
 */

import {
  documentsRepo, recordsRepo, categoriesRepo, formulasRepo,
  approvedFormulasRepo, calculationsRepo,
} from '../storage/index.ts';
import { loadConfig, BASE_HOURLY_RATE } from '../config/factors.ts';
import { ok, badRequest } from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

export async function handleDashboard(ctx: RouteContext): Promise<RouteResult> {
  if (ctx.method !== 'GET') return badRequest('Use GET en /api/dashboard.');

  const cfg = loadConfig();
  const records = recordsRepo.list();
  const formulas = formulasRepo.list();
  const calculations = calculationsRepo.list();

  const pendingRecords = records.filter((r) => r.review_status === 'pending_review').length;
  const approvedRecords = records.filter((r) => r.review_status === 'approved').length;
  const rejectedRecords = records.filter((r) => r.review_status === 'rejected').length;

  const pendingFormulas = formulas.filter((f) => f.review_status === 'pending_review').length;
  const approvedFormulas = approvedFormulasRepo.list().filter((f) => f.review_status === 'approved').length;

  const recent = [...calculations]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 8);

  return ok({
    // Regla 2: tarifa base actual (config efectiva, parte de 250).
    base_hourly_rate: cfg.base_hourly_rate ?? BASE_HOURLY_RATE,
    currency: cfg.currency,

    documents: documentsRepo.list().length,
    records: records.length,
    pending_records: pendingRecords,
    approved_records: approvedRecords,
    rejected_records: rejectedRecords,
    categories: categoriesRepo.list().length,
    pending_formulas: pendingFormulas,
    approved_formulas: approvedFormulas,
    calculations: calculations.length,

    recent_calculations: recent,
  });
}
