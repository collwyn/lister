import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { claudeModel, env } from "@/lib/env";

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export type ImageInput = { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" };

type Tool = { name: string; description: string; input_schema: Anthropic.Messages.Tool.InputSchema };

/**
 * One Claude call that must answer through `tool`. Returns the tool input,
 * validated by `schema`. Phase 2 moves these calls to the Message Batches API.
 */
export async function callTool<S extends z.ZodTypeAny>(opts: {
  prompt: string;
  tool: Tool;
  schema: S;
  images?: ImageInput[];
  maxTokens?: number;
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
    max_tokens: opts.maxTokens ?? 2048,
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content }],
  });

  const block = res.content.find((b) => b.type === "tool_use" && b.name === opts.tool.name);
  if (!block || block.type !== "tool_use") {
    throw new Error(`Claude did not return ${opts.tool.name} (stop reason: ${res.stop_reason}).`);
  }
  const parsed = opts.schema.safeParse(block.input);
  if (!parsed.success) {
    throw new Error(`Claude's ${opts.tool.name} answer was incomplete: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}
