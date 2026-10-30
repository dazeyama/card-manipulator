import { describe, expect, it } from 'vitest';
import { wantsTokens, withoutExtras } from '../src/scryfall/search';
import { tokenName, tokenQuery } from '../src/scryfall/tokens';

describe('tokens (decision 263)', () => {
  it('turns what is typed into a token search', () => {
    expect(tokenQuery('treasure')).toBe('t:token name:"treasure"');
    expect(tokenQuery('goblin 1/1')).toBe('t:token name:"goblin" pow=1 tou=1');
    expect(tokenQuery('Soldier token')).toBe('t:token name:"Soldier"');
    expect(tokenQuery('  ')).toBeNull();
  });

  it('reads a list line as a token name', () => {
    expect(tokenName('Goblin Token')).toBe('Goblin');
    expect(tokenName('Treasure')).toBe('Treasure');
  });

  it('lets tokens into a query that asks for them', () => {
    expect(wantsTokens('t:token c:r')).toBe(true);
    expect(wantsTokens('is:token')).toBe(true);
    expect(wantsTokens('type:"token creature"')).toBe(true);
    expect(wantsTokens('t:goblin')).toBe(false);
    expect(withoutExtras('t:token')).toBe('(t:token)');
    expect(withoutExtras('t:goblin')).toBe('(t:goblin) -is:extra');
  });
});
