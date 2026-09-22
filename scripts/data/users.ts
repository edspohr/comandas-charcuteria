import type { Role } from '../../app/src/domain/types.ts';

export interface SeedUser {
  uid: string;
  displayName: string;
  email: string;
  password: string;
  role: Role;
}

// Contraseñas de demo publicadas en README. Solo emuladores/proyecto de demo.
const PWD = 'demo1234';

export const users: SeedUser[] = [
  { uid: 'u-rafael',    displayName: 'Rafael',    email: 'rafael@charcuteria.demo',    password: PWD, role: 'vendedor' },
  { uid: 'u-ramiro',    displayName: 'Ramiro',    email: 'ramiro@charcuteria.demo',    password: PWD, role: 'vendedor' },
  { uid: 'u-gabriela',  displayName: 'Gabriela',  email: 'gabriela@charcuteria.demo',  password: PWD, role: 'vendedor' },
  { uid: 'u-juan',      displayName: 'Juan',      email: 'juan@charcuteria.demo',      password: PWD, role: 'vendedor' },
  { uid: 'u-tania',     displayName: 'Tania',     email: 'tania@charcuteria.demo',     password: PWD, role: 'vendedor' },
  { uid: 'u-elizabeth', displayName: 'Elizabeth', email: 'elizabeth@charcuteria.demo', password: PWD, role: 'vendedor' },
  { uid: 'u-lucy',      displayName: 'Lucy',      email: 'lucy@charcuteria.demo',      password: PWD, role: 'vendedor' },
  { uid: 'u-edu',       displayName: 'Edu',       email: 'edu@charcuteria.demo',       password: PWD, role: 'armador' },
  { uid: 'u-morena',    displayName: 'Morena',    email: 'morena@charcuteria.demo',    password: PWD, role: 'armador' },
  { uid: 'u-yuri',      displayName: 'Yuri',      email: 'yuri@charcuteria.demo',      password: PWD, role: 'produccion' },
  { uid: 'u-miguel',    displayName: 'Miguel',    email: 'miguel@charcuteria.demo',    password: PWD, role: 'admin' },
  { uid: 'u-ciro',      displayName: 'Ciro',      email: 'ciro@charcuteria.demo',      password: PWD, role: 'admin' },
  { uid: 'u-luis',      displayName: 'Luis',      email: 'luis@charcuteria.demo',      password: PWD, role: 'admin' },
];
