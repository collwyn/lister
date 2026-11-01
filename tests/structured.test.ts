import { describe, expect, it } from "vitest";
import { readStructuredAnswer } from "@/lib/drafting/claude";
import {
  categoryChoiceSchema,
  chooseCategoryJsonSchema,
  identificationSchema,
  identifyJsonSchema,
  listingDraftSchema,
  writeJsonSchema,
} from "@/lib/drafting/prompts";

/** Checks the structured-outputs rules from Anthropic's docs on every object in a schema. */
function structuredOutputProblems(schema: any, path = "$"): string[] {
  const problems: string[] = [];
  if (schema && typeof schema === "object") {
    if (schema.type === "object") {
      if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
      const props = Object.keys(schema.properties ?? {});
      const missing = props.filter((p) => !(schema.required ?? []).includes(p));
      if (missing.length) problems.push(`${path}: not required: ${missing.join(", ")}`);
    }
    for (const k of ["minimum", "maximum", "multipleOf", "minLength", "maxLength"]) {
      if (k in schema) problems.push(`${path}: unsupported ${k}`);
    }
    for (const [k, v] of Object.entries(schema)) {
      if (v && typeof v === "object") problems.push(...structuredOutputProblems(v, `${path}.${k}`));
    }
  }
  return problems;
}

const suggestions = [
  { categoryId: "33034", name: "Electric Guitars", path: "Musical Instruments & Gear > Guitars & Basses > Electric Guitars" },
  { categoryId: "47067", name: "Guitar Parts", path: "Musical Instruments & Gear > Guitars & Basses > Parts & Accessories" },
];

describe("structured-output schemas follow the API's rules", () => {
  it("identify", () => expect(structuredOutputProblems(identifyJsonSchema)).toEqual([]));
  it("choose category", () => expect(structuredOutputProblems(chooseCategoryJsonSchema(suggestions))).toEqual([]));
  it("write listing", () => expect(structuredOutputProblems(writeJsonSchema(["1000", "3000"]))).toEqual([]));

  it("limits the category to eBay's suggestions and the condition to the category's", () => {
    expect((chooseCategoryJsonSchema(suggestions) as any).properties.categoryId.enum).toEqual(["33034", "47067"]);
    expect((writeJsonSchema(["3000", "7000"]) as any).properties.conditionId.enum).toEqual(["3000", "7000"]);
  });
});

const msg = (content: any[], stop_reason: any = "end_turn") => ({ content, stop_reason });

describe("readStructuredAnswer", () => {
  const good = {
    groupType: "Other",
    whatItIs: "Epiphone Les Paul Special electric guitar, cherry red",
    brand: "Epiphone",
    model: "",
    keywords: "epiphone les paul special cherry",
    visibleCondition: "Used, light wear",
    flaws: ["small scratch on lower bout"],
    sizeClass: "large",
    estimatedWeightOz: 0,
    identificationConfidence: "High",
    notes: "",
  };

  it("reads JSON that follows thinking blocks, and cleans up blanks and casing", () => {
    const out = readStructuredAnswer(
      msg([{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: JSON.stringify(good) }]),
      identificationSchema,
      "identify the item",
    );
    expect(out.brand).toBe("Epiphone");
    expect(out.model).toBeUndefined();
    expect(out.estimatedWeightOz).toBeUndefined();
    expect(out.groupType).toBe("other");
    expect(out.identificationConfidence).toBe("high");
  });

  it("explains a refusal", () => {
    expect(() => readStructuredAnswer(msg([{ type: "text", text: "I can't" }], "refusal"), identificationSchema, "identify the item")).toThrow(
      /declined to identify the item/,
    );
  });

  it("explains a cut-off answer", () => {
    expect(() => readStructuredAnswer(msg([{ type: "text", text: "{" }], "max_tokens"), identificationSchema, "write the listing")).toThrow(
      /cut off while trying to write the listing/,
    );
  });

  it("explains invalid JSON and empty answers", () => {
    expect(() => readStructuredAnswer(msg([{ type: "text", text: "not json" }]), identificationSchema, "x")).toThrow(/wasn't valid JSON/);
    expect(() => readStructuredAnswer(msg([{ type: "thinking", thinking: "" }]), identificationSchema, "x")).toThrow(/no answer/);
  });

  it("names the missing field when the answer is incomplete", () => {
    expect(() => readStructuredAnswer(msg([{ type: "text", text: JSON.stringify({ ...good, whatItIs: undefined }) }]), identificationSchema, "x")).toThrow(
      /whatItIs/,
    );
  });

  it("reads a category choice", () => {
    const out = readStructuredAnswer(msg([{ type: "text", text: '{"categoryId":"33034","confident":true,"reason":"It is a complete guitar."}' }]), categoryChoiceSchema, "x");
    expect(out).toMatchObject({ categoryId: "33034", confident: true });
  });
});

describe("listing answers", () => {
  it("turns the item-specifics list into eBay's name → values map", () => {
    const out = listingDraftSchema.parse({
      title: "Epiphone Les Paul Special Electric Guitar Cherry Red",
      description: "d",
      conditionId: "3000",
      conditionNotes: "",
      aspects: [
        { name: "Brand", values: ["Epiphone"] },
        { name: "Model", values: ["Les Paul Special"] },
        { name: "Color", values: [] },
      ],
      price: 179,
      priceConfidence: "medium",
      priceReasoning: "",
      weightOz: 0,
      notes: "",
    });
    expect(out.aspects).toEqual({ Brand: ["Epiphone"], Model: ["Les Paul Special"] });
    expect(out.weightOz).toBeUndefined();
    expect(out.conditionNotes).toBeUndefined();
  });
});
