import Dexie, { type EntityTable } from 'dexie';
import { createId, nowIso } from '../domain/cells';
import { CURRENT_SCHEMA_VERSION } from '../domain/project';
import type { Project, ProjectSummary } from '../domain/types';
import { migrateProject, MigrationError } from './migrations';

export const DB_NAME = 'syncscore';

interface StoredProjectData {
  id: string;
  schemaVersion: number;
  data: Project;
}

interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * IndexedDB schema.
 * Version history:
 * - 1: projects (summary index), projectData (full project document), meta (key/value).
 * When changing the schema, add `this.version(n).stores(...).upgrade(...)` below and
 * never remove earlier version declarations.
 */
export class SyncScoreDB extends Dexie {
  projects!: EntityTable<ProjectSummary, 'id'>;
  projectData!: EntityTable<StoredProjectData, 'id'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = DB_NAME, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(1).stores({
      projects: 'id, name, updatedAt',
      projectData: 'id',
      meta: 'key',
    });
  }
}

export class ProjectRepository {
  constructor(private readonly db: SyncScoreDB) {}

  async list(): Promise<ProjectSummary[]> {
    const all = await this.db.projects.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Loads a project and upgrades it to the current schema. Returns undefined if missing. */
  async load(id: string): Promise<Project | undefined> {
    const stored = await this.db.projectData.get(id);
    if (!stored) return undefined;
    const project = migrateProject(stored.data);
    if (stored.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      // Persist the upgraded document so future loads are fast; the original is replaced
      // only after a successful migration.
      await this.save(project, { touch: false });
    }
    return project;
  }

  async save(project: Project, opts: { touch?: boolean } = {}): Promise<Project> {
    const saved: Project = opts.touch === false ? project : { ...project, updatedAt: nowIso() };
    await this.db.transaction('rw', this.db.projects, this.db.projectData, async () => {
      await this.db.projects.put({
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      });
      await this.db.projectData.put({ id: saved.id, schemaVersion: CURRENT_SCHEMA_VERSION, data: saved });
    });
    return saved;
  }

  async rename(id: string, name: string): Promise<void> {
    const project = await this.load(id);
    if (!project) throw new MigrationError('Proyek tidak ditemukan.');
    await this.save({ ...project, name });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.projectData, async () => {
      await this.db.projects.delete(id);
      await this.db.projectData.delete(id);
    });
  }

  /** Imports a project as a new copy (new id) so it never overwrites an existing project. */
  async importCopy(project: Project): Promise<Project> {
    const copy: Project = { ...project, id: createId(), createdAt: nowIso() };
    return this.save(copy);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const entry = await this.db.meta.get(key);
    return entry?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /** Deletes every project and setting stored by SyncScore in this browser. */
  async clearAll(): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.projectData, this.db.meta, async () => {
      await this.db.projects.clear();
      await this.db.projectData.clear();
      await this.db.meta.clear();
    });
  }
}
