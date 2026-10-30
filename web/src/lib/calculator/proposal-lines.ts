import {
  CATALOG_BY_ID,
  PAINT_TIER_LABELS,
  priceExteriorLine,
  priceRoom,
  priceWashing,
  type Quote,
} from "@/lib/calculator/engine";
import { newLineItem, type LineItem } from "@/lib/line-items";

const cents = (dollars: number) => Math.round(dollars * 100);
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One proposal line per priced room, exterior item and washing, at client prices. */
export function lineItemsFromCalculator(quote: Quote): { items: LineItem[]; taxRatePercent: number } {
  const items: LineItem[] = [];
  for (const room of quote.rooms) {
    const pricing = priceRoom(room, quote.paintTier, quote.rates.interior);
    if (pricing.total <= 0) continue;
    const scope = [
      room.walls ? `Walls (${PAINT_TIER_LABELS[quote.paintTier]})` : null,
      room.thirdCoat ? "third coat" : null,
      room.ceiling ? "ceiling" : null,
      room.popcorn ? "popcorn ceiling" : null,
      room.doors ? count(room.doors, "door") : null,
      room.trim && room.trimCoats ? `trim (${count(room.trimCoats, "coat")})` : null,
      room.crown ? "crown moulding" : null,
      room.closets ? count(room.closets, "closet") : null,
    ].filter(Boolean);
    items.push(
      newLineItem({
        name: room.name,
        description: [scope.join(", "), room.notes.trim()].filter(Boolean).join("\n"),
        unitPriceCents: cents(pricing.total),
      }),
    );
  }
  for (const line of quote.exterior) {
    const item = CATALOG_BY_ID[line.itemId];
    const pricing = priceExteriorLine(line, quote.rates.exterior);
    if (!item || pricing.client <= 0) continue;
    items.push(
      newLineItem({
        name: item.label,
        description: [
          line.qty ? `${line.qty} ${item.unit}` : null,
          item.hasCoats && line.coats ? count(line.coats, "coat") : null,
        ]
          .filter(Boolean)
          .join(", "),
        unitPriceCents: cents(pricing.client),
      }),
    );
  }
  const washing = priceWashing(quote.washing, quote.rates.exterior);
  if (washing.client > 0) {
    items.push(newLineItem({ name: "Pressure washing", unitPriceCents: cents(washing.client) }));
  }
  return { items, taxRatePercent: Math.round(quote.rates.exterior.hst * 100 * 1000) / 1000 };
}
