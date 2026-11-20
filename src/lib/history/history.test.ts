import { describe, expect, it } from 'vitest';
import { applyCellValues, applyPositionalEdits, deleteRows, insertRows } from '../domain/dataset';
import { createProject, replaceDataset } from '../domain/project';
import type { Project } from '../domain/types';
import { applySyncPlan, buildSyncPlan } from '../sync/engine';
import { cellsOf, col, makeDataset } from '../test-utils';
import {
  createEditOperation,
  createStructureOperation,
  latestRedoable,
  latestUndoable,
  recordOperation,
  runHistory,
} from './history';

function syncedProject() {
  const base = createProject('Uji');
  const target = { ...makeDataset('target', 'T', ['NIM', 'Nama', 'Nilai', 'Lain'], [
    ['01', 'Ani', null, null],
    ['02', 'Budi', 60, null],
  ]), id: base.target.id };
  const source = makeDataset('source', 'S', ['NIM', 'Nama', 'Nilai'], [
    ['02', 'Budi', 70],
    ['01', 'Ani', 80],
  ]);
  let project: Project = { ...base, target, sources: [source], activeSourceId: source.id, mappings: { [source.id]: [] } };
  const ctx = { target, sources: [source], manualMatches: [], nameApprovals: [] };
  const plan = buildSyncPlan(ctx, [
    { sourceDatasetId: source.id, pairs: [{ sourceColumnId: col(source, 'Nilai'), targetColumnId: col(target, 'Nilai') }] },
  ]);
  const ow = plan.cells.filter((c) => c.kind === 'overwrite').map((c) => c.key);
  const res = applySyncPlan(ctx, plan, { approvedOverwrites: new Set(ow) });
  project = recordOperation(replaceDataset(project, res.target), res.operation);
  return { project, opId: res.operation.id };
}

describe('undo/redo of synchronization', () => {
  it('undoes and redoes a sync operation', () => {
    const { project, opId } = syncedProject();
    expect(cellsOf(project.target, 'Nilai')).toEqual([80, 70]);
    const undone = runHistory(project, opId, 'undo');
    expect(undone.applied).toBe(true);
    expect(cellsOf(undone.project.target, 'Nilai')).toEqual([null, 60]);
    expect(latestRedoable(undone.project)?.id).toBe(opId);
    const redone = runHistory(undone.project, opId, 'redo');
    expect(cellsOf(redone.project.target, 'Nilai')).toEqual([80, 70]);
    expect(latestUndoable(redone.project)?.id).toBe(opId);
  });

  it('does not destroy unrelated later edits', () => {
    const { project, opId } = syncedProject();
    const t = project.target;
    const editOp = createEditOperation(
      t.id,
      'Edit',
      [{ datasetId: t.id, rowId: t.rows[0].id, columnId: col(t, 'Lain'), before: null, after: 'x' }],
      'e1',
    );
    const edited = recordOperation(
      replaceDataset(project, applyCellValues(t, [{ rowId: t.rows[0].id, columnId: col(t, 'Lain'), value: 'x' }])),
      editOp,
    );
    const undone = runHistory(edited, opId, 'undo');
    expect(undone.applied).toBe(true);
    expect(cellsOf(undone.project.target, 'Nilai')).toEqual([null, 60]);
    expect(cellsOf(undone.project.target, 'Lain')).toEqual(['x', null]);
  });

  it('reports conflicts when a synced cell was edited afterwards and changes nothing in check mode', () => {
    const { project, opId } = syncedProject();
    const t = project.target;
    const edited = replaceDataset(project, applyCellValues(t, [{ rowId: t.rows[0].id, columnId: col(t, 'Nilai'), value: 99 }]));
    const check = runHistory(edited, opId, 'undo', 'check');
    expect(check.applied).toBe(false);
    expect(check.conflicts).toHaveLength(1);
    expect(check.conflicts[0].reason).toBe('modified');
    expect(cellsOf(check.project.target, 'Nilai')).toEqual([99, 70]);

    const skip = runHistory(edited, opId, 'undo', 'skip-conflicts');
    expect(cellsOf(skip.project.target, 'Nilai')).toEqual([99, 60]);

    const force = runHistory(edited, opId, 'undo', 'force');
    expect(cellsOf(force.project.target, 'Nilai')).toEqual([null, 60]);
  });

  it('treats deleted rows as missing conflicts', () => {
    const { project, opId } = syncedProject();
    const t = project.target;
    const p2 = replaceDataset(project, deleteRows(t, [t.rows[0].id]));
    const res = runHistory(p2, opId, 'undo', 'skip-conflicts');
    expect(res.conflicts.map((c) => c.reason)).toEqual(['missing']);
    expect(cellsOf(res.project.target, 'Nilai')).toEqual([60]);
  });

  it('clears the redo stack when a new operation is recorded', () => {
    const { project, opId } = syncedProject();
    const undone = runHistory(project, opId, 'undo').project;
    expect(undone.redoStack).toEqual([opId]);
    const next = recordOperation(undone, createEditOperation(undone.target.id, 'x', [], 'e2'));
    expect(next.redoStack).toEqual([]);
  });
});

describe('undo/redo of structural operations', () => {
  it('undoes a row insertion only while the dataset is unchanged since', () => {
    const p = createProject('S');
    const ds = p.target;
    const grown = applyPositionalEdits(ds, [{ rowIndex: 0, colIndex: 0, value: 'a' }]).dataset;
    let project = replaceDataset(p, grown);
    const after = insertRows(grown, 1, 2);
    const op = createStructureOperation('s1', ds.id, 'Tambah baris', grown, after);
    project = recordOperation(replaceDataset(project, after), op);
    expect(project.target.rows).toHaveLength(3);

    const blockedProject = replaceDataset(
      project,
      applyCellValues(project.target, [{ rowId: project.target.rows[1].id, columnId: project.target.columns[0].id, value: 'z' }]),
    );
    const blocked = runHistory(blockedProject, 's1', 'undo');
    expect(blocked.applied).toBe(false);
    expect(blocked.blocked).toBeTruthy();

    const ok = runHistory(project, 's1', 'undo');
    expect(ok.applied).toBe(true);
    expect(ok.project.target.rows).toHaveLength(1);
    const redo = runHistory(ok.project, 's1', 'redo');
    expect(redo.project.target.rows).toHaveLength(3);
  });
});
