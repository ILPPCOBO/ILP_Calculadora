/* Pantalla 8 — Historial.
   GET /api/calculations en tabla: fecha, servicio, horas, tarifa usada, mín,
   recomendado, máx, fórmula, usuario (Regla 17). Marca tarifa base. */

import {
  api, esc, dash, money, fmtDate, confidenceBadge, errorState,
  emptyState, loadingState, toast, BASE_HOURLY_RATE,
} from '/app.js';

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Historial completo de cálculos guardados (Regla 17). Cada fila indica qué fórmula se usó y si se aplicó la tarifa base.</p>
    </div>
    <div class="card">
      <div class="flex between center mb-8">
        <h2 class="card-title mb-0">Cálculos</h2>
        <button class="btn btn-sm" id="btn-refresh">Actualizar</button>
      </div>
      <div id="hist-box">${loadingState()}</div>
    </div>
    <div class="card mt-16" id="detail-card" style="display:none;">
      <h2 class="card-title">Detalle del cálculo</h2>
      <div id="detail-box"></div>
    </div>
  `;

  view.querySelector('#btn-refresh').addEventListener('click', () => load(view));
  await load(view);
}

async function load(view) {
  const box = view.querySelector('#hist-box');
  let calcs;
  try { calcs = await api.listCalculations(); }
  catch (err) { box.innerHTML = errorState(err); return; }
  if (!calcs || calcs.length === 0) { box.innerHTML = emptyState('Todavía no hay cálculos guardados.', '↻'); return; }

  // Mapa calcId -> id del desglose de actuaciones asociado (si existe).
  const brkByCalc = new Map();
  try {
    const brks = await api.listBreakdowns();
    (brks || []).forEach((b) => { if (b.case_or_calculation_id) brkByCalc.set(b.case_or_calculation_id, b.id); });
  } catch { /* sin desgloses: la columna mostrará "—" */ }

  // Orden descendente por fecha.
  const sorted = [...calcs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const rows = sorted.map((c) => {
    const usedBase = c.selected_formula_id == null;
    const rate = c.hourly_rate != null ? c.hourly_rate : (c.base_hourly_rate ?? BASE_HOURLY_RATE);
    const brkId = brkByCalc.get(c.id);
    const brkCell = brkId
      ? `<a href="#/planned-actions?id=${encodeURIComponent(brkId)}" class="pill pill-gold" title="Ver desglose">Sí ↗</a>`
      : '<span class="muted">—</span>';
    return `<tr data-calc="${esc(c.id)}" style="cursor:pointer;">
      <td class="nowrap small">${fmtDate(c.created_at)}</td>
      <td>${esc(c.service_category || '—')}${c.service_subcategory ? ` <span class="muted">/ ${esc(c.service_subcategory)}</span>` : ''}</td>
      <td class="num">${c.estimated_hours ?? '<span class="muted">—</span>'}</td>
      <td class="num">${money(rate, c.currency)}${usedBase ? ' <span class="pill pill-gold">base</span>' : ''}</td>
      <td class="num">${money(c.calculated_min, c.currency)}</td>
      <td class="num"><strong>${money(c.calculated_recommended, c.currency)}</strong></td>
      <td class="num">${money(c.calculated_max, c.currency)}</td>
      <td>${usedBase ? '<span class="pill pill-gold">Tarifa base</span>' : `<span class="small mono">${dash(c.selected_formula_id)}</span>`}</td>
      <td class="center">${brkCell}</td>
      <td class="small">${dash(c.created_by)}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr>
      <th>Fecha</th><th>Servicio</th><th class="num">Horas</th><th class="num">Tarifa usada</th>
      <th class="num">Mín</th><th class="num">Recomendado</th><th class="num">Máx</th><th>Fórmula</th><th>Desglose</th><th>Usuario</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  box.querySelectorAll('tr[data-calc]').forEach((tr) =>
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return; // no abrir detalle si se pulsa el enlace al desglose
      const c = sorted.find((x) => x.id === tr.dataset.calc);
      if (c) showDetail(view, c);
    }));
}

function showDetail(view, c) {
  const card = view.querySelector('#detail-card');
  const box = view.querySelector('#detail-box');
  card.style.display = '';
  const usedBase = c.selected_formula_id == null;
  const comparables = c.comparable_record_ids || [];

  box.innerHTML = `
    <dl class="kv mb-16">
      <dt>ID</dt><dd class="mono small">${esc(c.id)}</dd>
      <dt>Fecha</dt><dd>${fmtDate(c.created_at)}</dd>
      <dt>Servicio</dt><dd>${esc(c.service_category)}${c.service_subcategory ? ' / ' + esc(c.service_subcategory) : ''}</dd>
      <dt>Confianza</dt><dd>${confidenceBadge(c.confidence_level)}</dd>
      <dt>Fórmula</dt><dd>${usedBase ? '<span class="pill pill-gold">Tarifa base</span>' : `<span class="mono small">${esc(c.selected_formula_id)}</span>`}</dd>
      <dt>Rango</dt><dd>${money(c.calculated_min, c.currency)} · <strong>${money(c.calculated_recommended, c.currency)}</strong> · ${money(c.calculated_max, c.currency)}</dd>
    </dl>
    <h3>Explicación</h3>
    <p class="small">${esc(c.explanation || '—')}</p>
    ${c.warnings && c.warnings.length ? `<div class="alert alert-warn"><span>⚠</span><div><ul>${c.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>` : ''}
    <h3 class="mt-16">Registros comparables</h3>
    ${comparables.length ? `<div class="tag-list">${comparables.map((id) => `<span class="pill pill-muted mono">${esc(id)}</span>`).join('')}</div>` : '<p class="small muted">Sin registros comparables.</p>'}
  `;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
