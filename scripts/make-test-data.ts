// Writes the generated test lists of spec 18.2 from Scryfall data, through
// the app's own serialized client (100 ms / 550 ms spacing).
// Run: node --experimental-transform-types scripts/make-test-data.ts [deck|dfc|bad|stress]

import { writeFileSync } from 'node:fs';
import { ScryfallClient } from '../src/scryfall/client.ts';

const client = new ScryfallClient(fetch, { 'User-Agent': 'card-manipulator/0.1 (local test data)' });

interface Card {
  name: string;
  set: string;
  collector_number: string;
  layout: string;
  finishes: string[];
}

async function search(q: string, max: number, order = 'edhrec'): Promise<Card[]> {
  const out: Card[] = [];
  let url: string | null = `/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=${order}`;
  while (url && out.length < max) {
    const page: { data: Card[]; next_page?: string } | null = await client.getJson(url, { kind: 'search' });
    if (!page) break;
    out.push(...page.data);
    url = page.next_page ?? null;
  }
  return out.slice(0, max);
}

async function collection(names: string[]): Promise<Card[]> {
  const out: Card[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const res = await client.postJson<{ data: Card[] }>('/cards/collection', { identifiers: names.slice(i, i + 75).map((name) => ({ name })) });
    out.push(...res.data);
  }
  return out;
}

const header = (what: string) => `// ${what}\n// Generated from Scryfall data on ${new Date().toISOString().slice(0, 10)} by scripts/make-test-data.ts.\n`;
const only = process.argv[2];
const want = (k: string) => !only || only === k;

async function deck(): Promise<void> {
  // A 60-card deck with set codes, collector numbers and foil markers.
  const names: [number, string][] = [
    [4, 'Lightning Bolt'], [4, 'Monastery Swiftspear'], [4, 'Goblin Guide'], [4, 'Lava Spike'], [4, 'Rift Bolt'],
    [4, 'Skewer the Critics'], [4, 'Light Up the Stage'], [4, 'Eidolon of the Great Revel'], [4, 'Searing Blaze'],
    [3, 'Boros Charm'], [2, 'Skullcrack'], [3, 'Inspiring Vantage'], [4, 'Sacred Foundry'], [12, 'Mountain'],
  ];
  const cards = await collection(names.map(([, n]) => n));
  const lines = names.map(([count, name], i) => {
    const c = cards.find((d) => d.name === name)!;
    const foil = i % 3 === 0 && c.finishes.includes('foil') ? ' *F*' : '';
    return `${count} ${c.name} (${c.set.toUpperCase()}) ${c.collector_number}${foil}`;
  });
  writeFileSync('test-data/deck-60.txt', header('A 60-card burn deck: set codes, collector numbers and *F* foil markers.') + 'Deck\n' + lines.join('\n') + '\n');
}

async function dfc(): Promise<void> {
  // About 40 double-faced and split cards; some lines name only one face.
  const dfcs = await search('(layout:transform or layout:modal_dfc) game:paper -is:extra -is:reversible', 26);
  const splits = await search('(layout:split or layout:adventure or layout:flip) game:paper -is:extra', 14);
  const lines = [...dfcs, ...splits].map((c, i) => {
    const faces = c.name.split(' // ');
    const name = i % 5 === 3 && faces[1] ? faces[1] : i % 5 === 4 ? faces[0] : c.name;
    return `1 ${name}`;
  });
  writeFileSync('test-data/dfc.txt', header('Double-faced, split, adventure and flip cards. Some lines use only one face name.') + lines.join('\n') + '\n');
}

function bad(): void {
  const note = [
    'The unresolved-line path. Should NOT resolve: Lightnig Bolt, Counterspel, Sol Ring (ZZZ) 999,',
    '// Totally Made Up Card, Jace, the Mind Sculpter. Should resolve: the rest, including the',
    "// accent-less Lim-Dul's Vault and the back-face-only Insectile Aberration.",
  ].join('\n');
  const lines = [
    '4 Lightning Bolt',
    '2 Lightnig Bolt',
    '1 Counterspel',
    '1 Sol Ring (ZZZ) 999',
    '1 Black Lotus',
    '1 Totally Made Up Card',
    '3 Jace, the Mind Sculpter',
    "1 Lim-Dul's Vault",
    '1 Fire // Ice',
    '2 Insectile Aberration',
  ];
  writeFileSync('test-data/bad-lines.txt', header(note) + lines.join('\n') + '\n');
}

async function stress(): Promise<void> {
  // 2,000 different cards for the performance budget (spec 17).
  const many = await search('game:paper -is:extra -t:basic -is:reversible', 2000);
  writeFileSync('test-data/stress-2000.txt', header('2,000 different cards for the performance budget.') + many.map((c) => `1 ${c.name}`).join('\n') + '\n');
  console.log(`stress: ${many.length}`);
}

if (want('deck')) await deck();
if (want('dfc')) await dfc();
if (want('bad')) bad();
if (want('stress')) await stress();
console.log('done');
