/* Tests de proposalGenerator + wordProposalExporter — "Generar propuesta".
   Aislamiento: ids reales prop_ (no empiezan por "_") + limpieza. NUNCA repo.clear(). */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  generateProposal, createProposal, getProposal, listProposals, updateProposal, deleteProposal,
} from '../services/proposalGenerator.ts';
import type { ProposalInput } from '../services/proposalGenerator.ts';
import { exportProposalDocx, saveProposalDocx } from '../services/wordProposalExporter.ts';
import { DATA_ROOT, proposalDocsRepo } from '../backend/storage/index.ts';

const created: string[] = [];
const cleanupFiles: string[] = [];
const cleanupDocs: string[] = [];
after(() => {
  for (const id of created) deleteProposal(id);
  for (const id of cleanupDocs) proposalDocsRepo.delete(id);
  for (const f of cleanupFiles) { try { if (existsSync(f)) rmSync(f); } catch { /* noop */ } }
});

function baseInput(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    service_category: 'Asesoramiento corporativo',
    service_subcategory: null,
    description: 'Defensa de un socio minoritario en un conflicto societario con la mayoría.',
    tasks: ['Revisar la documentación societaria', 'Preparar la impugnación de acuerdos sociales'],
    currency: 'EUR', rate_used: 250,
    hours_min: 8, hours_recommended: 16, hours_max: 35,
    fee_min: 2000, fee_recommended: 4000, fee_max: 8750,
    confidence_level: 'low',
    ...over,
  };
}

test('generateProposal (intermedia): estructura básica + cifras heredadas, no inventadas', () => {
  const p = generateProposal(baseInput({ kind: 'intermediate' }));
  assert.equal(p.kind, 'intermediate');
  assert.equal(p.id.startsWith('prop_'), true);
  const keys = p.sections.map((s) => s.key);
  for (const k of ['destinatario', 'apertura', 'objeto', 'equipo', 'honorarios', 'devengo', 'gastos', 'limitacion', 'condiciones', 'aceptacion']) {
    assert.ok(keys.includes(k), `falta la sección "${k}"`);
  }
  const hon = p.sections.find((s) => s.key === 'honorarios')!;
  assert.ok(hon.body.includes('4.000'), 'el honorario recomendado (4.000) aparece en el cuerpo');
  assert.ok(hon.body.includes('IVA y gastos no incluidos'), 'advierte que no incluye IVA ni gastos (Regla 9)');
  // Términos definidos en negrita, como en las propuestas reales.
  const apertura = p.sections.find((s) => s.key === 'apertura')!;
  assert.ok(/\*\*«Propuesta»\*\*/.test(apertura.body), 'define «Propuesta» en negrita');
});

test('generateProposal: sin importe => marcador [●], nunca inventa (Regla 12)', () => {
  const p = generateProposal(baseInput({ fee_recommended: null, fee_min: null, fee_max: null }));
  const hon = p.sections.find((s) => s.key === 'honorarios')!;
  assert.ok(hon.body.includes('[●]'), 'usa el marcador [●] cuando falta el importe');
  assert.ok(p.missing_information.some((m) => /honorarios/i.test(m)), 'lista el importe como dato pendiente');
});

test('generateProposal: sin cliente => lo marca como información pendiente', () => {
  const p = generateProposal(baseInput());
  assert.ok(p.missing_information.some((m) => /Cliente/i.test(m)), 'el cliente ausente se marca pendiente');
  // La firma por defecto es ILP Abogados (no es un dato de cliente inventado).
  assert.equal(p.firm.name, 'ILP Abogados');
  assert.equal(p.client.name, null);
});

test('marcadores nominales: se rellenan automáticamente con los datos de la propuesta', () => {
  const p = createProposal(baseInput(), 'tester');
  created.push(p.id);
  // Sin cliente/referencia/validez: el cuerpo muestra los marcadores nominales.
  const aperturaBefore = getProposal(p.id).sections.find((s) => s.key === 'apertura').body;
  assert.ok(aperturaBefore.includes('[cliente]'), 'el marcador [cliente] está presente antes de rellenar');

  const upd = updateProposal(p.id, {
    client: { name: 'Bodega Ejemplo, S.L.', representative: 'Ana López' },
    reference: 'REF-2026-001', validity_days: 30,
  });
  const apertura = upd.sections.find((s) => s.key === 'apertura').body;
  assert.ok(apertura.includes('Bodega Ejemplo, S.L.'), 'el nombre del cliente reemplaza al marcador');
  assert.ok(!apertura.includes('[cliente]'), 'el marcador [cliente] ya no aparece tras rellenar');
  assert.ok(apertura.includes('Ana López'), 'el representante rellena el saludo (Estimado/a …)');

  const cond = upd.sections.find((s) => s.key === 'condiciones').body;
  assert.ok(/30 días/.test(cond), 'la validez rellena el marcador en condiciones');
  const dest = upd.sections.find((s) => s.key === 'destinatario').body;
  assert.ok(dest.includes('REF-2026-001'), 'la referencia (N/ref.) rellena el marcador');
  // Al rellenar, deja de figurar como pendiente.
  assert.ok(!upd.missing_information.some((m) => /Referencia/i.test(m)), 'la referencia ya no está pendiente');
});

test('generateProposal (extendida): añade secciones de dossier', () => {
  const p = generateProposal(baseInput({ kind: 'extended' }));
  assert.equal(p.kind, 'extended');
  const keys = p.sections.map((s) => s.key);
  for (const k of ['presentacion', 'metodologia', 'credenciales', 'premisas', 'cronograma', 'anexo_economico']) {
    assert.ok(keys.includes(k), `la extendida debe incluir "${k}"`);
  }
  // Sigue conteniendo el núcleo económico y de aceptación.
  assert.ok(keys.includes('honorarios') && keys.includes('aceptacion'));
});

test('los tres formatos crecen en detalle: reducida < intermedia < extendida', () => {
  const r = generateProposal(baseInput({ kind: 'reduced' })).sections.length;
  const i = generateProposal(baseInput({ kind: 'intermediate' })).sections.length;
  const e = generateProposal(baseInput({ kind: 'extended' })).sections.length;
  assert.ok(r < i && i < e, `esperaba reducida(${r}) < intermedia(${i}) < extendida(${e})`);
});

test('Limitación de responsabilidad presente en TODOS los formatos, limitada a honorarios percibidos', () => {
  for (const kind of ['reduced', 'intermediate', 'extended'] as const) {
    const p = generateProposal(baseInput({ kind }));
    const lim = p.sections.find((s) => s.key === 'limitacion');
    assert.ok(lim, `falta la cláusula de limitación de responsabilidad en "${kind}"`);
    assert.ok(
      /honorarios efectivamente percibidos/i.test(lim!.body),
      `la limitación debe ceñirse a los honorarios efectivamente percibidos (${kind})`,
    );
  }
});

test('cláusulas jurídicas necesarias presentes (intermedia)', () => {
  const p = generateProposal(baseInput({ kind: 'intermediate' }));
  const keys = p.sections.map((s) => s.key);
  for (const k of ['costas', 'limitacion', 'confidencialidad', 'blanqueo', 'propiedad_intelectual', 'custodia', 'terminacion', 'deontologia', 'jurisdiccion', 'condiciones']) {
    assert.ok(keys.includes(k), `falta la cláusula "${k}"`);
  }
  // La extendida añade "Sobre el Despacho".
  const ext = generateProposal(baseInput({ kind: 'extended' }));
  assert.ok(ext.sections.some((s) => s.key === 'sobre_despacho'), 'la extendida incluye "Sobre el Despacho"');
});

test('lenguaje contractual español requerido presente (EGAE / CGC)', () => {
  const all = generateProposal(baseInput({ kind: 'intermediate' })).sections.map((s) => s.body).join('\n');
  const must = [
    /Estatuto General de la Abogac/i,          // EGAE (art. 48)
    /provisión de fondos/i,
    /30% de los honorarios/i,                   // provisión mínima
    /quince \(15\) días/i,                      // pago / preaviso
    /revisión o impugnación de la minuta|revisión de la minuta/i,
    /desistir del encargo/i,                    // derecho de desistimiento
    /costas/i,                                  // costas
    /blanqueo de capitales/i,                   // Ley 10/2010
    /cinco \(5\) años/i,                        // custodia/destrucción
    /IVA/i,
    /honorarios efectivamente percibidos/i,     // limitación de responsabilidad (requisito del cliente)
  ];
  for (const re of must) {
    assert.ok(re.test(all), `falta lenguaje contractual requerido: ${re}`);
  }
});

test('milestones automáticos: "licencia CASP" genera el trámite MiCA ante la CNMV', () => {
  const p = generateProposal({
    kind: 'intermediate', service_category: 'Regulatorio financiero',
    description: 'Licencia CASP para una startup de criptoactivos.',
    currency: 'EUR', rate_used: 250, hours_recommended: 40, fee_recommended: 10000,
  });
  const objeto = p.sections.find((s) => s.key === 'objeto')!.body;
  assert.ok(/CNMV/.test(objeto), 'el objeto incluye la solicitud ante la CNMV');
  assert.ok(/MiCA/i.test(objeto), 'el objeto referencia MiCA');
  assert.ok(p.included_elements.length >= 5, 'genera varios hitos del trámite');
  assert.ok(p.assumptions.some((a) => /plantilla del trámite/i.test(a)), 'advierte que los hitos son de plantilla');
});

test('low confidence => warning de cifras orientativas (Regla 1)', () => {
  const p = generateProposal(baseInput({ confidence_level: 'low' }));
  assert.ok(p.warnings.some((w) => /orientativas|confianza baja/i.test(w)));
  assert.ok(p.warnings.some((w) => /borrador|revís/i.test(w)));
});

test('exportProposalDocx: genera un .docx (ZIP válido) con el contenido esperado', () => {
  const p = generateProposal(baseInput());
  const { fileName, buffer } = exportProposalDocx(p, { firmName: 'ILP Abogados' });
  assert.ok(fileName.endsWith('.docx'));
  assert.equal(buffer[0], 0x50); assert.equal(buffer[1], 0x4b);            // "PK\x03\x04"
  assert.ok(buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'falta el EOCD del ZIP');
  const xml = buffer.toString('utf8');
  assert.ok(xml.includes('ABOGADOS'), 'membrete ILP ABOGADOS');
  assert.ok(/Arial/.test(xml), 'fuente Arial (mimetiza la carta)');
  assert.ok(/P[áa]g\./.test(xml), 'pie de página con número de página');
  assert.ok(xml.includes('Honorarios profesionales'));
  assert.ok(xml.includes('Gastos, suplidos e impuestos'));
  assert.ok(xml.includes('4.000'), 'el importe aparece en el documento');
});

test('CRUD: createProposal persiste y aparece en la lista; getProposal lo recupera', () => {
  const p = createProposal(baseInput(), 'tester');
  created.push(p.id);
  assert.ok(getProposal(p.id) !== null, 'la propuesta está en el repositorio');
  assert.ok(listProposals().some((x) => x.id === p.id), 'aparece en el listado');
});

test('updateProposal: editar título y una sección se persiste', () => {
  const p = createProposal(baseInput(), 'tester');
  created.push(p.id);
  const editedSections = p.sections.map((s) => (s.key === 'objeto' ? { ...s, body: 'OBJETO EDITADO POR EL USUARIO' } : s));
  const upd = updateProposal(p.id, { title: 'Propuesta revisada', sections: editedSections });
  assert.ok(upd);
  const reloaded = getProposal(p.id)!;
  assert.equal(reloaded.title, 'Propuesta revisada');
  assert.equal(reloaded.sections.find((s) => s.key === 'objeto')!.body, 'OBJETO EDITADO POR EL USUARIO');
});

test('frontend: la pantalla "Propuesta de honorarios" está registrada en nav y router', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
  const appjs = readFileSync(join(root, 'frontend', 'app.js'), 'utf8');
  assert.ok(html.includes('data-route="proposals"'), 'falta el enlace de nav a proposals');
  assert.ok(appjs.includes("proposals:"), 'falta la ruta proposals en el router');
  assert.ok(appjs.includes('createProposal'), 'falta el método createProposal en el cliente API');
});

test('saveProposalDocx: escribe el archivo y registra el ExportedProposalDocument', () => {
  const p = createProposal(baseInput(), 'tester');
  created.push(p.id);
  const { record, buffer } = saveProposalDocx(p, 'tester', { firmName: 'ILP Abogados' });
  cleanupDocs.push(record.id);
  cleanupFiles.push(join(DATA_ROOT, record.file_path));
  assert.equal(record.file_type, 'docx');
  assert.equal(record.id.startsWith('exp_'), true);
  assert.equal(record.proposal_id, p.id);
  assert.ok(existsSync(join(DATA_ROOT, record.file_path)), 'el .docx existe en disco');
  assert.ok(proposalDocsRepo.get(record.id) !== null, 'el documento exportado queda registrado');
  assert.ok(buffer.length > 100);
});
