/* Pantalla 5 — Generar fórmulas.
   Selecciona categoría/subcategoría, muestra registros APROBADOS, botón
   Generar (POST /api/formulas/generate), muestra explicación/assumptions; la
   fórmula queda en pending_review (Reglas 6, 12) y se envía a revisión. */

import {
  api, esc, dash, money, confidenceBadge, errorState, emptyState,
  loadingState, toast,
} from '/app.js';

const FORMULA_TYPES = [['hourly', 'Por horas'], ['fixed_range', 'Rango fijo'], ['blended', 'Mixta'], ['monthly', 'Mensual'], ['custom', 'Personalizada']];

let categories = [];

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Genera una fórmula de honorarios a partir de los registros <strong>aprobados</strong> de una categoría (Regla 3). La fórmula se crea en estado <strong>pendiente de revisión</strong> (Regla 6): nunca se aprueba automáticamente.</p>
    </div>
    <div class="card">
      <h2 class="card-title">Parámetros</h2>
      <div class="form-grid">
        <div class="field"><label>Categoría</label><select id="g-cat"><option value="">Cargando…</option></select></div>
        <div class="field"><label>Subcategoría</label><select id="g-sub"><option value="">(toda la categoría)</option></select></div>
        <div class="field"><label>Tipo de fórmula</label><select id="g-type">${FORMULA_TYPES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row mt-8">
        <button class="btn" id="btn-load-records">Ver registros aprobados</button>
        <button class="btn btn-primary" id="btn-generate" disabled>Generar fórmula</button>
      </div>
    </div>

    <div class="card mt-16">
      <h2 class="card-title">Registros aprobados comparables</h2>
      <div id="rec-preview">${emptyState('Selecciona una categoría y pulsa “Ver registros aprobados”.', '∑')}</div>
    </div>

    <div class="card mt-16" id="gen-result-card" style="display:none;">
      <h2 class="card-title">Fórmula generada (pendiente de revisión)</h2>
      <div id="gen-result"></div>
    </div>
  `;

  const catSel = view.querySelector('#g-cat');
  const subSel = view.querySelector('#g-sub');

  try {
    categories = await api.listCategories();
    catSel.innerHTML = `<option value="">— Elige categoría —</option>` +
      categories.filter((c) => c.active !== false)
        .map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  } catch (err) {
    catSel.innerHTML = `<option value="">(error al cargar)</option>`;
    toast(err.message, 'error', 'Error');
  }

  catSel.addEventListener('change', () => {
    const cat = categories.find((c) => c.name === catSel.value);
    subSel.innerHTML = `<option value="">(toda la categoría)</option>` +
      ((cat?.subcategories) || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    view.querySelector('#btn-generate').disabled = !catSel.value;
  });

  view.querySelector('#btn-load-records').addEventListener('click', () => loadApprovedRecords(view));
  view.querySelector('#btn-generate').addEventListener('click', () => generate(view));
}

async function loadApprovedRecords(view) {
  const cat = view.querySelector('#g-cat').value;
  const sub = view.querySelector('#g-sub').value;
  const box = view.querySelector('#rec-preview');
  if (!cat) { box.innerHTML = emptyState('Primero elige una categoría.', '∑'); return; }
  box.innerHTML = loadingState();

  let records;
  try { records = await api.listRecords('approved'); }
  catch (err) { box.innerHTML = errorState(err); return; }

  let filtered = (records || []).filter((r) => r.service_category === cat);
  if (sub) filtered = filtered.filter((r) => r.service_subcategory === sub);

  if (filtered.length === 0) {
    box.innerHTML = `<div class="alert alert-warn"><span>⚠</span><div>No hay registros aprobados para
      <strong>${esc(cat)}${sub ? ' / ' + esc(sub) : ''}</strong>. La fórmula podría basarse en la tarifa base con confianza baja (Regla 11).</div></div>`;
    return;
  }

  const rows = filtered.map((r) => `<tr>
    <td>${dash(r.client_name)}</td>
    <td>${dash(r.service_subcategory)}</td>
    <td class="num">${money(r.total_fee, r.currency || 'EUR')}</td>
    <td class="num">${r.hours_worked ?? '<span class="muted">—</span>'}</td>
    <td class="num">${r.hourly_rate ?? '<span class="muted">—</span>'}</td>
    <td class="small mono">${esc(r.id)}</td>
  </tr>`).join('');

  box.innerHTML = `<p class="small muted">${filtered.length} registro(s) aprobado(s) alimentarán la fórmula.</p>
    <div class="table-wrap"><table class="data">
    <thead><tr><th>Cliente</th><th>Subservicio</th><th class="num">Importe</th><th class="num">Horas</th><th class="num">Tarifa</th><th>ID</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function generate(view) {
  const cat = view.querySelector('#g-cat').value;
  if (!cat) { toast('Elige una categoría.', 'warn'); return; }
  const btn = view.querySelector('#btn-generate'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';

  const input = {
    service_category: cat,
    service_subcategory: view.querySelector('#g-sub').value || null,
    formula_type: view.querySelector('#g-type').value,
    created_by: 'usuario_interno',
  };

  try {
    const f = await api.generateFormula(input);
    renderResult(view, f);
    toast('Fórmula generada en estado pendiente de revisión.', 'ok', 'Generada');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  } finally { btn.textContent = t; btn.disabled = false; }
}

function renderResult(view, f) {
  const card = view.querySelector('#gen-result-card');
  const box = view.querySelector('#gen-result');
  card.style.display = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const vars = (f.variables || []).map((v) => `<li><span class="mono">${esc(v.name)}</span>: ${esc(v.description)}${v.default !== undefined && v.default !== null ? ` <span class="muted">(def: ${esc(v.default)})</span>` : ''}</li>`).join('');
  const assumptions = (f.assumptions || []).map((a) => `<li>${esc(a)}</li>`).join('');
  const basedOn = (f.based_on_record_ids || []);

  box.innerHTML = `
    <dl class="kv mb-16">
      <dt>Nombre</dt><dd>${dash(f.formula_name)}</dd>
      <dt>Categoría</dt><dd>${esc(f.service_category)}${f.service_subcategory ? ' / ' + esc(f.service_subcategory) : ''}</dd>
      <dt>Tipo</dt><dd>${esc(f.formula_type)}</dd>
      <dt>Estado</dt><dd><span class="pill pill-pending">Pendiente de revisión</span></dd>
      <dt>Confianza</dt><dd>${confidenceBadge(f.confidence_level)}</dd>
      <dt>Rango sugerido</dt><dd>${money(f.recommended_min, f.currency)} · <strong>${money(f.recommended_base, f.currency)}</strong> · ${money(f.recommended_max, f.currency)}</dd>
      <dt>Basada en</dt><dd>${basedOn.length} registro(s) aprobado(s)${basedOn.length ? `: <span class="small mono">${basedOn.map(esc).join(', ')}</span>` : ' <span class="muted">(usa tarifa base — Regla 11)</span>'}</dd>
    </dl>

    <h3>Expresión</h3>
    <div class="code-box">${esc(f.formula_expression || '—')}</div>

    <h3 class="mt-16">Variables</h3>
    <ul class="small">${vars || '<li class="muted">Sin variables</li>'}</ul>

    <h3 class="mt-16">Supuestos (assumptions)</h3>
    <ul class="small">${assumptions || '<li class="muted">Sin supuestos declarados</li>'}</ul>

    <div class="alert alert-info mt-16"><span>ℹ</span><div>La fórmula se ha guardado en estado <strong>pendiente de revisión</strong>. Para usarla en la calculadora, apruébala en <a href="#/formulas-review">Revisar fórmulas</a>.</div></div>
  `;
}
