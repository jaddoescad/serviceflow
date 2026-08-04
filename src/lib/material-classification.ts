export const GENERAL_PAINT_SUPPLIES_LABEL = "General paint supplies";

export function materialClassificationLabel(category: string | null | undefined) {
  const normalized = category?.trim().toLocaleLowerCase("en-CA") ?? "";

  if (
    !normalized ||
    normalized === "shop supplies" ||
    normalized.includes("overhead")
  ) {
    return GENERAL_PAINT_SUPPLIES_LABEL;
  }

  return category!.trim();
}
