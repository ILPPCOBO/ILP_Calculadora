/**
 * wordBreakdownExporter — genera un .docx profesional del "Desglose de
 * actuaciones previstas".
 *
 * Un .docx es un contenedor ZIP con XML (Open Packaging Conventions). Para
 * mantener el "core sin dependencias", construimos el WordprocessingML a mano y
 * lo empaquetamos con backend/utils/zip.ts (método STORE). El documento se
 * genera en horizontal (landscape) para que la tabla de 8 columnas quepa.
 *
 * El documento incluye (según el encargo):
 *   1. Resumen del mandato
 *   2. Tabla de actuaciones previstas
 *   3. Distribución de aportación de valor
 *   4. Supuestos utilizados
 *   5. Información pendiente o no confirmada
 *   6. Nota final de revisión interna
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipStore } from '../backend/utils/zip.ts';
import { DATA_ROOT, exportedDocsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import type {
  PlannedActionBreakdown, PlannedAction, ExportedBreakdownDocument, ValueLevel,
} from '../backend/models/index.ts';

// Colores de marca ILP (hex sin #).
const NAVY = '102542';
const GOLD = 'A8842F';
const GRAY = '767E8C';
const INK = '1A1F2B';

const COMPLEXITY_ES: Record<string, string> = {
  low: 'Baja', medium: 'Media', high: 'Alta', unknown: 'No determinada',
};
const URGENCY_ES: Record<string, string> = {
  normal: 'Normal', urgent: 'Urgente', very_urgent: 'Muy urgente', unknown: 'No determinada',
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface RunOpts { bold?: boolean; italic?: boolean; color?: string; size?: number; }

/** size en PUNTOS (se convierte a medios-puntos para w:sz). */
function run(text: string, o: RunOpts = {}): string {
  const rpr: string[] = [];
  if (o.bold) rpr.push('<w:b/>');
  if (o.italic) rpr.push('<w:i/>');
  if (o.color) rpr.push(`<w:color w:val="${o.color}"/>`);
  if (o.size) rpr.push(`<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>`);
  const rprXml = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
  return `<w:r>${rprXml}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

interface ParaOpts { style?: string; align?: string; spaceAfter?: number; spaceBefore?: number; }

function para(runsXml: string, o: ParaOpts = {}): string {
  const ppr: string[] = [];
  if (o.style) ppr.push(`<w:pStyle w:val="${o.style}"/>`);
  if (o.align) ppr.push(`<w:jc w:val="${o.align}"/>`);
  if (o.spaceAfter !== undefined || o.spaceBefore !== undefined) {
    ppr.push(`<w:spacing${o.spaceBefore !== undefined ? ` w:before="${o.spaceBefore}"` : ''}${o.spaceAfter !== undefined ? ` w:after="${o.spaceAfter}"` : ''}/>`);
  }
  const pprXml = ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : '';
  return `<w:p>${pprXml}${runsXml}</w:p>`;
}

function heading1(text: string): string {
  return para(run(text, { bold: true, color: NAVY, size: 15 }), { spaceBefore: 240, spaceAfter: 100 });
}

function bullet(text: string): string {
  return para(run('•  ', { color: GOLD, bold: true }) + run(text, { color: INK, size: 10 }), { spaceAfter: 40 });
}

/** Celda de tabla. width en twips. */
function cell(runsXml: string, widthTwips: number, opts: { fill?: string; align?: string } = {}): string {
  const shd = opts.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>` : '';
  const tcPr = `<w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/>${shd}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`;
  const pPr = opts.align ? `<w:pPr><w:jc w:val="${opts.align}"/></w:pPr>` : '';
  return `<w:tc>${tcPr}<w:p>${pPr}${runsXml}</w:p></w:tc>`;
}

const COLS = [520, 2500, 3200, 1500, 3000, 1100, 1480, 1900]; // 8 columnas (landscape)

function valueColor(level: ValueLevel): string {
  return level === 'high' ? NAVY : level === 'medium' ? GOLD : GRAY;
}

function hoursText(a: PlannedAction): string {
  if (a.estimated_hours_recommended === null || a.estimated_hours_recommended === undefined) return '—';
  const min = a.estimated_hours_min ?? a.estimated_hours_recommended;
  const max = a.estimated_hours_max ?? a.estimated_hours_recommended;
  return `${a.estimated_hours_recommended} h (${min}–${max})`;
}

function actionsTable(b: PlannedActionBreakdown): string {
  const headerCells = [
    cell(run('Nº', { bold: true, color: 'FFFFFF', size: 9 }), COLS[0], { fill: NAVY, align: 'center' }),
    cell(run('Actuación prevista', { bold: true, color: 'FFFFFF', size: 9 }), COLS[1], { fill: NAVY }),
    cell(run('Descripción', { bold: true, color: 'FFFFFF', size: 9 }), COLS[2], { fill: NAVY }),
    cell(run('Aportación de valor', { bold: true, color: 'FFFFFF', size: 9 }), COLS[3], { fill: NAVY }),
    cell(run('Motivo', { bold: true, color: 'FFFFFF', size: 9 }), COLS[4], { fill: NAVY }),
    cell(run('Horas estimadas', { bold: true, color: 'FFFFFF', size: 9 }), COLS[5], { fill: NAVY, align: 'center' }),
    cell(run('Perfil responsable', { bold: true, color: 'FFFFFF', size: 9 }), COLS[6], { fill: NAVY }),
    cell(run('Entregable', { bold: true, color: 'FFFFFF', size: 9 }), COLS[7], { fill: NAVY }),
  ].join('');
  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headerCells}</w:tr>`;

  const rows = b.planned_actions.map((a, i) => {
    const fill = i % 2 === 1 ? 'FBFAF6' : undefined;
    const cells = [
      cell(run(String(a.sequence_order || i + 1), { size: 9 }), COLS[0], { fill, align: 'center' }),
      cell(run(a.action_title, { bold: true, color: INK, size: 9 }), COLS[1], { fill }),
      cell(run(a.action_description || '—', { size: 9, color: INK }), COLS[2], { fill }),
      cell(run(a.value_label, { bold: true, color: valueColor(a.value_level), size: 9 }), COLS[3], { fill }),
      cell(run(a.reason_for_value_level || '—', { size: 8, color: GRAY }), COLS[4], { fill }),
      cell(run(hoursText(a), { size: 9 }), COLS[5], { fill, align: 'center' }),
      cell(run(a.responsible_profile || '—', { size: 9 }), COLS[6], { fill }),
      cell(run(a.deliverable || '—', { size: 9 }), COLS[7], { fill }),
    ].join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');

  const grid = COLS.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="E4DDCB"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${rows}</w:tbl>`;
}

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined) return '—';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

function fmtDateEs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export interface ExportOptions { firmName?: string | null; generatedBy?: string | null; }

/** Construye el WordprocessingML completo del documento. */
function buildDocumentXml(b: PlannedActionBreakdown, opts: ExportOptions): string {
  const firm = (opts.firmName || 'ILP Abogados').trim();
  const cur = b.currency || 'EUR';
  const dist = b.value_distribution;

  const body: string[] = [];

  // --- Encabezado ---
  body.push(para(run('Desglose de actuaciones previstas', { bold: true, color: NAVY, size: 22 }), { align: 'center', spaceAfter: 60 }));
  body.push(para(run(`Mandato: ${b.mandate_summary}`, { italic: true, color: GRAY, size: 11 }), { align: 'center', spaceAfter: 40 }));
  body.push(para(
    run(`${firm}`, { color: GOLD, bold: true, size: 10 })
    + run(`   ·   Generado el ${fmtDateEs(b.created_at)}`, { color: GRAY, size: 10 }),
    { align: 'center', spaceAfter: 120 },
  ));

  // --- 1. Resumen del mandato ---
  body.push(heading1('1. Resumen del mandato'));
  const kv: [string, string][] = [
    ['Servicio', b.service_category || '—'],
    ['Subservicio', b.service_subcategory || '—'],
    ['Descripción', b.description || '(sin descripción detallada)'],
    ['Complejidad', COMPLEXITY_ES[b.complexity_level] || b.complexity_level],
    ['Urgencia', URGENCY_ES[b.urgency_level] || b.urgency_level],
    ['Tarifa usada', b.rate_used ? `${b.rate_used} €/hora` : '—'],
    ['Honorario estimado', b.estimated_total_fee !== null ? fmtMoney(b.estimated_total_fee, cur) : '—'],
    ['Horas estimadas', b.estimated_total_hours !== null ? `${b.estimated_total_hours} h` : '—'],
  ];
  for (const [k, v] of kv) {
    body.push(para(run(`${k}: `, { bold: true, color: NAVY, size: 10 }) + run(v, { color: INK, size: 10 }), { spaceAfter: 30 }));
  }

  // --- 2. Tabla de actuaciones previstas ---
  body.push(heading1('2. Actuaciones previstas'));
  if (b.planned_actions.length) {
    body.push(actionsTable(b));
  } else {
    body.push(para(run('No se identificaron actuaciones.', { italic: true, color: GRAY, size: 10 })));
  }

  // --- 3. Distribución de aportación de valor ---
  body.push(heading1('3. Distribución de aportación de valor'));
  const byLevel = (lvl: ValueLevel) => b.planned_actions.filter((a) => a.value_level === lvl).map((a) => a.action_title);
  const blocks: [string, ValueLevel, number][] = [
    ['Aportación alta de valor', 'high', dist.high_value_count],
    ['Aportación media de valor', 'medium', dist.medium_value_count],
    ['Aportación baja de valor', 'low', dist.low_value_count],
  ];
  for (const [label, lvl, count] of blocks) {
    body.push(para(run(`${label}: ${count}`, { bold: true, color: valueColor(lvl), size: 11 }), { spaceBefore: 80, spaceAfter: 30 }));
    for (const title of byLevel(lvl)) body.push(bullet(title));
  }

  // --- 4. Supuestos utilizados ---
  body.push(heading1('4. Supuestos utilizados'));
  if (b.assumptions.length) b.assumptions.forEach((a) => body.push(bullet(a)));
  else body.push(para(run('Sin supuestos registrados.', { italic: true, color: GRAY, size: 10 })));

  // --- 5. Información pendiente o no confirmada ---
  body.push(heading1('5. Información pendiente o no confirmada'));
  if (b.missing_information.length) b.missing_information.forEach((m) => body.push(bullet(m)));
  else body.push(para(run('No hay información pendiente registrada.', { italic: true, color: GRAY, size: 10 })));

  if (b.warnings.length) {
    body.push(heading1('Avisos'));
    b.warnings.forEach((w) => body.push(bullet(w)));
  }

  // --- 6. Nota final ---
  body.push(heading1('6. Nota final'));
  body.push(para(run(
    'Este documento es un desglose preliminar de actuaciones previstas generado para fines internos '
    + 'de estimación de honorarios. Debe ser revisado por el equipo jurídico antes de ser enviado al '
    + 'cliente o utilizado como base definitiva de una propuesta.',
    { italic: true, color: INK, size: 10 },
  ), { spaceBefore: 60 }));

  // Sección horizontal (landscape) A4.
  const sectPr = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}${sectPr}</w:body></w:document>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="${INK}"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function slug(s: string): string {
  return (s || 'mandato').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mandato';
}

/** Genera el .docx en memoria. Devuelve nombre sugerido + buffer. */
export function exportBreakdownDocx(
  breakdown: PlannedActionBreakdown, opts: ExportOptions = {},
): { fileName: string; buffer: Buffer } {
  const documentXml = buildDocumentXml(breakdown, opts);
  const buffer = zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES_XML },
    { name: '_rels/.rels', data: RELS_XML },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS_XML },
  ]);
  const fileName = `Desglose-actuaciones-${slug(breakdown.service_category)}-${breakdown.id.replace(/^brk_/, '')}.docx`;
  return { fileName, buffer };
}

/**
 * Genera el .docx, lo guarda bajo data/exports y registra el
 * ExportedBreakdownDocument. Devuelve { record, buffer }.
 */
export function saveBreakdownDocx(
  breakdown: PlannedActionBreakdown, generatedBy: string, opts: ExportOptions = {},
): { record: ExportedBreakdownDocument; buffer: Buffer } {
  const { fileName, buffer } = exportBreakdownDocx(breakdown, { ...opts, generatedBy });
  const rel = join('exports', fileName);
  const abs = join(DATA_ROOT, rel);
  writeFileSync(abs, buffer);
  const record: ExportedBreakdownDocument = {
    id: newId('exp'),
    breakdown_id: breakdown.id,
    file_name: fileName,
    file_type: 'docx',
    generated_at: nowIso(),
    generated_by: generatedBy || 'usuario_interno',
    file_path: rel,
  };
  exportedDocsRepo.save(record);
  return { record, buffer };
}
