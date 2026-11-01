import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { claudeModel, env } from "@/lib/env";

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export type ImageInput = { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" };

export type JsonSchema = { [key: string]: unknown };

export class ClaudeAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeAnswerError";
  }
}

/**
 * Pulls the JSON answer out of a structured-output response and validates it.
 * Pure, so it is unit-tested with sample responses.
 */
export function readStructuredAnswer<S extends z.ZodTypeAny>(
  res: Pick<Anthropic.Messages.Message, "content" | "stop_reason">,
  schema: S,
  what: string,
): z.infer<S> {
  if (res.stop_reason === "refusal") {
    throw new ClaudeAnswerError(`Claude declined to ${what} for these photos. Try different photos, or add a note describing the item.`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new ClaudeAnswerError(`Claude's answer was cut off while trying to ${what}. Try again; if it keeps happening, use fewer photos.`);
  }
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new ClaudeAnswerError(`Claude returned no answer while trying to ${what}. Try again.`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ClaudeAnswerError(`Claude's answer while trying to ${what} wasn't valid JSON. Try again.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ClaudeAnswerError(`Claude's answer while trying to ${what} was incomplete (${issue?.path.join(".") || "answer"}: ${issue?.message}).`);
  }
  return parsed.data;
}

/**
 * One Claude call whose answer is JSON matching `jsonSchema` (structured outputs),
 * then validated and cleaned up by the zod `schema`.
 *
 * Current models (Sonnet 5.5 and newer) don't accept forced tool use, so
 * structured outputs is the supported way to get a fixed JSON shape. These
 * models think before answering by default; `effort` sets how much.
 */
export async function askStructured<S extends z.ZodTypeAny>(opts: {
  what: string; // for error messages, e.g. "identify the item"
  prompt: string;
  jsonSchema: JsonSchema;
  schema: S;
  images?: ImageInput[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...(opts.images ?? []).map(
      (img): Anthropic.Messages.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
      }),
    ),
    { type: "text", text: opts.prompt },
  ];

  const res = await anthropic().messages.create({
    model: claudeModel(),
    // Thinking counts toward max_tokens, so leave generous room.
    max_tokens: opts.maxTokens ?? 8000,
    output_config: {
      format: { type: "json_schema", schema: opts.jsonSchema },
      effort: opts.effort ?? "medium",
    },
    messages: [{ role: "user", content }],
  });

  return readStructuredAnswer(res, opts.schema, opts.what);
}
