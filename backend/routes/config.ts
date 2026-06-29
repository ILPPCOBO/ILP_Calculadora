/**
 * Rutas /api/config — lectura y ajuste de tarifa base y factores (R16).
 *
 *  - GET /api/config  -> config efectiva (loadConfig: defaults + override de disco)
 *  - PUT /api/config  -> fusiona el patch sobre la config actual y lo persiste en
 *    data/service_categories/_config.json (único override que lee factors.ts).
 *
 * NO reimplementa la lógica de carga: usa loadConfig() de los cimientos. Sólo
 * escribe el archivo de override que esa función ya sabe leer. Validamos números
 * para no romper la config (R12: nada inventado; ante valor inválido conserva el
 * actual).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from '../config/factors.ts';
import type { PricingConfig } from '../config/factors.ts';
import { ok, badRequest, asObject } from './helpers.ts';
import type { RouteContext, RouteResult } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/routes -> ../../data/service_categories/_config.json
const CONFIG_DIR = join(__dirname, '..', '..', 'data', 'service_categories');
const CONFIG_PATH = join(CONFIG_DIR, '_config.json');

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Fusiona un sub-objeto de factores manteniendo las claves no provistas. */
function mergeFactor<T extends Record<string, number>>(current: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return current;
  const p = patch as Record<string, unknown>;
  const out = { ...current } as Record<string, number>;
  for (const key of Object.keys(current)) {
    out[key] = numOr(p[key], current[key]);
  }
  return out as T;
}

export async function handleConfig(ctx: RouteContext): Promise<RouteResult> {
  const { method, body } = ctx;

  if (method === 'GET') {
    return ok(loadConfig());
  }

  if (method === 'PUT') {
    const current = loadConfig();
    const o = asObject(body);

    const next: PricingConfig = {
      base_hourly_rate: numOr(o.base_hourly_rate, current.base_hourly_rate),
      currency: typeof o.currency === 'string' && o.currency.trim() !== ''
        ? o.currency.trim() : current.currency,
      complexity_factor: mergeFactor(current.complexity_factor, o.complexity_factor),
      urgency_factor: mergeFactor(current.urgency_factor, o.urgency_factor),
      range_spread_no_history: numOr(o.range_spread_no_history, current.range_spread_no_history),
    };

    try {
      if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
      return badRequest(`No se pudo persistir la configuración: ${(err as Error).message}`);
    }
    return ok(next);
  }

  return badRequest('Use GET o PUT en /api/config.');
}
