import { describe, expect, it } from 'vitest';
import { codeFromText, followPageHost, inviteLink, isRoomCode, pageBase, parseHash, roomHash, roomLink, socketUrl } from '../src/online/link';

const BASE = 'https://dazeyama.github.io/card-manipulator/';

describe('room links', () => {
  it('knows a room code by its alphabet and length', () => {
    expect(isRoomCode('7KQ2MX')).toBe(true);
    expect(isRoomCode('7KQ2M')).toBe(false);
    expect(isRoomCode('7KQ2MXX')).toBe(false);
    // No 0, O, 1, I or L.
    for (const bad of ['0KQ2MX', 'OKQ2MX', '1KQ2MX', 'IKQ2MX', 'LKQ2MX', '7kq2mx']) expect(isRoomCode(bad)).toBe(false);
  });

  it('reads a room from the hash, with or without its key', () => {
    expect(parseHash('#/room/7KQ2MX')).toEqual({ kind: 'room', code: '7KQ2MX' });
    expect(parseHash('#/room/7kq2mx')).toEqual({ kind: 'room', code: '7KQ2MX' });
    expect(parseHash('#/room/7KQ2MX?key=door%20code')).toEqual({ kind: 'room', code: '7KQ2MX', key: 'door code' });
    expect(parseHash('#/room/7KQ2MX?other=1')).toEqual({ kind: 'room', code: '7KQ2MX' });
  });

  it('reads the admin page, and nothing from anything else', () => {
    expect(parseHash('#/admin')).toEqual({ kind: 'admin' });
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#/room/')).toBeNull();
    expect(parseHash('#/room/NOPE00')).toBeNull();
    expect(parseHash('#/rooms/7KQ2MX')).toBeNull();
  });

  it('builds the share link and the invite link, which round-trip', () => {
    expect(roomLink('7KQ2MX', BASE)).toBe(`${BASE}#/room/7KQ2MX`);
    const invite = inviteLink('7KQ2MX', 'p&ss word', BASE);
    expect(invite).toBe(`${BASE}#/room/7KQ2MX?key=p%26ss%20word`);
    expect(parseHash(invite.slice(invite.indexOf('#')))).toEqual({ kind: 'room', code: '7KQ2MX', key: 'p&ss word' });
    expect(parseHash(roomHash('7KQ2MX'))).toEqual({ kind: 'room', code: '7KQ2MX' });
  });

  it('leaves the dev-only ?player= query out of shared links', () => {
    expect(pageBase({ origin: 'http://localhost:5176', pathname: '/' })).toBe('http://localhost:5176/');
  });

  it('finds a code in whatever was pasted', () => {
    expect(codeFromText(' 7kq 2mx ')).toEqual({ kind: 'room', code: '7KQ2MX' });
    expect(codeFromText('7KQ-2MX')).toEqual({ kind: 'room', code: '7KQ2MX' });
    expect(codeFromText(`${BASE}#/room/7KQ2MX?key=abc`)).toEqual({ kind: 'room', code: '7KQ2MX', key: 'abc' });
    expect(codeFromText('hello')).toBeNull();
    expect(codeFromText(`${BASE}#/admin`)).toBeNull();
  });

  it('turns the server address into the room socket address', () => {
    expect(socketUrl('7KQ2MX', 'http://localhost:8787')).toBe('ws://localhost:8787/api/rooms/7KQ2MX/ws');
    expect(socketUrl('7KQ2MX', 'https://card-manipulator-rooms.example.workers.dev')).toBe('wss://card-manipulator-rooms.example.workers.dev/api/rooms/7KQ2MX/ws');
    expect(socketUrl('7KQ2MX', null)).toBeNull();
  });
});

describe('LAN mode', () => {
  it('finds a room server on this machine at the host the page came from', () => {
    expect(followPageHost('http://localhost:8787', '192.168.8.190')).toBe('http://192.168.8.190:8787');
    expect(followPageHost('http://127.0.0.1:8787', 'mypc.local')).toBe('http://mypc.local:8787');
  });

  it('leaves a page on this machine, and a remote server, as they are', () => {
    expect(followPageHost('http://localhost:8787', 'localhost')).toBe('http://localhost:8787');
    expect(followPageHost('http://localhost:8787', '127.0.0.1')).toBe('http://localhost:8787');
    expect(followPageHost('https://card-manipulator-rooms.example.workers.dev', '192.168.8.190')).toBe('https://card-manipulator-rooms.example.workers.dev');
    expect(followPageHost('not a url', '192.168.8.190')).toBe('not a url');
  });
});
