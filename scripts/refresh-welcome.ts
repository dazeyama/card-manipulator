// Fetch the welcome table's card data again from Scryfall, through the app's own
// client and its paced queue, so the embedded records carry every field the tool
// now keeps (decision 187: EDHREC rank). Card positions are left alone.
//
//   node --experimental-transform-types scripts/refresh-welcome.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { ScryfallClient } from '../src/scryfall/client.ts';
import { trimCard, type ScryfallCard } from '../src/scryfall/trim.ts';

const FILE = 'public/welcome-table.json';
const client = new ScryfallClient(fetch, { 'User-Agent': 'card-manipulator/0.1 (welcome table refresh)' });

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { cards: { scryfallId: string }[]; cardData: Record<string, unknown> };
const ids = [...new Set(doc.cards.map((c) => c.scryfallId))];
const cardData: Record<string, unknown> = {};
for (let i = 0; i < ids.length; i += 75) {
  const res = await client.postJson<{ data: ScryfallCard[] }>('/cards/collection', { identifiers: ids.slice(i, i + 75).map((id) => ({ id })) });
  for (const c of res.data) cardData[c.id] = trimCard(c);
}
const missing = ids.filter((id) => !cardData[id]);
// Keep any record Scryfall no longer returns, so the table still loads.
for (const id of missing) cardData[id] = doc.cardData[id];
doc.cardData = cardData;
writeFileSync(FILE, JSON.stringify(doc));
console.log(`${ids.length - missing.length} of ${ids.length} records refreshed${missing.length ? `, ${missing.length} kept as they were` : ''}`);
