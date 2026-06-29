/**
 * Repositorio JSON genérico.
 *
 * Cada colección es una carpeta bajo data/<colección>/ donde cada entidad se
 * guarda como un archivo <id>.json. Esto da trazabilidad por archivo y diffs
 * legibles en el prototipo.
 *
 * La interfaz `Repository<T>` está deliberadamente desacoplada de la
 * implementación en JSON: para migrar a SQLite/Postgres basta con escribir otra
 * clase que la implemente. Ningún servicio debe leer/escribir archivos a mano.
 */

import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';

export interface Entity {
  id: string;
}

export interface Repository<T extends Entity> {
  list(): T[];
  get(id: string): T | null;
  save(entity: T): T;          // create or replace (upsert)
  delete(id: string): boolean;
  clear(): void;
  find(predicate: (e: T) => boolean): T[];
}

export class JsonRepository<T extends Entity> implements Repository<T> {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    // Sanea el id para que jamás escape de la carpeta (no path traversal).
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  list(): T[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !f.startsWith('.'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as T;
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  }

  get(id: string): T | null {
    const file = this.fileFor(id);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  save(entity: T): T {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.fileFor(entity.id), JSON.stringify(entity, null, 2), 'utf8');
    return entity;
  }

  delete(id: string): boolean {
    const file = this.fileFor(id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }

  clear(): void {
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) {
      if (f.endsWith('.json') && !f.startsWith('_') && !f.startsWith('.')) {
        rmSync(join(this.dir, f));
      }
    }
  }

  find(predicate: (e: T) => boolean): T[] {
    return this.list().filter(predicate);
  }
}
