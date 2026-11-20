import { nowIso } from '../domain/cells';
import { CURRENT_SCHEMA_VERSION } from '../domain/project';
import type { Project } from '../domain/types';
import { migrateProject, MigrationError } from './migrations';

export const BACKUP_FORMAT = 'syncscore-project-backup';

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  project: Project;
}

export function createBackup(project: Project): string {
  const backup: ProjectBackup = {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: nowIso(),
    project,
  };
  return JSON.stringify(backup, null, 1);
}

/** Parses and validates a backup file, upgrading it to the current schema. */
export function parseBackup(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MigrationError('Berkas cadangan bukan JSON yang valid.');
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== BACKUP_FORMAT) {
    throw new MigrationError('Berkas ini bukan cadangan proyek SyncScore.');
  }
  const b = parsed as { schemaVersion?: unknown; project?: unknown };
  const project = b.project as Record<string, unknown> | undefined;
  if (!project || typeof project !== 'object') throw new MigrationError('Cadangan tidak berisi data proyek.');
  const schemaVersion = typeof b.schemaVersion === 'number' ? b.schemaVersion : project.schemaVersion;
  return migrateProject({ ...project, schemaVersion });
}

export function backupFileName(project: Project): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'proyek';
  return `${base} - cadangan SyncScore ${date}.json`;
}
