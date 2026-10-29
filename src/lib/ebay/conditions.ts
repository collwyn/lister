// eBay describes conditions two ways: numeric condition IDs (Metadata API,
// what categories allow) and enum names (Inventory API, what you publish with).

export const CONDITION_ENUM: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "2990": "PRE_OWNED_EXCELLENT",
  "3000": "USED_EXCELLENT",
  "3010": "PRE_OWNED_FAIR",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

export const FOR_PARTS = "7000";

export function conditionEnum(conditionId: string | null | undefined): string | undefined {
  return conditionId ? CONDITION_ENUM[conditionId] : undefined;
}

/** New-condition listings can't carry a seller condition note on eBay. */
export function allowsConditionNotes(conditionId: string | null | undefined): boolean {
  return !!conditionId && !["1000"].includes(conditionId);
}
