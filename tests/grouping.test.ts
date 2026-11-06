import { describe, expect, it } from "vitest";
import { captureTime, sameSecondCounter, timeFromFileName, wallClockFromInstant } from "@/lib/grouping/capture-time";
import { applyVerdicts, checkWindows, proposeGroups, shootingOrder, type GroupingPhoto } from "@/lib/grouping/group";
import { orangeShare } from "@/lib/grouping/divider";
import { verdictFromAnswer } from "@/lib/grouping/check";

// A fixture photo set: a Galaxy shooting session, one photo every `step` seconds.
const t0 = Date.UTC(2026, 10, 6, 14, 0, 0);
function shot(id: string, secondsIn: number, opts: Partial<GroupingPhoto> = {}): GroupingPhoto {
  const at = new Date(t0 + secondsIn * 1000);
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return { id, fileName: `${stamp}.jpg`, takenAt: at, pickOrder: 0, isDivider: false, ...opts };
}
const ids = (groups: { photoIds: string[] }[]) => groups.map((g) => g.photoIds.join(","));

describe("capture time", () => {
  it("reads Samsung Galaxy file names, including same-second suffixes", () => {
    expect(timeFromFileName("20261106_141523.jpg")?.toISOString()).toBe("2026-11-06T14:15:23.000Z");
    expect(timeFromFileName("20261106_141523(1).jpg")?.toISOString()).toBe("2026-11-06T14:15:23.000Z");
    expect(sameSecondCounter("20261106_141523(1).jpg")).toBe(1);
    expect(sameSecondCounter("20261106_141523_2.jpg")).toBe(2);
    expect(sameSecondCounter("20261106_141523.jpg")).toBe(0);
  });

  it("reads Pixel and other Android names, and rejects impossible dates", () => {
    expect(timeFromFileName("PXL_20261106_141523123.jpg")?.toISOString()).toBe("2026-11-06T14:15:23.123Z");
    expect(timeFromFileName("IMG_20261106_141523.heic")?.toISOString()).toBe("2026-11-06T14:15:23.000Z");
    expect(timeFromFileName("20261306_141523.jpg")).toBeNull();
    expect(timeFromFileName("1000012345.jpg")).toBeNull();
  });

  it("prefers EXIF, then the file name, then the file's modified time", () => {
    const exif = new Date(Date.UTC(2026, 0, 1));
    expect(captureTime({ exif, fileName: "20261106_141523.jpg" }).source).toBe("exif");
    expect(captureTime({ exif: null, fileName: "20261106_141523.jpg" }).source).toBe("filename");
    expect(captureTime({ exif: null, fileName: "photo.jpg", lastModified: exif }).source).toBe("modified");
    expect(captureTime({ exif: null, fileName: "photo.jpg" })).toEqual({ at: null, source: "none" });
  });

  it("turns the browser's modified time into local wall-clock time", () => {
    // 19:00 UTC in New York (offset 300 minutes) is 14:00 on the camera's clock.
    expect(wallClockFromInstant(Date.UTC(2026, 10, 6, 19, 0, 0), 300).toISOString()).toBe("2026-11-06T14:00:00.000Z");
  });
});

describe("shooting order", () => {
  it("sorts by time, then the same-second counter, and keeps untimed photos in picked order", () => {
    const a = shot("a", 10);
    const b = { ...shot("b", 10), sameSecond: 1, fileName: "20261106_140010(1).jpg" };
    const c = shot("c", 5);
    expect(shootingOrder([b, a, c]).map((p) => p.id)).toEqual(["c", "a", "b"]);
    const x = { ...shot("x", 0), takenAt: null, pickOrder: 2 };
    const y = { ...shot("y", 0), takenAt: null, pickOrder: 1 };
    expect(shootingOrder([x, y]).map((p) => p.id)).toEqual(["y", "x"]);
  });
});

describe("grouping with divider cards", () => {
  it("starts a new item at each divider and leaves the divider out", () => {
    const photos = [
      shot("a1", 0), shot("a2", 8), shot("a3", 15),
      shot("d1", 20, { isDivider: true }),
      shot("b1", 30), shot("b2", 38),
      shot("d2", 45, { isDivider: true }),
      shot("c1", 50),
    ];
    const groups = proposeGroups(photos);
    expect(ids(groups)).toEqual(["a1,a2,a3", "b1,b2", "c1"]);
    expect(groups.map((g) => g.startsBy)).toEqual(["first", "divider", "divider"]);
    expect(groups.every((g) => g.uncertain === null)).toBe(true);
  });

  it("ignores time gaps when dividers are used, but flags a long pause inside an item", () => {
    const photos = [shot("a1", 0), shot("a2", 600), shot("d", 610, { isDivider: true }), shot("b1", 620), shot("b2", 680)];
    const groups = proposeGroups(photos);
    expect(ids(groups)).toEqual(["a1,a2", "b1,b2"]);
    expect(groups[0].uncertain).toMatch(/10-minute pause/);
    expect(groups[1].uncertain).toBeNull();
  });

  it("drops empty groups from back-to-back dividers or a divider first", () => {
    const photos = [shot("d0", 0, { isDivider: true }), shot("a", 5), shot("d1", 10, { isDivider: true }), shot("d2", 12, { isDivider: true }), shot("b", 20)];
    expect(ids(proposeGroups(photos))).toEqual(["a", "b"]);
  });

  it("flags an item with more photos than eBay allows", () => {
    const photos = Array.from({ length: 26 }, (_, i) => shot(`p${i}`, i * 3)).concat(shot("d", 100, { isDivider: true }));
    expect(proposeGroups(photos)[0].uncertain).toMatch(/eBay allows 24/);
  });
});

describe("grouping without divider cards (time-gap fallback)", () => {
  it("starts a new item after a pause and marks every group for checking", () => {
    const photos = [shot("a1", 0), shot("a2", 10), shot("b1", 120), shot("b2", 130), shot("c1", 400)];
    const groups = proposeGroups(photos);
    expect(ids(groups)).toEqual(["a1,a2", "b1,b2", "c1"]);
    expect(groups.map((g) => g.startsBy)).toEqual(["first", "time-gap", "time-gap"]);
    expect(groups.every((g) => g.uncertain?.includes("no divider cards"))).toBe(true);
  });

  it("keeps photos without any time together, for Claude to split", () => {
    const photos = ["a", "b", "c"].map((id, i) => ({ ...shot(id, 0), takenAt: null, pickOrder: i }));
    expect(ids(proposeGroups(photos))).toEqual(["a,b,c"]);
  });
});

describe("Claude's check", () => {
  it("puts neighbouring time-gap groups in one window, but never across a divider", () => {
    const groups = proposeGroups([shot("a", 0), shot("b", 100), shot("c", 200)]);
    expect(checkWindows(groups).map((w) => w.photoIds.join(","))).toEqual(["a,b,c"]);

    const withDividers = proposeGroups([
      ...Array.from({ length: 18 }, (_, i) => shot(`x${i}`, i * 5)),
      shot("d", 200, { isDivider: true }),
      shot("y", 210),
    ]);
    expect(checkWindows(withDividers)).toHaveLength(1); // only the 18-photo item is in doubt
  });

  it("caps windows at 24 photos", () => {
    const groups = proposeGroups(Array.from({ length: 30 }, (_, i) => shot(`p${i}`, i * 5)));
    expect(checkWindows(groups).map((w) => w.photoIds.length)).toEqual([24, 6]);
  });

  it("applies Claude's boundaries: merges two time-gap groups and splits another", () => {
    const groups = proposeGroups([shot("a1", 0), shot("a2", 100), shot("b1", 110), shot("b2", 115)]);
    expect(ids(groups)).toEqual(["a1", "a2,b1,b2"]);
    const verdict = [
      { photoId: "a1", startsNewItem: true, isDivider: false },
      { photoId: "a2", startsNewItem: false, isDivider: false }, // same item as a1 after all
      { photoId: "b1", startsNewItem: true, isDivider: false }, // a different item
      { photoId: "b2", startsNewItem: false, isDivider: false },
    ];
    const res = applyVerdicts(groups, [verdict]);
    expect(ids(res.groups)).toEqual(["a1,a2", "b1,b2"]);
    expect(res.groups.every((g) => g.checkedByClaude && g.uncertain === null)).toBe(true);
  });

  it("takes out a divider card only Claude spotted, and leaves unchecked groups alone", () => {
    const groups = proposeGroups([
      shot("a1", 0), shot("a2", 5), shot("card", 10), shot("b1", 15),
      shot("d", 20, { isDivider: true }),
      shot("c1", 30),
    ]);
    // a1..b1 has a 4-photo group in no doubt; force a check of it as Claude would get it.
    const res = applyVerdicts(groups, [[
      { photoId: "a1", startsNewItem: true, isDivider: false },
      { photoId: "a2", startsNewItem: false, isDivider: false },
      { photoId: "card", startsNewItem: false, isDivider: true },
      { photoId: "b1", startsNewItem: false, isDivider: false },
    ]]);
    expect(ids(res.groups)).toEqual(["a1,a2", "b1", "c1"]);
    expect(res.dividers).toEqual(["card"]);
    expect(res.groups[2].checkedByClaude).toBe(false);
  });
});

describe("orange divider card", () => {
  const px = (rgb: number[], n: number) => Buffer.from(Array.from({ length: n }, () => rgb).flat());
  it("counts saturated orange pixels and ignores brown, red and skin tones", () => {
    expect(orangeShare(px([245, 120, 20], 10), 3)).toBe(1); // safety orange
    expect(orangeShare(px([255, 165, 0], 10), 3)).toBe(1); // web orange
    expect(orangeShare(px([120, 70, 30], 10), 3)).toBe(0); // brown (too dark)
    expect(orangeShare(px([220, 30, 30], 10), 3)).toBe(0); // red
    expect(orangeShare(px([225, 180, 150], 10), 3)).toBe(0); // skin (not saturated)
    expect(orangeShare(Buffer.concat([px([245, 120, 20], 3), px([250, 250, 250], 7)]), 3)).toBeCloseTo(0.3);
  });
});

describe("reading Claude's grouping answer", () => {
  it("maps numbered photos back to ids; missing photos stay with the item before", () => {
    const v = verdictFromAnswer(["p1", "p2", "p3"], [
      { photo: 1, startsNewItem: false, isDivider: false },
      { photo: 3, startsNewItem: true, isDivider: false },
    ]);
    expect(v).toEqual([
      { photoId: "p1", startsNewItem: true, isDivider: false },
      { photoId: "p2", startsNewItem: false, isDivider: false },
      { photoId: "p3", startsNewItem: true, isDivider: false },
    ]);
  });
});

import { makeCover, mergeWithPrevious, moveToNext, moveToPrevious, putBack, splitAt, takeOut } from "@/lib/grouping/edit";

describe("grouping screen edits", () => {
  const g = [["a", "b", "c"], ["d", "e"]];
  it("splits an item at a photo, and merges it back", () => {
    expect(splitAt(g, "b")).toEqual([["a"], ["b", "c"], ["d", "e"]]);
    expect(splitAt(g, "a")).toBe(g); // already the first photo
    expect(mergeWithPrevious(splitAt(g, "b"), 1)).toEqual(g);
  });

  it("moves a photo to the item before or after, dropping emptied items", () => {
    expect(moveToNext(g, "c")).toEqual([["a", "b"], ["c", "d", "e"]]);
    expect(moveToPrevious(g, "d")).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(moveToPrevious([["a"], ["b"]], "b")).toEqual([["a", "b"]]);
    expect(moveToPrevious(g, "a")).toBe(g);
  });

  it("makes a photo the cover, takes one out and puts it back where it was taken", () => {
    expect(makeCover(g, "c")).toEqual([["c", "a", "b"], ["d", "e"]]);
    const out = takeOut(g, "d");
    expect(out).toEqual([["a", "b", "c"], ["e"]]);
    expect(putBack(out, ["a", "b", "c", "d", "e"], "d")).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(putBack([["e"]], ["a", "e"], "a")).toEqual([["a", "e"]]);
    expect(putBack([], ["a"], "a")).toEqual([["a"]]);
  });
});
