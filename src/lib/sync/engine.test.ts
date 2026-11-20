import { describe, expect, it } from 'vitest';
import { applyCellValues } from '../domain/dataset';
import type { Dataset } from '../domain/types';
import { cellsOf, col, makeDataset } from '../test-utils';
import { applySyncPlan, buildSyncPlan, countPlan, findRepeatedMappings, SyncError, type PlanContext } from './engine';

function setup() {
  const target = makeDataset('target', 'Target', ['No', 'NIM', 'Nama', 'Tugas', 'UTS', 'UAS'], [
    [1, '0215001', 'Ani', null, null, null],
    [2, '0215002', 'Budi', null, 75, null],
    [3, '0215003', 'Citra', null, null, null],
    [4, '0215004', 'Dodi', null, null, null],
  ]);
  const s1 = makeDataset('source', 'Kelas A', ['NIM', 'Nama', 'Tugas', 'UTS'], [
    ['0215003', 'Citra', 80, 0],
    ['0215001', 'Ani', 90, ''],
    ['0215002', 'Budi', 85, 88],
    ['0219999', 'Orang Lain', 50, 50],
  ]);
  const s2 = makeDataset('source', 'Kelas B', ['NIM', 'Nama', 'UAS'], [
    ['0215004', 'Dodi', 70],
    ['0215001', 'Ani', 95],
  ]);
  const ctx: PlanContext = { target, sources: [s1, s2], manualMatches: [], nameApprovals: [] };
  return { target, s1, s2, ctx };
}

function pairs(source: Dataset, target: Dataset, map: [string, string][]) {
  return map.map(([s, t]) => ({ sourceColumnId: col(source, s), targetColumnId: col(target, t) }));
}

describe('buildSyncPlan', () => {
  it('classifies fills, overwrites, skipped empties and zero grades', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas'], ['UTS', 'UTS']]) }]);
    expect(plan.errors).toEqual([]);
    const c = countPlan(plan);
    // Tugas: 3 fills. UTS: Citra 0 (fill), Ani '' (skipped), Budi 88 over 75 (overwrite)
    expect(c.fill).toBe(4);
    expect(c.overwrite).toBe(1);
    expect(c.skippedEmpty).toBe(1);
    expect(c.sourceOnly).toBe(1);
    expect(c.targetOnly).toBe(1);
    const zero = plan.cells.find((x) => x.after === 0);
    expect(zero?.kind).toBe('fill');
  });

  it('marks equal values as unchanged', () => {
    const { target, s1, ctx } = setup();
    const t2 = applyCellValues(target, [{ rowId: target.rows[1].id, columnId: col(target, 'UTS'), value: '88' }]);
    const plan = buildSyncPlan({ ...ctx, target: t2 }, [{ sourceDatasetId: s1.id, pairs: pairs(s1, t2, [['UTS', 'UTS']]) }]);
    expect(countPlan(plan).unchanged).toBe(1);
    expect(countPlan(plan).overwrite).toBe(0);
  });

  it('refuses mapping into identity columns', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'NIM']]) }]);
    expect(plan.errors.join(' ')).toMatch(/kolom identitas/);
  });

  it('excludes name mismatches from the plan', () => {
    const { target, ctx } = setup();
    const s = makeDataset('source', 'S', ['NIM', 'Nama', 'Tugas'], [['0215001', 'Anita', 99]]);
    const plan = buildSyncPlan({ ...ctx, sources: [s] }, [{ sourceDatasetId: s.id, pairs: pairs(s, target, [['Tugas', 'Tugas']]) }]);
    expect(plan.cells).toHaveLength(0);
    expect(countPlan(plan).nameMismatches).toBe(1);
  });

  it('detects conflicts when two sources write different values to the same cell', () => {
    const { target, s1, s2, ctx } = setup();
    const s2b = makeDataset('source', 'Kelas B', ['NIM', 'Nama', 'Tugas'], [['0215001', 'Ani', 10]]);
    const plan = buildSyncPlan({ ...ctx, sources: [s1, s2b] }, [
      { sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas']]) },
      { sourceDatasetId: s2b.id, pairs: pairs(s2b, target, [['Tugas', 'Tugas']]) },
    ]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.cells.some((c) => c.key === plan.conflicts[0].key)).toBe(false);
    void s2;
  });
});

describe('applySyncPlan', () => {
  it('fills only selected target cells, preserves row order, and skips unapproved overwrites', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas'], ['UTS', 'UTS']]) }]);
    const { target: out, operation } = applySyncPlan(ctx, plan, { approvedOverwrites: new Set() });
    expect(out.rows.map((r) => r.id)).toEqual(target.rows.map((r) => r.id));
    expect(cellsOf(out, 'NIM')).toEqual(['0215001', '0215002', '0215003', '0215004']);
    expect(cellsOf(out, 'Tugas')).toEqual([90, 85, 80, null]);
    expect(cellsOf(out, 'UTS')).toEqual([null, 75, 0, null]); // Budi's 75 kept
    expect(cellsOf(out, 'UAS')).toEqual([null, null, null, null]);
    expect(operation.stats.filled).toBe(4);
    expect(operation.stats.overwritten).toBe(0);
    expect(operation.stats.overwriteDeclined).toBe(1);
    expect(operation.stats.skippedEmpty).toBe(1);
    expect(operation.stats.unmatchedSource).toBe(1);
    expect(operation.changes).toHaveLength(4);
    // The original target is untouched (atomic, immutable).
    expect(cellsOf(target, 'Tugas')).toEqual([null, null, null, null]);
  });

  it('overwrites only explicitly approved cells', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['UTS', 'UTS']]) }]);
    const ow = plan.cells.find((c) => c.kind === 'overwrite')!;
    const { target: out, operation } = applySyncPlan(ctx, plan, { approvedOverwrites: new Set([ow.key]) });
    expect(cellsOf(out, 'UTS')).toEqual([null, 88, 0, null]);
    expect(operation.stats.overwritten).toBe(1);
    expect(operation.changes.find((c) => c.after === 88)?.before).toBe(75);
  });

  it('synchronizes multiple sources with different row orders into one target', () => {
    const { target, s1, s2, ctx } = setup();
    const plan = buildSyncPlan(ctx, [
      { sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas']]) },
      { sourceDatasetId: s2.id, pairs: pairs(s2, target, [['UAS', 'UAS']]) },
    ]);
    const { target: out, operation } = applySyncPlan(ctx, plan, { approvedOverwrites: new Set() });
    expect(cellsOf(out, 'Tugas')).toEqual([90, 85, 80, null]);
    expect(cellsOf(out, 'UAS')).toEqual([95, null, null, 70]);
    expect(operation.sources.map((s) => s.datasetName)).toEqual(['Kelas A', 'Kelas B']);
    expect(operation.stats.unmatchedTarget).toBe(0);
  });

  it('is atomic: refuses a stale plan and changes nothing', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas']]) }]);
    const edited = applyCellValues(target, [{ rowId: target.rows[0].id, columnId: col(target, 'Tugas'), value: 1 }]);
    expect(() => applySyncPlan({ ...ctx, target: edited }, plan, { approvedOverwrites: new Set() })).toThrow(SyncError);
    expect(cellsOf(edited, 'Tugas')).toEqual([1, null, null, null]);
  });

  it('refuses plans with errors', () => {
    const { target, s1, ctx } = setup();
    const plan = buildSyncPlan(ctx, [{ sourceDatasetId: s1.id, pairs: [] }]);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(() => applySyncPlan(ctx, plan, { approvedOverwrites: new Set() })).toThrow(SyncError);
    void target;
  });

  it('detects repeated mappings', () => {
    const { target, s1, ctx } = setup();
    const req = [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['Tugas', 'Tugas']]) }];
    const plan = buildSyncPlan(ctx, req);
    const { operation } = applySyncPlan(ctx, plan, { approvedOverwrites: new Set() });
    expect(findRepeatedMappings([operation], req)).toHaveLength(1);
    expect(findRepeatedMappings([{ ...operation, status: 'undone' }], req)).toHaveLength(0);
    expect(
      findRepeatedMappings([operation], [{ sourceDatasetId: s1.id, pairs: pairs(s1, target, [['UTS', 'UTS']]) }]),
    ).toHaveLength(0);
  });
});
