// Duplicate of the seed users list so the Login screen can render tiles
// without hitting Firestore before auth. Kept in sync manually — the seed
// script is the source of truth.
import type { Role } from '@/domain/types';

export interface DemoUser {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
}

export const DEMO_PASSWORD = 'demo1234';

export const demoUsers: DemoUser[] = [
  { uid: 'u-rafael',    displayName: 'Rafael',    email: 'rafael@charcuteria.demo',    role: 'vendedor' },
  { uid: 'u-ramiro',    displayName: 'Ramiro',    email: 'ramiro@charcuteria.demo',    role: 'vendedor' },
  { uid: 'u-gabriela',  displayName: 'Gabriela',  email: 'gabriela@charcuteria.demo',  role: 'vendedor' },
  { uid: 'u-juan',      displayName: 'Juan',      email: 'juan@charcuteria.demo',      role: 'vendedor' },
  { uid: 'u-tania',     displayName: 'Tania',     email: 'tania@charcuteria.demo',     role: 'vendedor' },
  { uid: 'u-elizabeth', displayName: 'Elizabeth', email: 'elizabeth@charcuteria.demo', role: 'vendedor' },
  { uid: 'u-lucy',      displayName: 'Lucy',      email: 'lucy@charcuteria.demo',      role: 'vendedor' },
  { uid: 'u-edu',       displayName: 'Edu',       email: 'edu@charcuteria.demo',       role: 'despacho' },
  { uid: 'u-morena',    displayName: 'Morena',    email: 'morena@charcuteria.demo',    role: 'despacho' },
  { uid: 'u-yuri',      displayName: 'Yuri',      email: 'yuri@charcuteria.demo',      role: 'produccion' },
  { uid: 'u-miguel',    displayName: 'Miguel',    email: 'miguel@charcuteria.demo',    role: 'admin' },
  { uid: 'u-ciro',      displayName: 'Ciro',      email: 'ciro@charcuteria.demo',      role: 'superAdmin' },
  { uid: 'u-luis',      displayName: 'Luis',      email: 'luis@charcuteria.demo',      role: 'superAdmin' },
];
