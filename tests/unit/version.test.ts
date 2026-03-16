import { describe, expect, it } from 'vitest';

import { getGroupedChangelog, type RawChangeEntry } from '../../src/version';

describe('getGroupedChangelog', () => {
  it('uses granular recent buckets plus month and initial commit buckets', () => {
    const entries: RawChangeEntry[] = [
      { date: '2026-03-16', type: 'fix', title: 'Today item' },
      { date: '2026-03-15', type: 'fix', title: 'Yesterday item' },
      { date: '2026-03-14', type: 'fix', title: 'Day before yesterday item' },
      { date: '2026-03-10', type: 'fix', title: 'Last week item' },
      { date: '2026-02-05', type: 'fix', title: 'Last month item' },
      { date: '2026-01-10', type: 'fix', title: 'January item' },
      { date: '2026-01-04', type: 'new', title: 'Initial commit item' },
    ];

    const groups = getGroupedChangelog(entries, new Date(2026, 2, 16, 12, 0, 0));

    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Day Before Yesterday',
      'Last Week',
      'Last Month',
      'January',
      'Initial Commit',
    ]);
  });
});
