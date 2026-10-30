import { describe, expect, it } from 'vitest';
import { basicLine, defaultBasics, filterPrintings, isBasicName, readBasics, type Printing } from '../src/state/basics';

const p = (name: string, set: string, setName: string, number: string): Printing => ({ name, set, setName, number, foil: true });

describe('basic lands (decision 210)', () => {
  it('starts with the Zendikar full-art basics', () => {
    const b = defaultBasics();
    expect(basicLine(b.Plains)).toBe('Plains (ZEN) 230');
    expect(basicLine(b.Forest)).toBe('Forest (ZEN) 246');
    expect(b.Island.foil).toBe(false);
  });

  it('reads a table file, falling back to the defaults for anything wrong', () => {
    const b = readBasics({
      Island: { name: 'Snow-Covered Island', set: 'KHM', number: '279', foil: true },
      Swamp: { name: 'Island', set: 'lea', number: '1' },
      Forest: 'nonsense',
    });
    expect(b.Island).toEqual({ name: 'Snow-Covered Island', set: 'khm', number: '279', foil: true });
    expect(b.Swamp).toEqual(defaultBasics().Swamp);
    expect(b.Forest).toEqual(defaultBasics().Forest);
    expect(readBasics(undefined)).toEqual(defaultBasics());
  });

  it('knows a basic and its snow-covered twin', () => {
    expect(isBasicName('Island', 'island')).toBe(true);
    expect(isBasicName('Island', 'Snow-Covered Island')).toBe(true);
    expect(isBasicName('Island', 'Plains')).toBe(false);
  });

  it('filters printings by every word typed', () => {
    const list = [p('Plains', 'zen', 'Zendikar', '230'), p('Plains', 'lea', 'Limited Edition Alpha', '288'), p('Snow-Covered Plains', 'khm', 'Kaldheim', '276')];
    expect(filterPrintings(list, 'zen').map((x) => x.set)).toEqual(['zen']);
    expect(filterPrintings(list, 'alpha').map((x) => x.set)).toEqual(['lea']);
    expect(filterPrintings(list, 'snow kald').map((x) => x.set)).toEqual(['khm']);
    expect(filterPrintings(list, '(LEA) 288').map((x) => x.set)).toEqual(['lea']);
    expect(filterPrintings(list, '')).toHaveLength(3);
    expect(filterPrintings(list, 'Plains (ZEN) 230', 'Plains (ZEN) 230')).toHaveLength(3);
  });
});
