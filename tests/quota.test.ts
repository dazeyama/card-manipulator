import { describe, expect, it } from 'vitest';
import { isQuotaError } from '../server/src/quota';
import { MAX_BANS, MAX_SEATS, addBan, makeRoomForSeat, newMeta, type Seat } from '../server/src/meta';

describe('quota errors', () => {
  it('knows the free plan saying no for the day', () => {
    expect(isQuotaError(new Error('Exceeded allowed volume of requests in Durable Objects free tier.'))).toBe(true);
    expect(isQuotaError(new Error('Exceeded allowed rows written in Durable Objects free tier'))).toBe(true);
    expect(isQuotaError(new Error('Worker exceeded the daily limit'))).toBe(true);
    expect(isQuotaError('Your account is over its quota')).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isQuotaError(new Error('Network connection lost.'))).toBe(false);
    expect(isQuotaError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError({ message: 'quota' })).toBe(false);
  });
});

function seat(id: string, connected: boolean): Seat {
  return { id, nickname: id, colour: '', rank: 'move', side: 0, connected, joinedAt: 0 };
}

describe('seat and ban caps', () => {
  it('has room for a new seat while under the cap', () => {
    const m = newMeta('7KQ2MX', 'maker', 'T', 'cube', 0);
    m.seats.push(seat('a', false));
    expect(makeRoomForSeat(m, new Set())).toBe(true);
    expect(m.seats.length).toBe(1);
  });

  it('at the cap, the longest-away seat goes, but not the maker\'s, the crown\'s or a stand owner\'s', () => {
    const m = newMeta('7KQ2MX', 'maker', 'T', 'cube', 0);
    m.seats.push(seat('maker', false), seat('crown', false), seat('owner', false), seat('gone', false));
    for (let i = m.seats.length; i < MAX_SEATS; i++) m.seats.push(seat(`p${i}`, true));
    m.crown = 'crown';
    expect(makeRoomForSeat(m, new Set(['owner']))).toBe(true);
    expect(m.seats.map((s) => s.id).slice(0, 4)).toEqual(['maker', 'crown', 'owner', 'p4']);
    expect(m.seats.length).toBe(MAX_SEATS - 1);
  });

  it('at the cap with nobody who can go, there is no room', () => {
    const m = newMeta('7KQ2MX', 'maker', 'T', 'cube', 0);
    for (let i = 0; i < MAX_SEATS; i++) m.seats.push(seat(`p${i}`, true));
    expect(makeRoomForSeat(m, new Set())).toBe(false);
  });

  it('keeps the last MAX_BANS bans, once each', () => {
    const m = newMeta('7KQ2MX', 'maker', 'T', 'cube', 0);
    addBan(m, 'x');
    addBan(m, 'x');
    expect(m.bans).toEqual(['x']);
    for (let i = 0; i < MAX_BANS + 5; i++) addBan(m, `b${i}`);
    expect(m.bans.length).toBe(MAX_BANS);
    expect(m.bans[0]).toBe('b5');
  });
});
