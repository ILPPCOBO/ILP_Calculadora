/**
 * zip.ts — escritor ZIP mínimo SIN dependencias (método STORE, sin compresión).
 *
 * Un archivo .docx es, en realidad, un contenedor ZIP (Open Packaging
 * Conventions) con XML dentro. La filosofía del proyecto es "core sin
 * dependencias": en vez de añadir una librería de Word, generamos el ZIP a mano
 * con `node:zlib`/`node:buffer`. Usamos el método STORE (compresión 0): el
 * archivo es algo mayor, pero Word lo abre perfectamente y el código es trivial
 * y robusto (sin estado de compresión que pueda fallar).
 *
 * Sólo soporta lo que necesitamos: varios ficheros de texto/binario, nombres
 * ASCII/UTF-8, sin carpetas explícitas (las rutas con "/" bastan).
 */

/** Tabla CRC-32 (polinomio 0xEDB88320), precomputada una sola vez. */
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 de un buffer (entero sin signo de 32 bits). */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Ruta dentro del ZIP, p.ej. "word/document.xml". */
  name: string;
  /** Contenido (texto se codifica como UTF-8). */
  data: Buffer | string;
}

/**
 * Empaqueta varias entradas en un Buffer ZIP (método STORE).
 * Fecha/hora fijas (no usamos Date.now para resultados deterministas y porque
 * el entorno de scripts puede prohibir Date.now; aquí en backend no, pero lo
 * mantenemos estable a propósito).
 */
export function zipStore(entries: ZipEntry[]): Buffer {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = 0x21; // 1980-01-01
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    // --- Local file header (30 bytes + nombre) ---
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // método: 0 = STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // tamaño comprimido = tamaño (STORE)
    local.writeUInt32LE(size, 22); // tamaño sin comprimir
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBuf, dataBuf);

    // --- Central directory header (46 bytes + nombre) ---
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // firma
    central.writeUInt16LE(20, 4); // versión creada por
    central.writeUInt16LE(20, 6); // versión necesaria
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // método STORE
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset del local header
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const localBuf = Buffer.concat(localParts);

  // --- End of central directory (22 bytes) ---
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disco
  end.writeUInt16LE(0, 6); // disco del central
  end.writeUInt16LE(entries.length, 8); // entradas en este disco
  end.writeUInt16LE(entries.length, 10); // total entradas
  end.writeUInt32LE(centralBuf.length, 12); // tamaño del central
  end.writeUInt32LE(localBuf.length, 16); // offset del central
  end.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localBuf, centralBuf, end]);
}
