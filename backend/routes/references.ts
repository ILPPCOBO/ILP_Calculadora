/**
 * Ruta /api/references — biblioteca de referencias de precios (R3/R10).
 *
 *  - GET /api/references                         -> lista de referencias (por área y subárea)
 *  - GET /api/references?category=X[&subcategory=Y] -> referencia concreta de un área
 *
 * Orquesta services/referencePricing.ts. No reimplementa lógica.
 */

import { buildReference, listReferences } from '../../services/referencePricing.ts';
import { ok, badRequest } from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

export async function handleReferences(ctx: RouteContext): Promise<RouteResult> {
  if (ctx.method !== 'GET') return badRequest('Use GET en /api/references.');

  const category = ctx.query.get('category');
  if (category && category.trim() !== '') {
    const subcategory = ctx.query.get('subcategory');
    return ok(buildReference(category.trim(), subcategory && subcategory.trim() !== '' ? subcategory.trim() : null));
  }

  return ok(listReferences());
}
