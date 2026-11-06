// Splits an upload's photos into items. Pure: no I/O, unit-tested.
//
// 1. Photos are put in shooting order: capture time, then Samsung's
//    same-second counter, then file name, then the order they were picked.
// 2. With divider cards in the upload, each divider starts a new item and the
//    divider photo itself is left out.
// 3. Without any dividers, a pause longer than NO_DIVIDER_GAP between shots
//    starts a new item. Every such group is marked uncertain.
// 4. Groups that look doubtful are marked uncertain, with a reason, so Claude
//    (check.ts) and then you (the grouping screen) look at them.

export type GroupingPhoto = {
  id: string;
  fileName: string;
  takenAt: Date | null;
  sameSecond?: number; // Samsung "(1)" / "_1" counter
  pickOrder: number; // order the files were chosen in the browser
  isDivider: boolean;
};

export type ProposedGroup = {
  photoIds: string[];
  /** Why this group starts where it does. */
  startsBy: "first" | "divider" | "time-gap";
  /** Set when the group should be checked, in plain words. */
  uncertain: string | null;
};

/** Without dividers, a pause this long between shots starts a new item. */
export const NO_DIVIDER_GAP_MS = 45_000;
/** With dividers, a pause this long inside one item is suspicious (a missed divider?). */
export const LONG_PAUSE_MS = 5 * 60_000;
/** More photos than this in one item is suspicious. */
export const MANY_PHOTOS = 16;
/** eBay allows at most 24 photos per listing. */
export const EBAY_MAX_PHOTOS = 24;

export function shootingOrder<T extends GroupingPhoto>(photos: T[]): T[] {
  return [...photos].sort((a, b) => {
    const ta = a.takenAt?.getTime();
    const tb = b.takenAt?.getTime();
    if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
    if ((a.sameSecond ?? 0) !== (b.sameSecond ?? 0)) return (a.sameSecond ?? 0) - (b.sameSecond ?? 0);
    // Photos without a time keep the order they were picked in, relative to each other.
    if (ta === undefined || tb === undefined) return a.pickOrder - b.pickOrder;
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true }) || a.pickOrder - b.pickOrder;
  });
}

function gap(a: GroupingPhoto, b: GroupingPhoto): number | null {
  if (!a.takenAt || !b.takenAt) return null;
  return b.takenAt.getTime() - a.takenAt.getTime();
}

function doubts(photos: GroupingPhoto[], usesDividers: boolean): string | null {
  if (photos.length > EBAY_MAX_PHOTOS) return `${photos.length} photos; eBay allows ${EBAY_MAX_PHOTOS} per listing`;
  if (usesDividers) {
    for (let i = 1; i < photos.length; i++) {
      const g = gap(photos[i - 1], photos[i]);
      if (g !== null && g > LONG_PAUSE_MS) return `a ${Math.round(g / 60_000)}-minute pause between photos; a divider may be missing`;
    }
  }
  if (photos.length > MANY_PHOTOS) return `${photos.length} photos in one item`;
  return null;
}

export function proposeGroups(input: GroupingPhoto[]): ProposedGroup[] {
  const photos = shootingOrder(input);
  const usesDividers = photos.some((p) => p.isDivider);
  const groups: { photos: GroupingPhoto[]; startsBy: ProposedGroup["startsBy"] }[] = [];
  let current: { photos: GroupingPhoto[]; startsBy: ProposedGroup["startsBy"] } | null = null;
  let afterDivider = false;

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (p.isDivider) {
      current = null;
      afterDivider = true;
      continue;
    }
    if (!current) {
      current = { photos: [], startsBy: afterDivider ? "divider" : groups.length ? "time-gap" : "first" };
      groups.push(current);
      afterDivider = false;
    } else if (!usesDividers) {
      const g = gap(current.photos[current.photos.length - 1], p);
      if (g !== null && g > NO_DIVIDER_GAP_MS) {
        current = { photos: [], startsBy: "time-gap" };
        groups.push(current);
      }
    }
    current.photos.push(p);
  }

  return groups.map((g) => ({
    photoIds: g.photos.map((p) => p.id),
    startsBy: g.startsBy,
    uncertain: usesDividers
      ? doubts(g.photos, true)
      : (doubts(g.photos, false) ?? "no divider cards in this batch; grouped by pauses between photos"),
  }));
}

// ---- Claude's check (check.ts) works on windows of consecutive photos ----

export type CheckWindow = { photoIds: string[] };

/** Max photos Claude looks at in one call. */
export const WINDOW_MAX = 24;

/**
 * Which photos Claude should look at. Uncertain groups are checked; runs of
 * consecutive uncertain groups that were split only by time gaps go in one
 * window, so Claude can also merge them. Windows never cross a divider.
 */
export function checkWindows(groups: ProposedGroup[]): CheckWindow[] {
  const windows: CheckWindow[] = [];
  let open: string[] | null = null;
  for (const g of groups) {
    if (!g.uncertain) {
      open = null;
      continue;
    }
    const joinable = open && g.startsBy === "time-gap" && open.length + g.photoIds.length <= WINDOW_MAX;
    if (!joinable) {
      open = [];
      windows.push({ photoIds: open });
    }
    for (const id of g.photoIds) {
      if (open!.length === WINDOW_MAX) {
        open = [];
        windows.push({ photoIds: open });
      }
      open!.push(id);
    }
  }
  return windows;
}

/** Claude's answer for one window: for each photo, whether it starts a new item or is a divider. */
export type WindowVerdict = { photoId: string; startsNewItem: boolean; isDivider: boolean }[];

export type CheckedGroup = ProposedGroup & { checkedByClaude: boolean };

/**
 * Rebuilds the groups after Claude's check. A photo inside a checked window
 * starts a new item when Claude says so; a window's first photo, and every
 * photo Claude didn't see, keeps the proposed boundary. Photos Claude calls
 * divider cards are taken out and start a new item after them.
 */
export function applyVerdicts(groups: ProposedGroup[], verdicts: WindowVerdict[]): { groups: CheckedGroup[]; dividers: string[] } {
  const seen = new Map<string, { startsNewItem: boolean | null; isDivider: boolean }>();
  for (const v of verdicts) {
    v.forEach((p, i) => seen.set(p.photoId, { startsNewItem: i === 0 ? null : p.startsNewItem, isDivider: p.isDivider }));
  }

  const out: CheckedGroup[] = [];
  const dividers: string[] = [];
  let current: CheckedGroup | null = null;
  let afterDivider = false;

  for (const g of groups) {
    g.photoIds.forEach((id, i) => {
      const v = seen.get(id);
      if (v?.isDivider) {
        dividers.push(id);
        current = null;
        afterDivider = true;
        return;
      }
      const proposedStart = i === 0;
      const starts = !current || afterDivider || (v && v.startsNewItem !== null ? v.startsNewItem : proposedStart);
      if (starts) {
        current = {
          photoIds: [],
          startsBy: afterDivider ? "divider" : proposedStart ? g.startsBy : "time-gap",
          uncertain: v ? null : g.uncertain,
          checkedByClaude: false,
        };
        out.push(current);
      }
      afterDivider = false;
      current!.photoIds.push(id);
      if (v) {
        current!.checkedByClaude = true;
        current!.uncertain = null;
      }
    });
  }
  for (const g of out) {
    if (g.photoIds.length > EBAY_MAX_PHOTOS) g.uncertain = `${g.photoIds.length} photos; eBay allows ${EBAY_MAX_PHOTOS} per listing`;
  }
  return { groups: out, dividers };
}
