/**
 * index.ts — despachador de la API. Mapea los segmentos de /api/* al handler de
 * dominio correspondiente. NO contiene lógica de negocio: sólo enrutado.
 */

import { handleDocuments } from './documents.ts';
import { handleRecords } from './records.ts';
import { handleCategories } from './categories.ts';
import { handleFormulas, handleApprovedFormulas } from './formulas.ts';
import { handleCalculate, handleCalculations } from './calculations.ts';
import { handleDashboard } from './dashboard.ts';
import { handleConfig } from './config.ts';
import { handleReferences } from './references.ts';
import { handleImport } from './imports.ts';
import { handleEstimateCase } from './describe.ts';
import { handleBreakdowns } from './breakdowns.ts';
import { ok, notFound } from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

/**
 * Resuelve un RouteContext a un RouteResult. Devuelve 404 JSON si no hay ruta.
 */
export async function dispatch(ctx: RouteContext): Promise<RouteResult> {
  const domain = ctx.segments[0];

  switch (domain) {
    case 'health':
      return ok({ status: 'ok', service: 'calculadora-honorarios', time: new Date().toISOString() });

    case 'config':
      return handleConfig(ctx);

    case 'dashboard':
      return handleDashboard(ctx);

    case 'documents':
      return handleDocuments(ctx);

    case 'records':
      return handleRecords(ctx);

    case 'categories':
      return handleCategories(ctx);

    case 'formulas':
      return handleFormulas(ctx);

    case 'approved-formulas':
      return handleApprovedFormulas(ctx);

    case 'calculate':
      return handleCalculate(ctx);

    case 'calculations':
      return handleCalculations(ctx);

    case 'references':
      return handleReferences(ctx);

    case 'import':
      return handleImport(ctx);

    case 'estimate-case':
      return handleEstimateCase(ctx);

    case 'breakdowns':
      return handleBreakdowns(ctx);

    default:
      return notFound(`Ruta /api/${ctx.segments.join('/')} no encontrada.`);
  }
}
