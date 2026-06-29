/* Pantalla — Referencias de precios.
   Biblioteca de benchmarks construidos a partir de los acuerdos históricos
   APROBADOS (Regla 3): por cada área/subárea, rango P25–mediana–P75, tarifa/hora
   típica, distribución de tipo de fee y trazabilidad. Estos valores son los que la
   calculadora adjunta a cada cálculo. Sólo datos aprobados; nada inventado (R12). */

import {
  api, esc, dash, money, confidenceBadge, errorState,
  emptyState, loadingState, toast,
} from '/app.js';

let categories = [];

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Referencias de precios derivadas de los <strong>acuerdos históricos aprobados</strong> (Regla 3). Son el respaldo que la calculadora usa como contexto. Sólo cuentan registros <em>aprobados</em>; lo no validado no aparece.</p>
    </div>

    <div class="card">
      <h2 class="card-title">Consultar referencia de un área</h2>
      <div class="form-grid">
        <div class="field"><label>Categoría</label><select id="r-cat"><option value="">Cargando…</option></select></div>
        <div class="field"><label>Subcategoría (opcional)</label><select id="r-sub"><option value="">(toda la categoría)</option></select></div>
      </div>
      <div class="btn-row mt-8"><button class="btn btn-primary" id="btn-lookup">Ver referencia</button></div>
      <div id="ref-single" class="mt-16"></div>
    </div>

    <div class="card mt-16">
      <div class="flex between center mb-8">
        <h2 class="card-title mb-0">Biblioteca de referencias</h2>
        <button class="btn btn-sm" id="btn-refresh">Actualizar</button>
      </div>
      <div id="ref-library">${loadingState()}</div>
    </div>
  `;

  const catSel = view.querySelector('#r-cat');
  const subSel = view.querySelector('#r-sub');
  try {
    categories = await api.listCategories();
    catSel.innerHTML = `<option value="">— Elige categoría —</option>` +
      categories.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  } catch (err) {
    catSel.innerHTML = `<option value="">(error al cargar)</option>`;
    toast(`No se pudieron cargar las categorías: ${err.message}`, 'error', 'Error');
  }

  catSel.addEventListener('change', () => {
    const cat = categories.find((c) => c.name === catSel.value);
    subSel.innerHTML = `<option value="">(toda la categoría)</option>` +
      ((cat?.subcategories) || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  });

  view.querySelector('#btn-lookup').addEventListener('click', () => lookup(view));
  view.querySelector('#btn-refresh').addEventListener('click', () => loadLibrary(view));
  await loadLibrary(view);
}

async function lookup(view) {
  const cat = view.querySelector('#r-cat').value;
  const sub = view.querySelector('#r-sub').value || null;
  const box = view.querySelector('#ref-single');
  if (!cat) { toast('Elige una categoría.', 'warn'); return; }
  box.innerHTML = loadingState('Consultando…');
  try {
    const ref = await api.getReference(cat, sub);
    box.innerHTML = referenceCard(ref, true);
  } catch (err) {
    box.innerHTML = errorState(err);
  }
}

async function loadLibrary(view) {
  const box = view.querySelector('#ref-library');
  box.innerHTML = loadingState();
  let refs;
  try { refs = await api.listReferences(); }
  catch (err) { box.innerHTML = errorState(err); return; }
  if (!refs || refs.length === 0) {
    box.innerHTML = emptyState('Aún no hay referencias: aprueba acuerdos históricos para construirlas.', '❖');
    return;
  }
  // Tabla resumen + tarjeta por fila al pulsar.
  const rows = refs.map((r, i) => {
    const area = `${esc(r.service_category)}${r.service_subcategory ? ` <span class="muted">/ ${esc(r.service_subcategory)}</span>` : ' <span class="pill pill-muted">área completa</span>'}`;
    return `<tr data-ref="${i}" style="cursor:pointer;">
      <td>${area}</td>
      <td class="num">${esc(r.sample_size)}</td>
      <td class="num">${money(r.fee_p25, r.currency)}</td>
      <td class="num"><strong>${money(r.fee_median, r.currency)}</strong></td>
      <td class="num">${money(r.fee_p75, r.currency)}</td>
      <td class="num">${r.hourly_rate_median != null ? money(r.hourly_rate_median, r.currency) : '<span class="muted">—</span>'}</td>
      <td>${confidenceBadge(r.confidence_level)}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr>
      <th>Área / subárea</th><th class="num">Acuerdos</th><th class="num">P25</th>
      <th class="num">Mediana</th><th class="num">P75</th><th class="num">Tarifa/h</th><th>Confianza</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div id="ref-detail" class="mt-16"></div>`;

  box.querySelectorAll('tr[data-ref]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const r = refs[Number(tr.dataset.ref)];
      const detail = box.querySelector('#ref-detail');
      detail.innerHTML = referenceCard(r, false);
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
}

/** Tarjeta detallada de una referencia. */
function referenceCard(ref, framed) {
  const cur = ref.currency || 'EUR';
  const title = `${esc(ref.service_category)}${ref.service_subcategory ? ' / ' + esc(ref.service_subcategory) : ' (área completa)'}`;

  if (!ref.sample_size || ref.sample_size === 0) {
    return `<div class="${framed ? 'card-inset' : ''}">
      <h3>${title}</h3>
      <div class="alert alert-warn"><span>⚠</span><div>${esc(ref.note || 'Información insuficiente.')}</div></div>
    </div>`;
  }

  const hourly = ref.hourly_rate_median != null
    ? `<dt>Tarifa/hora típica</dt><dd>${money(ref.hourly_rate_median, cur)}/hora <span class="small muted">(mediana de ${ref.hourly_sample_size}; media ${money(ref.hourly_rate_average, cur)})</span></dd>`
    : '';
  const dist = ref.fee_type_distribution && Object.keys(ref.fee_type_distribution).length
    ? `<dt>Tipos de fee</dt><dd>${Object.entries(ref.fee_type_distribution).map(([k, n]) => `<span class="pill pill-muted">${esc(k)}: ${n}</span>`).join(' ')}</dd>`
    : '';
  const ids = (ref.based_on_record_ids || []);

  return `<div class="${framed ? 'card-inset' : ''}">
    <h3>${title} ${confidenceBadge(ref.confidence_level)}</h3>
    <p class="small">${esc(ref.note)}</p>
    <div class="range-cards">
      <div class="range-card"><div class="rc-label">P25</div><div class="rc-value">${money(ref.fee_p25, cur)}</div></div>
      <div class="range-card rec"><div class="rc-label">Mediana</div><div class="rc-value">${money(ref.fee_median, cur)}</div></div>
      <div class="range-card"><div class="rc-label">P75</div><div class="rc-value">${money(ref.fee_p75, cur)}</div></div>
    </div>
    <dl class="kv mt-8">
      <dt>Acuerdos con importe</dt><dd>${esc(ref.sample_size)} de ${esc(ref.records_considered)} aprobados</dd>
      <dt>Rango (mín / media / máx)</dt><dd>${money(ref.fee_min, cur)} · ${money(ref.fee_average, cur)} · ${money(ref.fee_max, cur)}</dd>
      ${hourly}
      ${dist}
      <dt>Periodo</dt><dd class="small">${dash(ref.date_from)} → ${dash(ref.date_to)}</dd>
    </dl>
    <h4 class="mt-8">Acuerdos que la respaldan (Regla 18)</h4>
    ${ids.length ? `<div class="tag-list">${ids.map((id) => `<span class="pill pill-muted mono">${esc(id)}</span>`).join('')}</div>` : '<p class="small muted">—</p>'}
  </div>`;
}
