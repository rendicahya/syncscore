import { describe, expect, it } from 'vitest';
import type { ManualMatch, NameApproval } from '../domain/types';
import { makeDataset } from '../test-utils';
import { matchDatasets, summarizeMatch, validateManualPair } from './engine';
import { compareNames, nimKey } from './identity';

const target = () =>
  makeDataset('target', 'Target', ['NIM', 'Nama', 'UTS'], [
    ['0215001', 'Ani Lestari', null],
    ['0215002', 'Budi Santoso', null],
    ['0215003', 'Citra', null],
    ['0215004', 'Dodi', null],
  ]);

describe('nimKey', () => {
  it('keeps NIM as text with leading zeros', () => {
    expect(nimKey('0215001')).toEqual({ status: 'ok', key: '0215001' });
    expect(nimKey('  0215001 ')).toEqual({ status: 'ok', key: '0215001' });
  });
  it('accepts safe integer numbers verbatim and rejects unsafe/scientific ones', () => {
    expect(nimKey(215001)).toEqual({ status: 'ok', key: '215001' });
    expect(nimKey(2 ** 60).status).toBe('invalid');
    expect(nimKey(1.5).status).toBe('invalid');
    expect(nimKey('2.15E+14').status).toBe('invalid');
  });
  it('treats empty values as empty', () => {
    expect(nimKey(null).status).toBe('empty');
    expect(nimKey('   ').status).toBe('empty');
  });
});

describe('compareNames', () => {
  it('ignores case and whitespace only', () => {
    expect(compareNames('ANI  lestari', 'Ani Lestari')).toBe('same');
    expect(compareNames('Muh. Rizki', 'Muh Rizki')).toBe('different');
    expect(compareNames('', 'Ani')).toBe('unknown');
  });
});

describe('matchDatasets', () => {
  it('matches by exact NIM regardless of row order', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama', 'Nilai'], [
      ['0215003', 'Citra', 70],
      ['0215001', 'Ani Lestari', 90],
    ]);
    const r = matchDatasets(s, t);
    expect(r.errors).toEqual([]);
    expect(r.pairs).toHaveLength(2);
    expect(r.sourceToTarget.get(s.rows[0].id)).toBe(t.rows[2].id);
    expect(r.sourceToTarget.get(s.rows[1].id)).toBe(t.rows[0].id);
    expect(r.targetOnly.map((x) => x.nim)).toEqual(['0215002', '0215004']);
  });

  it('does not match NIMs that differ only by leading zeros', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [['215001', 'Ani Lestari']]);
    const r = matchDatasets(s, t);
    expect(r.pairs).toHaveLength(0);
    expect(r.sourceOnly.map((x) => x.nim)).toEqual(['215001']);
  });

  it('flags duplicate NIMs in the source and excludes them from automatic matching', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['0215001', 'Ani Lestari'],
      ['0215001', 'Ani L.'],
      ['0215002', 'Budi Santoso'],
    ]);
    const r = matchDatasets(s, t);
    expect(r.pairs.map((p) => p.nim)).toEqual(['0215002']);
    expect(r.duplicates).toEqual([{ nim: '0215001', side: 'source', rowIds: [s.rows[0].id, s.rows[1].id] }]);
    expect(r.sourceStatus.get(s.rows[0].id)).toBe('duplicate');
    // Target row of a duplicated source NIM is reported as unmatched, never auto-paired.
    expect(r.targetOnly.map((x) => x.nim)).toContain('0215001');
  });

  it('flags duplicate NIMs in the target and blocks the source rows that would match them', () => {
    const t = makeDataset('target', 'T', ['NIM', 'Nama'], [
      ['0215001', 'Ani'],
      ['0215001', 'Ani (ulang)'],
    ]);
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [['0215001', 'Ani']]);
    const r = matchDatasets(s, t);
    expect(r.pairs).toHaveLength(0);
    expect(r.duplicateSourceRows).toHaveLength(1);
    expect(r.duplicateTargetRows).toHaveLength(2);
    expect(r.targetStatus.get(t.rows[0].id)).toBe('duplicate');
  });

  it('requires review when NIM matches but name differs', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [['0215002', 'Budi S.']]);
    const r = matchDatasets(s, t);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].usable).toBe(false);
    expect(r.nameMismatches).toHaveLength(1);
    expect(r.sourceStatus.get(s.rows[0].id)).toBe('name-mismatch');
  });

  it('accepts a name mismatch after explicit approval, and invalidates it when names change', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [['0215002', 'Budi S.']]);
    const approval: NameApproval = {
      id: 'a1',
      sourceDatasetId: s.id,
      sourceRowId: s.rows[0].id,
      targetRowId: t.rows[1].id,
      sourceName: 'Budi S.',
      targetName: 'Budi Santoso',
      approvedAt: '2026-01-01T00:00:00Z',
    };
    const r = matchDatasets(s, t, [], [approval]);
    expect(r.pairs[0].usable).toBe(true);
    expect(r.sourceStatus.get(s.rows[0].id)).toBe('name-approved');

    const nameCol = s.nameColumnId!;
    const changed = { ...s, rows: [{ ...s.rows[0], cells: { ...s.rows[0].cells, [nameCol]: 'Bambang' } }] };
    const r2 = matchDatasets(changed, t, [], [approval]);
    expect(r2.pairs[0].usable).toBe(false);
  });

  it('reports source-only and target-only students and empty NIMs', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama', 'Nilai'], [
      ['0215001', 'Ani Lestari', 1],
      ['0299999', 'Zed', 2],
      [null, 'Tanpa NIM', 3],
    ]);
    const r = matchDatasets(s, t);
    expect(r.sourceOnly.map((x) => x.nim)).toEqual(['0299999']);
    expect(r.emptyNimSource.map((x) => x.name)).toEqual(['Tanpa NIM']);
    expect(r.targetOnly).toHaveLength(3);
    const sum = summarizeMatch(r);
    expect(sum.matched).toBe(1);
    expect(sum.sourceOnly).toBe(1);
  });

  it('applies manual matches before automatic matching', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['215004', 'Dodi'], // typo: missing leading zero
      ['0215001', 'Ani Lestari'],
    ]);
    const manual: ManualMatch = {
      id: 'm1',
      sourceDatasetId: s.id,
      sourceRowId: s.rows[0].id,
      targetRowId: t.rows[3].id,
      createdAt: '2026-01-01T00:00:00Z',
      sourceNim: '215004',
      targetNim: '0215004',
      sourceName: 'Dodi',
      targetName: 'Dodi',
    };
    const r = matchDatasets(s, t, [manual]);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs.find((p) => p.kind === 'manual')?.targetRowId).toBe(t.rows[3].id);
    expect(r.sourceStatus.get(s.rows[0].id)).toBe('manual');
    expect(r.sourceOnly).toHaveLength(0);
  });

  it('ignores manual matches belonging to other sources and reports stale ones', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [['x', 'X']]);
    const stale: ManualMatch = {
      id: 'm2',
      sourceDatasetId: s.id,
      sourceRowId: 'deleted-row',
      targetRowId: t.rows[0].id,
      createdAt: '',
      sourceNim: '',
      targetNim: '',
      sourceName: '',
      targetName: '',
    };
    const r = matchDatasets(s, t, [stale, { ...stale, id: 'other', sourceDatasetId: 'other' }]);
    expect(r.staleManualMatches).toHaveLength(1);
    expect(r.staleManualMatches[0].reason).toBe('source-row-missing');
  });

  it('validates manual pairs', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['0215001', 'Ani Lestari'],
      ['9999', 'Zed'],
    ]);
    const r = matchDatasets(s, t);
    expect(validateManualPair(r, s.rows[0].id, t.rows[3].id)).toMatch(/sudah berpasangan/);
    expect(validateManualPair(r, s.rows[1].id, t.rows[0].id)).toMatch(/Target ini sudah berpasangan/);
    expect(validateManualPair(r, s.rows[1].id, t.rows[3].id)).toBeNull();
  });

  it('reports an error when the NIM column is not selected', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['ID', 'Nilai'], [['1', 2]]);
    expect(s.nimColumnId).toBeNull();
    const r = matchDatasets(s, t);
    expect(r.errors[0]).toMatch(/Kolom NIM/);
  });

  it('never matches by row position', () => {
    const t = target();
    const s = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['x1', 'Ani Lestari'],
      ['x2', 'Budi Santoso'],
    ]);
    const r = matchDatasets(s, t);
    expect(r.pairs).toHaveLength(0);
  });
});
