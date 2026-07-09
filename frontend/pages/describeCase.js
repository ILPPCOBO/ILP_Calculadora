/* Pantalla inicial — Describir caso.
   El usuario describe el trabajo en lenguaje natural (sin introducir horas).
   La herramienta detecta el servicio, identifica tareas, busca trabajos
   históricos aprobados, estima horas (mín/rec/máx) y calcula honorarios con la
   tarifa base 250 €/h (o personalizada) + factores. Reglas 1, 2, 11, 12, 17. */

import {
  api, esc, money, dash, confidenceBadge, warningsBlock, errorState, toast, BASE_HOURLY_RATE,
} from '/app.js';

const AREAS = [
  'No estoy seguro', 'Asesoramiento corporativo', 'Marcas', 'Propiedad intelectual',
  'Contratos mercantiles', 'Constitución de sociedades', 'Compliance', 'Protección de datos',
  'Litigios', 'Due diligence', 'Consultoría regulatoria', 'Laboral', 'Fiscal',
  'Revisión documental', 'Redacción de informes', 'Otros',
];
const URGENCY = [['normal', 'Normal'], ['urgent', 'Urgente'], ['very_urgent', 'Muy urgente'], ['unknown', 'No estoy seguro']];
const COMPLEXITY = [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['unknown', 'No estoy seguro']];

const PLACEHOLDER = 'Ejemplo: El cliente necesita revisar un contrato de distribución internacional, '
  + 'preparar comentarios, participar en una reunión de negociación y entregar una versión revisada del documento.';

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Describe brevemente el trabajo que se va a realizar. La herramienta analizará el alcance, identificará el tipo de servicio, estimará las horas normalmente necesarias y calculará un honorario sugerido usando la tarifa base de ${esc(BASE_HOURLY_RATE)} €/hora, salvo que exista una tarifa específica aplicable.</p>
    </div>

    <div class="grid grid-2">
      <div class="card" style="align-self:start;">
        <h2 class="card-title">Describe el caso o propuesta</h2>
        <div class="field">
          <label for="c-desc">Descripción del trabajo</label>
          <textarea id="c-desc" rows="7" placeholder="${esc(PLACEHOLDER)}"></textarea>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="c-area">Área de servicio <span class="muted">(opcional)</span></label>
            <select id="c-area">${AREAS.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="c-urg">Nivel de urgencia <span class="muted">(opcional)</span></label>
            <select id="c-urg">${URGENCY.map(([v, l]) => `<option value="${v}" ${v === 'normal' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="c-cplx">Nivel de complejidad <span class="muted">(opcional)</span></label>
            <select id="c-cplx">${COMPLEXITY.map(([v, l]) => `<option value="${v}" ${v === 'medium' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="c-rate">Tarifa por hora personalizada <span class="muted">(opcional)</span></label>
            <input type="number" min="0" step="1" id="c-rate" placeholder="Vacío = ${esc(BASE_HOURLY_RATE)} € base">
            <span class="hint">Si lo dejas vacío se usa la tarifa base de ${esc(BASE_HOURLY_RATE)} €/hora.</span>
          </div>
        </div>
        <div class="btn-row mt-8">
          <button class="btn btn-primary" id="btn-estimate">Estimar horas y honorarios</button>
        </div>
      </div>

      <div class="card" id="result-card">
        <h2 class="card-title">Estimación</h2>
        <div id="estimate-result"><p class="muted">Describe el caso y pulsa “Estimar horas y honorarios”.</p></div>
      </div>
    </div>
  `;

  view.querySelector('#btn-estimate').addEventListener('click', () => estimate(view));
}

async function estimate(view) {
  const description = view.querySelector('#c-desc').value.trim();
  if (!description) { toast('Describe el trabajo antes de estimar.', 'warn'); return; }

  const area = view.querySelector('#c-area').value;
  const rateRaw = view.querySelector('#c-rate').value.trim();
  const payload = {
    description,
    area: area === 'No estoy seguro' ? null : area,
    urgency: view.querySelector('#c-urg').value,
    complexity: view.querySelector('#c-cplx').value,
    hourly_rate: rateRaw === '' ? null : Number(rateRaw),
    created_by: 'usuario_interno',
  };

  const btn = view.querySelector('#btn-estimate'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Estimando…';
  const box = view.querySelector('#estimate-result');
  box.innerHTML = '<div class="loading-state"><span class="spinner"></span><div>Analizando la descripción…</div></div>';

  try {
    const res = await api.estimateCase(payload);
    renderEstimate(box, res);
  } catch (err) {
    box.innerHTML = errorState(err);
    toast(err.message, 'error', 'Error');
  } finally { btn.textContent = t; btn.disabled = false; }
}

/** Cuadro de criterios de valoración + honorarios de referencia de la materia. */
function criteriaBlock(e, cur) {
  const c = e.valuation_criteria;
  if (!c) return '';
  const fmtAmount = (f) => {
    if (f.model === 'a_cuenta' && f.percentage != null) return `${esc(f.percentage)}%`;
    if (f.amount == null) return dash(null);
    return `${money(f.amount, cur)}${f.vat_excluded ? ' <span class="muted">+ IVA</span>' : ''}`;
  };
  const rows = (c.reference_fees || []).map((f) => `
    <tr>
      <td class="small">${esc(f.phase)}</td>
      <td class="small">${esc(f.concept)}${f.note ? `<br><span class="muted">${esc(f.note)}</span>` : ''}</td>
      <td class="small mono">${esc(f.unit)}</td>
      <td class="small" style="text-align:right">${fmtAmount(f)}</td>
    </tr>`).join('');
  const criterios = (c.criteria || []).map((k) => `
    <li><strong>${esc(k.label)}.</strong> <span class="small muted">${esc(k.detail)}</span></li>`).join('');
  const legal = (c.legal_basis || []).map((l) => `<li>${esc(l)}</li>`).join('');
  const notes = (c.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');

  return `
    <div class="card" style="margin-top:16px;border-left:3px solid var(--gold,#c8a24c);">
      <h3 style="margin-top:0">Criterios de valoración de la materia</h3>
      <p class="small muted">${esc(c.title)} — ${esc(c.summary)}</p>
      <p class="small">Esta materia se estructura por criterios propios (no solo por horas). El rango
        por horas de arriba es orientativo; el cuadro siguiente es la <strong>referencia de honorarios</strong>
        de una propuesta real anonimizada (revisable, Regla 1).</p>

      <h4 class="mt-8">Criterios que aplica</h4>
      <ul class="small">${criterios}</ul>

      <h4 class="mt-8">Cuadro de honorarios de referencia</h4>
      <div style="overflow-x:auto">
        <table class="table small">
          <thead><tr><th>Fase</th><th>Concepto</th><th>Unidad</th><th style="text-align:right">Referencia</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <h4 class="mt-8">Base jurídica</h4>
      <ul class="small muted">${legal}</ul>
      ${notes ? `<ul class="small muted">${notes}</ul>` : ''}
      <p class="small muted">Fuente: <span class="mono">${esc(c.source)}</span></p>
    </div>`;
}

function renderEstimate(box, e) {
  if (e.needs_more_info) {
    box.innerHTML = `
      <div class="alert alert-warn"><span>⚠</span><div>
        <strong>Necesito más detalle para estimar.</strong>
        <ul>${(e.missing_info || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
        ${e.explanation ? `<p class="small">${esc(e.explanation)}</p>` : ''}
      </div></div>`;
    return;
  }

  const cur = e.currency || 'EUR';
  const tareas = (e.tasks || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const comparables = e.comparable_records || [];
  const factores = [
    `Complejidad <strong>${esc(e.complexity_level)}</strong> (×${esc(e.complexity_factor)})`,
    `Urgencia <strong>${esc(e.urgency_level)}</strong> (×${esc(e.urgency_factor)})`,
    e.discount_factor !== 1 ? `Descuento (×${esc(e.discount_factor)})` : null,
  ].filter(Boolean).join(' · ');

  box.innerHTML = `
    <div class="alert alert-info"><span>ℹ</span><div>Honorario <strong>sugerido</strong>, no obligatorio (Regla 1).</div></div>

    <dl class="kv mb-16">
      <dt>Servicio detectado</dt>
      <dd>${esc(e.service_detected)}${e.service_subcategory ? ` <span class="muted">/ ${esc(e.service_subcategory)}</span>` : ''} ${confidenceBadge(e.classification_confidence)}</dd>
      <dt>Alcance entendido</dt><dd>${esc(e.scope_summary)}</dd>
    </dl>

    <h3>Tareas identificadas</h3>
    ${tareas ? `<ul class="task-list">${tareas}</ul>` : '<p class="small muted">No se identificaron tareas concretas.</p>'}

    <h3 class="mt-16">Horas estimadas</h3>
    <div class="range-cards">
      <div class="range-card"><div class="rc-label">Mínimo</div><div class="rc-value">${esc(e.hours_min)} h</div></div>
      <div class="range-card rec"><div class="rc-label">Recomendado</div><div class="rc-value">${esc(e.hours_recommended)} h</div></div>
      <div class="range-card"><div class="rc-label">Máximo</div><div class="rc-value">${esc(e.hours_max)} h</div></div>
    </div>

    <h3 class="mt-16">Honorarios sugeridos</h3>
    <div class="range-cards">
      <div class="range-card"><div class="rc-label">Mínimo</div><div class="rc-value">${money(e.fee_min, cur)}</div></div>
      <div class="range-card rec"><div class="rc-label">Recomendado</div><div class="rc-value">${money(e.fee_recommended, cur)}</div></div>
      <div class="range-card"><div class="rc-label">Máximo</div><div class="rc-value">${money(e.fee_max, cur)}</div></div>
    </div>

    <dl class="kv mt-16 mb-16">
      <dt>Tarifa usada</dt>
      <dd>${e.used_base_rate
        ? `${esc(e.rate_used)} €/hora <span class="pill pill-gold">tarifa base</span>`
        : `${esc(e.rate_used)} €/hora <span class="pill pill-info">personalizada</span>`}</dd>
      <dt>Factores aplicados</dt><dd>${factores}</dd>
      <dt>Confianza</dt><dd>${confidenceBadge(e.confidence_level)}</dd>
    </dl>

    ${criteriaBlock(e, cur)}

    <h3>Trabajos históricos comparables</h3>
    ${comparables.length
      ? `<p class="small muted">${comparables.length} trabajo(s) aprobado(s) del área:</p><div class="tag-list">${comparables.map((id) => `<span class="pill pill-muted mono">${esc(id)}</span>`).join('')}</div>`
      : '<p class="small muted">Sin trabajos históricos aprobados comparables en esta área (no se inventan, Regla 12).</p>'}

    ${(e.missing_info && e.missing_info.length) ? `<h3 class="mt-16">Información a confirmar</h3><ul class="small muted">${e.missing_info.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}

    <h3 class="mt-16">Explicación del cálculo</h3>
    <p class="small">${esc(e.explanation)}</p>
    ${warningsBlock(e.warnings)}

    <div class="btn-row mt-16">
      <button class="btn" id="btn-breakdown">Generar desglose de actuaciones previstas</button>
    </div>
  `;

  const bd = box.querySelector('#btn-breakdown');
  if (bd) bd.addEventListener('click', () => generateBreakdownFromEstimate(bd, e));
}

/** Crea un desglose de actuaciones asociado a esta estimación y abre la pantalla. */
async function generateBreakdownFromEstimate(btn, e) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const desc = document.getElementById('c-desc')?.value?.trim() || null;
    const brk = await api.createBreakdown({
      source_type: 'automatic_estimate',
      case_or_calculation_id: e.calculation_id || null,
      service_category: e.service_detected,
      service_subcategory: e.service_subcategory || null,
      description: desc,
      tasks: e.tasks || [],
      estimated_total_hours: e.hours_recommended,
      estimated_total_fee: e.fee_recommended,
      currency: e.currency,
      rate_used: e.rate_used,
      complexity_level: e.complexity_level,
      urgency_level: e.urgency_level,
      comparable_records: e.comparable_records || [],
      created_by: 'usuario_interno',
    });
    toast('Desglose generado.', 'ok');
    location.hash = `#/planned-actions?id=${encodeURIComponent(brk.id)}`;
  } catch (err) {
    toast(err.message, 'error', 'Error');
    btn.textContent = t; btn.disabled = false;
  }
}
