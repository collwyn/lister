import sharp from "sharp";
import { z } from "zod";
import { askStructured, type JsonSchema } from "@/lib/drafting/claude";
import type { WindowVerdict } from "./group";

// Claude looks at photos the local rules weren't sure about (no divider cards,
// a long pause, too many photos in one item) and says where each new item starts.
// Small thumbnails keep this cheap: about 150 image tokens per photo.

export const THUMB_LONG_EDGE = 448;

export const groupingJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    photos: {
      type: "array",
      description: "One entry per photo, in the order given.",
      items: {
        type: "object",
        properties: {
          photo: { type: "integer", description: "The photo number, as labelled." },
          startsNewItem: { type: "boolean", description: "True if this photo shows a different item from the photo before it." },
          isDivider: { type: "boolean", description: "True if this photo is a divider card rather than an item." },
        },
        required: ["photo", "startsNewItem", "isDivider"],
        additionalProperties: false,
      },
    },
  },
  required: ["photos"],
  additionalProperties: false,
};

const answerSchema = z.object({
  photos: z.array(z.object({ photo: z.number().int(), startsNewItem: z.boolean(), isDivider: z.boolean() })),
});

export function groupingPrompt(count: number, firstContinuesItem: boolean): string {
  return [
    `These ${count} photos were taken in this order by a seller photographing things to sell on eBay, one item after another.`,
    "Each item usually has several photos: overall views, back and sides, labels, model numbers, close-ups of flaws.",
    "Between items the seller may photograph a divider card: a bright orange card, or a card reading NEXT ITEM with a QR code.",
    "For each photo, say whether it shows a different item from the photo before it, and whether it is a divider card.",
    "Same object from another angle, a close-up of its label or a flaw, or its box and accessories = the same item.",
    "Things clearly meant to sell together (a pair, a set, a device with its charger) = one item.",
    "Similar but separate objects (two different comics, two phones) = different items.",
    firstContinuesItem
      ? "Photo 1 continues an item from earlier photos you can't see: set its startsNewItem to false."
      : "Photo 1 starts an item: set its startsNewItem to true.",
    "When you can't tell, keep the photo with the item before it.",
  ].join("\n");
}

export type CheckPhoto = { id: string; jpeg: Buffer; minutesSincePrevious: number | null };

/** Asks Claude where items start in one window of consecutive photos. */
export async function checkWindow(photos: CheckPhoto[], firstContinuesItem = false): Promise<WindowVerdict> {
  const images = await Promise.all(
    photos.map(async (p, i) => ({
      data: await sharp(p.jpeg).resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "inside" }).jpeg({ quality: 78 }).toBuffer(),
      mediaType: "image/jpeg" as const,
      label:
        `Photo ${i + 1}` +
        (i > 0 && p.minutesSincePrevious !== null && p.minutesSincePrevious >= 1 ? ` (taken ${Math.round(p.minutesSincePrevious)} min after photo ${i})` : ""),
    })),
  );
  const answer = await askStructured({
    what: "group the photos into items",
    prompt: groupingPrompt(photos.length, firstContinuesItem),
    jsonSchema: groupingJsonSchema,
    schema: answerSchema,
    images,
    maxTokens: 6000,
    effort: "low",
  });
  return verdictFromAnswer(photos.map((p) => p.id), answer.photos);
}

/** Maps Claude's numbered answer back to photo ids; photos it left out keep their place in the item before. Pure. */
export function verdictFromAnswer(photoIds: string[], answer: { photo: number; startsNewItem: boolean; isDivider: boolean }[]): WindowVerdict {
  const byNumber = new Map(answer.map((a) => [a.photo, a]));
  return photoIds.map((photoId, i) => {
    const a = byNumber.get(i + 1);
    return { photoId, startsNewItem: i === 0 ? true : (a?.startsNewItem ?? false), isDivider: a?.isDivider ?? false };
  });
}

// ---- Orange-only dividers: an orange item could look like one, so Claude confirms ----

export const colorDividerJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          photo: { type: "integer", description: "The photo number, as labelled." },
          isDividerCard: { type: "boolean", description: "True if the photo shows a plain card or sheet used as a divider, not an item for sale." },
        },
        required: ["photo", "isDividerCard"],
        additionalProperties: false,
      },
    },
  },
  required: ["photos"],
  additionalProperties: false,
};

const colorAnswer = z.object({ photos: z.array(z.object({ photo: z.number().int(), isDividerCard: z.boolean() })) });

/** Returns the ids Claude confirms are divider cards. Photos it doesn't answer for stay dividers. */
export async function confirmColorDividers(photos: { id: string; jpeg: Buffer }[]): Promise<Set<string>> {
  const images = await Promise.all(
    photos.map(async (p, i) => ({
      data: await sharp(p.jpeg).resize({ width: 320, height: 320, fit: "inside" }).jpeg({ quality: 75 }).toBuffer(),
      mediaType: "image/jpeg" as const,
      label: `Photo ${i + 1}`,
    })),
  );
  const answer = await askStructured({
    what: "check the divider cards",
    prompt: [
      "A seller photographs a plain orange card (or a card reading NEXT ITEM) between items they are selling.",
      "These photos are mostly orange. For each, say whether it is such a divider card, or an item for sale that happens to be orange.",
    ].join("\n"),
    jsonSchema: colorDividerJsonSchema,
    schema: colorAnswer,
    images,
    maxTokens: 3000,
    effort: "low",
  });
  const notDivider = new Set(answer.photos.filter((a) => !a.isDividerCard).map((a) => photos[a.photo - 1]?.id).filter(Boolean));
  return new Set(photos.map((p) => p.id).filter((id) => !notDivider.has(id)));
}
