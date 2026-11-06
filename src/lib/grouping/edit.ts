// Edits on the grouping screen. Pure: each takes the groups (arrays of photo
// ids, in item order) and returns new groups. Empty groups are dropped.

export type Groups = string[][];

const clean = (groups: Groups): Groups => groups.filter((g) => g.length > 0);

export function locate(groups: Groups, photoId: string): { gi: number; pi: number } | null {
  for (let gi = 0; gi < groups.length; gi++) {
    const pi = groups[gi].indexOf(photoId);
    if (pi >= 0) return { gi, pi };
  }
  return null;
}

/** This photo and the ones after it in its item become a new item. */
export function splitAt(groups: Groups, photoId: string): Groups {
  const at = locate(groups, photoId);
  if (!at || at.pi === 0) return groups;
  const g = groups[at.gi];
  return [...groups.slice(0, at.gi), g.slice(0, at.pi), g.slice(at.pi), ...groups.slice(at.gi + 1)];
}

export function mergeWithPrevious(groups: Groups, gi: number): Groups {
  if (gi <= 0 || gi >= groups.length) return groups;
  return [...groups.slice(0, gi - 1), [...groups[gi - 1], ...groups[gi]], ...groups.slice(gi + 1)];
}

export function moveToPrevious(groups: Groups, photoId: string): Groups {
  const at = locate(groups, photoId);
  if (!at || at.gi === 0) return groups;
  const next = groups.map((g) => [...g]);
  next[at.gi].splice(at.pi, 1);
  next[at.gi - 1].push(photoId);
  return clean(next);
}

export function moveToNext(groups: Groups, photoId: string): Groups {
  const at = locate(groups, photoId);
  if (!at || at.gi === groups.length - 1) return groups;
  const next = groups.map((g) => [...g]);
  next[at.gi].splice(at.pi, 1);
  next[at.gi + 1].unshift(photoId);
  return clean(next);
}

/** The first photo is the listing's main photo. */
export function makeCover(groups: Groups, photoId: string): Groups {
  const at = locate(groups, photoId);
  if (!at || at.pi === 0) return groups;
  return groups.map((g, gi) => (gi === at.gi ? [photoId, ...g.filter((id) => id !== photoId)] : g));
}

export function takeOut(groups: Groups, photoId: string): Groups {
  return clean(groups.map((g) => g.filter((id) => id !== photoId)));
}

/**
 * Puts a left-out photo back next to the photo taken just before it (or just
 * after it), using the batch's shooting order.
 */
export function putBack(groups: Groups, shootingOrder: string[], photoId: string): Groups {
  if (locate(groups, photoId)) return groups;
  const idx = shootingOrder.indexOf(photoId);
  const next = groups.map((g) => [...g]);
  for (let i = idx - 1; i >= 0; i--) {
    const at = locate(next, shootingOrder[i]);
    if (at) {
      next[at.gi].splice(at.pi + 1, 0, photoId);
      return next;
    }
  }
  for (let i = idx + 1; i < shootingOrder.length; i++) {
    const at = locate(next, shootingOrder[i]);
    if (at) {
      next[at.gi].splice(at.pi, 0, photoId);
      return next;
    }
  }
  return [...next, [photoId]];
}
