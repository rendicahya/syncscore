import { createId, nowIso } from './cells';
import { createDataset } from './dataset';
import type { Dataset, Project } from './types';

export const CURRENT_SCHEMA_VERSION = 1;

export function createProject(name: string): Project {
  const now = nowIso();
  const source = createDataset('source', 'Sumber 1');
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId(),
    name,
    createdAt: now,
    updatedAt: now,
    target: createDataset('target', 'Target SIADO'),
    sources: [source],
    activeSourceId: source.id,
    mappings: { [source.id]: [] },
    manualMatches: [],
    nameApprovals: [],
    history: [],
    redoStack: [],
    settings: { defaultOverwrite: 'skip' },
  };
}

export function getDataset(project: Project, id: string): Dataset | undefined {
  if (project.target.id === id) return project.target;
  return project.sources.find((s) => s.id === id);
}

/** Returns a new project with the dataset (matched by id) replaced. */
export function replaceDataset(project: Project, ds: Dataset): Project {
  if (project.target.id === ds.id) return { ...project, target: ds };
  return { ...project, sources: project.sources.map((s) => (s.id === ds.id ? ds : s)) };
}

export function addSource(project: Project, name?: string): { project: Project; source: Dataset } {
  const source = createDataset('source', name ?? nextSourceName(project));
  return {
    source,
    project: {
      ...project,
      sources: [...project.sources, source],
      activeSourceId: source.id,
      mappings: { ...project.mappings, [source.id]: [] },
    },
  };
}

export function nextSourceName(project: Project): string {
  const names = new Set(project.sources.map((s) => s.name.toLowerCase()));
  let n = project.sources.length + 1;
  while (names.has(`sumber ${n}`)) n += 1;
  return `Sumber ${n}`;
}

/**
 * Removes a source dataset together with its mapping, manual matches and name approvals.
 * History entries are retained (they keep their own copies of names for auditing).
 */
export function removeSource(project: Project, sourceId: string): Project {
  const sources = project.sources.filter((s) => s.id !== sourceId);
  const mappings = { ...project.mappings };
  delete mappings[sourceId];
  return {
    ...project,
    sources,
    activeSourceId: project.activeSourceId === sourceId ? (sources[0]?.id ?? null) : project.activeSourceId,
    mappings,
    manualMatches: project.manualMatches.filter((m) => m.sourceDatasetId !== sourceId),
    nameApprovals: project.nameApprovals.filter((a) => a.sourceDatasetId !== sourceId),
  };
}
