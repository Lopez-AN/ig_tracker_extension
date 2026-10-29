import { DEFAULT_SETTINGS, type Account, type AppState, type Snapshot, type User } from '../core/types';

const names = [
  ['lucia.martin', 'Lucía Martín'], ['david.creativo', 'David Romero'], ['sofia.viaja', 'Sofía Fernández'],
  ['carlos.design', 'Carlos García'], ['elena.visual', 'Elena Torres'], ['marcos.foto', 'Marcos Alonso'],
  ['valeria.studio', 'Valeria López'], ['pablo.andres', 'Pablo Andrés'], ['natalia.art', 'Natalia Ruiz'],
  ['andrea.costa', 'Andrea Costa'], ['daniel.rivas', 'Daniel Rivas'], ['paula.norte', 'Paula Navarro'],
  ['miguel.crea', 'Miguel Santos'], ['clara.rios', 'Clara Ríos'], ['sergio.wav', 'Sergio Vidal'],
];

function user(i: number): User {
  const [username, fullName] = names[i % names.length];
  return { id: String(10000 + i), username: `${username}${i < names.length ? '' : `_${i}`}`, fullName, avatar: '', isPrivate: i % 5 === 2, isVerified: i % 11 === 0 };
}

export function demoState(): AppState {
  const now = Date.now();
  const people = Array.from({ length: 1600 }, (_, i) => user(i));
  const account: Account = { id: '42', username: 'maria.creativa', fullName: 'María García', avatar: '', isPrivate: false, isVerified: false, followerCount: 1284, followingCount: 648, connectedAt: now };
  const previousFull: Snapshot = { id: 'demo-anterior', accountId: '42', startedAt: now - 3 * 86400000, completedAt: now - 3 * 86400000 + 62000, mode: 'full', followers: people.slice(0, 1290), following: [...people.slice(120, 640), ...people.slice(1320, 1440)], requests: 20 };
  const latest: Snapshot = { id: 'demo-actual', accountId: '42', startedAt: now - 34 * 60000, completedAt: now - 33 * 60000, mode: 'full', followers: people.slice(14, 1298), following: [...people.slice(120, 640), ...people.slice(1320, 1448)], requests: 20 };
  return { accounts: [account], activeId: '42', history: [latest, previousFull].map(item => ({ ...item, followers: item.followers.length, following: item.following!.length })), latest, previous: previousFull, full: latest, previousFull, scan: null, batch: null, overrides: [], settings: { ...DEFAULT_SETTINGS } };
}

export function emptyState(): AppState {
  return { accounts: [], activeId: null, history: [], latest: null, previous: null, full: null, previousFull: null, scan: null, batch: null, overrides: [], settings: { ...DEFAULT_SETTINGS } };
}
