// App version - INCREMENT ON EVERY COMMIT!
// Format: MAJOR.MINOR.PATCH
// Increment PATCH (0.0.X) for each commit
export const APP_VERSION = '1.3.5';

export interface ChangelogNotice {
  type: 'info' | 'warning' | 'success' | 'danger';
  title: string;
  message: string;
  animated?: boolean;
}

// Featured video shown at top of changelog (set to null to hide)
export const FEATURED_VIDEO: {
  youtubeId: string;
  title: string;
  banner?: ChangelogNotice;
} | null = {
  youtubeId: '5ezX5ra0RTI',
  title: 'MasterSelects Demo',
  banner: {
    type: 'danger',
    title: 'Playback Fixes',
    message: 'Fixed the playback bugs on Win/Linux.',
  },
};

// Build/Platform notice shown at top of changelog (set to null to hide)
export const BUILD_NOTICE: ChangelogNotice | null = {
  type: 'success',
  title: 'Native Helper v0.3.1 available',
  message: 'Includes the local AI bridge, Firefox project save/open support, and the refreshed helper workflow.',
  animated: true,
};

// Change entry type (used by UI)
export interface ChangeEntry {
  type: 'new' | 'fix' | 'improve' | 'refactor';
  title: string;
  description?: string;
  section?: string; // Optional section header to create visual dividers
  commits?: string[]; // Git commit hashes for linking to GitHub
}

// Time-grouped changelog entry
export interface TimeGroupedChanges {
  label: string;
  dateRange: string; // "Jan 20" or "Jan 13-19" etc
  changes: ChangeEntry[];
}

// Raw changelog entry as stored in changelog-data.json
export interface RawChangeEntry {
  date: string; // ISO date string YYYY-MM-DD
  type: 'new' | 'fix' | 'improve' | 'refactor';
  title: string;
  description?: string;
  section?: string;
  commits?: string[];
}

// Import changelog data from JSON
import changelogData from './changelog-data.json';
const RAW_CHANGELOG: RawChangeEntry[] = changelogData as RawChangeEntry[];

function parseISODateLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateRange(minDate: Date, maxDate: Date): string {
  if (minDate.getTime() === maxDate.getTime()) {
    return formatDateShort(maxDate);
  }

  const sameMonth = minDate.getFullYear() === maxDate.getFullYear() && minDate.getMonth() === maxDate.getMonth();
  if (sameMonth) {
    return `${maxDate.toLocaleDateString('en-US', { month: 'short' })} ${minDate.getDate()}-${maxDate.getDate()}`;
  }

  return `${formatDateShort(minDate)} - ${formatDateShort(maxDate)}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getMonthDiff(now: Date, date: Date): number {
  return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}

function formatMonthLabel(date: Date, now: Date): string {
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString('en-US', includeYear
    ? { month: 'long', year: 'numeric' }
    : { month: 'long' });
}

function getInitialCommitDate(entries: RawChangeEntry[]): Date | null {
  if (entries.length === 0) {
    return null;
  }

  return entries
    .map((entry) => parseISODateLocal(entry.date))
    .reduce((earliest, date) => (date < earliest ? date : earliest));
}

// Calculate relative time labels based on current date
function getTimeLabel(
  date: Date,
  now: Date,
  initialCommitDate: Date | null
): { label: string; sortOrder: number } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const normalizedDate = startOfDay(date);
  const dayDiff = Math.round((today.getTime() - normalizedDate.getTime()) / dayMs);
  const monthDiff = getMonthDiff(today, normalizedDate);

  if (dayDiff <= 0) {
    return { label: 'Today', sortOrder: 0 };
  }
  if (dayDiff === 1) {
    return { label: 'Yesterday', sortOrder: 1 };
  }
  if (dayDiff === 2) {
    return { label: 'Day Before Yesterday', sortOrder: 2 };
  }
  if (dayDiff < 7) {
    return { label: 'Last Week', sortOrder: 3 };
  }
  if (monthDiff === 0) {
    return { label: formatMonthLabel(normalizedDate, now), sortOrder: 4 };
  }
  if (monthDiff === 1) {
    return { label: 'Last Month', sortOrder: 5 };
  }
  if (
    initialCommitDate &&
    startOfDay(initialCommitDate).getTime() === normalizedDate.getTime()
  ) {
    return { label: 'Initial Commit', sortOrder: 10_000 };
  }
  return { label: formatMonthLabel(normalizedDate, now), sortOrder: 5 + monthDiff };
}

// Group changes by time period
export function getGroupedChangelog(
  entries: RawChangeEntry[] = RAW_CHANGELOG,
  now: Date = new Date()
): TimeGroupedChanges[] {
  const groups = new Map<string, { sortOrder: number; minDate: Date; maxDate: Date; changes: ChangeEntry[] }>();
  const initialCommitDate = getInitialCommitDate(entries);

  for (const entry of entries) {
    const date = parseISODateLocal(entry.date);
    const { label, sortOrder } = getTimeLabel(date, now, initialCommitDate);

    if (!groups.has(label)) {
      groups.set(label, { sortOrder, minDate: date, maxDate: date, changes: [] });
    }

    const group = groups.get(label)!;
    if (date < group.minDate) group.minDate = date;
    if (date > group.maxDate) group.maxDate = date;
    group.changes.push({
      type: entry.type,
      title: entry.title,
      description: entry.description,
      section: entry.section,
      commits: entry.commits,
    });
  }

  // Sort groups by sortOrder and return
  return Array.from(groups.entries())
    .map(([label, data]) => ({
      label,
      dateRange: formatDateRange(data.minDate, data.maxDate),
      changes: data.changes,
    }))
    .sort((a, b) => {
      const orderA = groups.get(a.label)?.sortOrder ?? 99;
      const orderB = groups.get(b.label)?.sortOrder ?? 99;
      return orderA - orderB;
    });
}

// Known issues and bugs - shown in What's New dialog
// Remove items when fixed
export const KNOWN_ISSUES: string[] = [
  'YouTube download requires Native Helper with yt-dlp installed',
  'Audio waveforms may not display for some video formats',
  'Very long videos (>2 hours) may cause performance issues',
];
