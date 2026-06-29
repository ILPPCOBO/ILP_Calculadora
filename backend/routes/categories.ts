/**
 * Rutas /api/categories — gestión de categorías de servicio (R15, R16).
 *
 * No existe un servicio dedicado de categorías en los cimientos; estas rutas
 * orquestan directamente el repositorio `categoriesRepo` (lectura/escritura de
 * la entidad ServiceCategory), aplicando los valores por defecto de Regla 2
 * (tarifa base 250) cuando faltan.
 *
 *  - GET  /api/categories          -> list
 *  - POST /api/categories          -> crear (nace activa, default_hourly_rate=250 si falta)
 *  - PUT  /api/categories/:id       -> editar (patch; id inmutable)
 */

import { categoriesRepo } from '../storage/index.ts';
import { newId } from '../utils/id.ts';
import { BASE_HOURLY_RATE } from '../config/factors.ts';
import { PRICING_METHOD_VALUES } from '../models/index.ts';
import type { ServiceCategory, PricingMethod } from '../models/index.ts';
import {
  ok, created, badRequest, notFound, asObject, str,
} from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

function normalizeMethod(value: string | null): PricingMethod {
  if (value && (PRICING_METHOD_VALUES as string[]).includes(value)) {
    return value as PricingMethod;
  }
  return 'hourly';
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function handleCategories(ctx: RouteContext): Promise<RouteResult> {
  const { method, segments, body } = ctx;
  const id = segments[1];

  // ---- GET /api/categories ----
  if (method === 'GET' && !id) {
    return ok(categoriesRepo.list());
  }

  // ---- POST /api/categories ----
  if (method === 'POST' && !id) {
    const o = asObject(body);
    const name = str(o, 'name');
    if (!name || name.trim() === '') return badRequest('Falta "name" para la categoría.');

    const cat: ServiceCategory = {
      id: newId('cat'),
      name: name.trim(),
      description: str(o, 'description') ?? '',
      subcategories: toStringArray(o.subcategories),
      default_pricing_method: normalizeMethod(str(o, 'default_pricing_method')),
      default_hourly_rate: toNumber(o.default_hourly_rate, BASE_HOURLY_RATE),
      default_complexity_factor: toNumber(o.default_complexity_factor, 1.0),
      active: typeof o.active === 'boolean' ? o.active : true,
    };
    categoriesRepo.save(cat);
    return created(cat);
  }

  // ---- PUT /api/categories/:id ----
  if (method === 'PUT' && id) {
    const current = categoriesRepo.get(id);
    if (!current) return notFound(`Categoría "${id}" no encontrada.`);
    const o = asObject(body);

    const updated: ServiceCategory = {
      ...current,
      name: str(o, 'name') ?? current.name,
      description: str(o, 'description') ?? current.description,
      subcategories: o.subcategories !== undefined ? toStringArray(o.subcategories) : current.subcategories,
      default_pricing_method: o.default_pricing_method !== undefined
        ? normalizeMethod(str(o, 'default_pricing_method'))
        : current.default_pricing_method,
      default_hourly_rate: toNumber(o.default_hourly_rate, current.default_hourly_rate),
      default_complexity_factor: toNumber(o.default_complexity_factor, current.default_complexity_factor),
      active: typeof o.active === 'boolean' ? o.active : current.active,
      id: current.id, // inmutable
    };
    categoriesRepo.save(updated);
    return ok(updated);
  }

  return badRequest('Operación de categorías no soportada.');
}
