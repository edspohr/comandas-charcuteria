import { useSyncExternalStore } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// PIN personal para acciones que escriben en Bsale o son importantes
// (functions/src/pin.ts). El servidor lo exige; la app lo pide con un
// diálogo global (<PinPrompt/> en AppShell) y reintenta. Se recuerda en
// memoria 2 minutos para no pedirlo dos veces en la misma acción.

interface PromptState { open: boolean; reason: string; error?: string; resolve?: (pin: string | null) => void }
let state: PromptState = { open: false, reason: '' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function usePinPrompt(): PromptState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

function requestPin(reason: string, error?: string): Promise<string | null> {
  return new Promise((resolve) => {
    state = { open: true, reason, error, resolve: (pin) => { state = { open: false, reason: '' }; emit(); resolve(pin); } };
    emit();
  });
}

const CACHE_MS = 2 * 60_000;
let cached: { pin: string; at: number } | null = null;
export const forgetPin = () => { cached = null; };
// A PIN just verified (app unlock) also covers the next key action.
export const rememberPin = (pin: string) => { cached = { pin, at: Date.now() }; };

interface PinError { code?: string; message?: string; details?: { pin?: 'required' | 'invalid' | 'locked' | 'unset' } }
const pinState = (e: unknown) => (e as PinError)?.details?.pin;

export class PinCancelled extends Error { constructor() { super('Acción cancelada: no se ingresó el PIN.'); } }

// Runs `call`, asking for the PIN when the server requires it.
export async function withPin<T>(reason: string, call: (pin?: string) => Promise<T>): Promise<T> {
  let pin = cached && Date.now() - cached.at < CACHE_MS ? cached.pin : undefined;
  let error: string | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await call(pin);
      if (pin) cached = { pin, at: Date.now() };
      return r;
    } catch (e) {
      const s = pinState(e);
      if (s !== 'required' && s !== 'invalid') throw e;
      if (s === 'invalid') { cached = null; error = (e as PinError).message; }
      const entered = await requestPin(reason, error);
      if (!entered) throw new PinCancelled();
      pin = entered;
    }
  }
  throw new Error('Demasiados intentos de PIN.');
}

const verifyFn = httpsCallable<{ action: string; ref?: string; pin?: string }, { ok: true }>(functions, 'verifyPin');

// Important actions that run in the app (anular, vincular, despachar sin
// factura, salidas): confirm the person's PIN on the server first.
export async function confirmPin(action: string, reason: string, ref?: string): Promise<void> {
  // Without a remembered PIN, ask first: saves a round trip to the server.
  if (!(cached && Date.now() - cached.at < CACHE_MS)) {
    const entered = await requestPin(reason);
    if (!entered) throw new PinCancelled();
    cached = { pin: entered, at: Date.now() }; // cleared by withPin if the server rejects it
  }
  await withPin(reason, (pin) => verifyFn({ action, ref, pin }));
}

// Mirrors functions/src/pin.ts (the server checks the version).
export const RESPONSIBILITY_VERSION = 'v1-2026-10-24';
export const RESPONSIBILITY_TEXT = 'Declaro que este PIN es personal e intransferible y que todo lo que se haga con mi cuenta y con mi PIN en Comandas es de mi plena responsabilidad.';

const setOwnFn = httpsCallable<{ pin: string; accept: boolean; version: string }, { ok: true }>(functions, 'setOwnPin');
export async function setOwnPin(pin: string) { await setOwnFn({ pin, accept: true, version: RESPONSIBILITY_VERSION }); rememberPin(pin); }

const resetFn = httpsCallable<{ uid: string }, { ok: true }>(functions, 'adminResetPin');
export async function resetUserPin(uid: string) { await resetFn({ uid }); }

export async function unlockWithPin(pin: string) { await verifyFn({ action: 'desbloqueo', pin }); rememberPin(pin); }
