/**
 * wordProposalExporter — genera un .docx profesional de una "Propuesta de
 * honorarios". Igual que el exportador del desglose, construye el
 * WordprocessingML a mano y lo empaqueta con backend/utils/zip.ts (STORE), sin
 * dependencias. Documento en vertical (portrait) A4.
 *
 * El cuerpo de cada sección admite un marcado ligero: líneas que empiezan por
 * "- " se renderizan como viñetas y los fragmentos entre "**" en negrita
 * (términos definidos, p.ej. la **"Propuesta"**).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipStore } from '../backend/utils/zip.ts';
import { DATA_ROOT, proposalDocsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import type { FeeProposal, ProposalSection, ExportedProposalDocument } from '../backend/models/index.ts';

// Colores de marca ILP (hex sin #).
const NAVY = '102542';
const GOLD = 'A8842F';
const GRAY = '767E8C';
const INK = '1A1F2B';

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

interface ParaOpts { align?: string; spaceAfter?: number; spaceBefore?: number; }

function para(runsXml: string, o: ParaOpts = {}): string {
  const ppr: string[] = [];
  if (o.align) ppr.push(`<w:jc w:val="${o.align}"/>`);
  if (o.spaceAfter !== undefined || o.spaceBefore !== undefined) {
    ppr.push(`<w:spacing${o.spaceBefore !== undefined ? ` w:before="${o.spaceBefore}"` : ''}${o.spaceAfter !== undefined ? ` w:after="${o.spaceAfter}"` : ''}/>`);
  }
  const pprXml = ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : '';
  return `<w:p>${pprXml}${runsXml}</w:p>`;
}

function heading1(text: string): string {
  return para(run(text, { bold: true, color: NAVY, size: 13 }), { spaceBefore: 220, spaceAfter: 80 });
}

/** Convierte un fragmento con "**negrita**" en runs, respetando opciones base. */
function inlineRuns(text: string, base: RunOpts = {}): string {
  const parts = text.split('**');
  let out = '';
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === '') continue;
    const bold = (i % 2 === 1) || base.bold === true;
    out += run(parts[i], { ...base, bold });
  }
  return out || run('', base);
}

function bulletLine(text: string): string {
  return para(run('•  ', { color: GOLD, bold: true }) + inlineRuns(text, { color: INK, size: 10 }), { spaceAfter: 40 });
}

/** Renderiza el cuerpo de una sección: párrafos y viñetas con negrita en línea. */
function renderBody(body: string): string {
  const lines = (body || '').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    if (/^-\s+/.test(line)) {
      out.push(bulletLine(line.replace(/^-\s+/, '')));
    } else {
      out.push(para(inlineRuns(line, { color: INK, size: 10 }), { spaceAfter: 80 }));
    }
  }
  return out.join('');
}

function fmtDateEs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const KIND_LABEL: Record<string, string> = {
  reduced: 'Propuesta reducida', intermediate: 'Propuesta intermedia', extended: 'Propuesta extendida',
  simple: 'Propuesta intermedia', elaborate: 'Propuesta extendida', // compat
};

export interface ExportOptions { firmName?: string | null; generatedBy?: string | null; }

function partyBlock(label: string, name: string | null, taxId: string | null, rep: string | null): string {
  const parts = [name || '[●]'];
  if (taxId) parts.push(`CIF/NIF: ${taxId}`);
  if (rep) parts.push(`Repr.: ${rep}`);
  return para(
    run(`${label}: `, { bold: true, color: NAVY, size: 10 }) + run(parts.join(' · '), { color: INK, size: 10 }),
    { spaceAfter: 30 },
  );
}

/** Regla horizontal (borde inferior de párrafo) para separar el membrete. */
function rule(color: string, size = 8): string {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="${size}" w:space="1" w:color="${color}"/></w:pBdr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
}

function buildDocumentXml(p: FeeProposal, opts: ExportOptions): string {
  const firm = (opts.firmName || p.firm.name || 'ILP Abogados').trim();
  const body: string[] = [];

  // --- Membrete: logotipo ILP (azul/negro) alineado a la derecha, como en una carta ---
  body.push(para(
    run('ILP', { bold: true, color: NAVY, size: 30 }) + run(' ABOGADOS', { bold: true, color: NAVY, size: 12 }),
    { align: 'right', spaceAfter: 0 },
  ));
  body.push(rule(NAVY, 8));
  body.push(para(run(fmtDateEs(p.date), { color: INK, size: 10 }), { align: 'right', spaceBefore: 120, spaceAfter: 160 }));

  // --- Secciones ---
  // Los apartados numerados llevan su título; los estructurales (destinatario,
  // apertura, cierre, aceptación) van sin título, como en una carta.
  for (const s of p.sections as ProposalSection[]) {
    if (/^\d+\./.test(s.heading)) body.push(heading1(s.heading));
    body.push(renderBody(s.body));
  }

  // --- Nota final de revisión interna ---
  body.push(para(run(
    'Documento generado automáticamente a partir de una estimación. Borrador interno: los honorarios son sugeridos '
    + 'y revisables, y no incluyen IVA ni suplidos salvo indicación expresa. Revíselo antes de enviarlo al Cliente.',
    { italic: true, color: GRAY, size: 8 },
  ), { spaceBefore: 200 }));

  // Sección vertical (portrait) A4, con pie de página (rId2).
  const sectPr = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="567" w:gutter="0"/></w:sectPr>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}${sectPr}</w:body></w:document>`;
}

/** Pie de página: firma + oficinas + número de página (campo PAGE). */
const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${GRAY}"/></w:pBdr><w:jc w:val="center"/><w:spacing w:before="40"/></w:pPr>`
  + `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${GRAY}"/><w:sz w:val="13"/></w:rPr><w:t xml:space="preserve">ILP Abogados  ·  [oficinas del Despacho]  ·  Pág. </w:t></w:r>`
  + `<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${GRAY}"/><w:sz w:val="13"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`
  + `</w:p></w:ftr>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="${INK}"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

function slug(s: string): string {
  return (s || 'propuesta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'propuesta';
}

/** Genera el .docx en memoria. Devuelve nombre sugerido + buffer. */
export function exportProposalDocx(proposal: FeeProposal, opts: ExportOptions = {}): { fileName: string; buffer: Buffer } {
  const documentXml = buildDocumentXml(proposal, opts);
  const buffer = zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES_XML },
    { name: '_rels/.rels', data: RELS_XML },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/footer1.xml', data: FOOTER_XML },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS_XML },
  ]);
  const fileName = `Propuesta-honorarios-${slug(proposal.service_category)}-${proposal.id.replace(/^prop_/, '')}.docx`;
  return { fileName, buffer };
}

/**
 * Genera el .docx, lo guarda bajo data/exports y registra el
 * ExportedProposalDocument. Devuelve { record, buffer }.
 */
export function saveProposalDocx(
  proposal: FeeProposal, generatedBy: string, opts: ExportOptions = {},
): { record: ExportedProposalDocument; buffer: Buffer } {
  const { fileName, buffer } = exportProposalDocx(proposal, { ...opts, generatedBy });
  const rel = join('exports', fileName);
  const abs = join(DATA_ROOT, rel);
  writeFileSync(abs, buffer);
  const record: ExportedProposalDocument = {
    id: newId('exp'),
    proposal_id: proposal.id,
    file_name: fileName,
    file_type: 'docx',
    generated_at: nowIso(),
    generated_by: generatedBy || 'usuario_interno',
    file_path: rel,
  };
  proposalDocsRepo.save(record);
  return { record, buffer };
}
