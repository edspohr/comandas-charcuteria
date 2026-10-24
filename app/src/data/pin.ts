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
  await withPin(reason, (pin) => verifyFn({ action, ref, pin }));
}

const setPinFn = httpsCallable<{ uid: string; pin: string }, { ok: true }>(functions, 'adminSetPin');
export async function setUserPin(uid: string, pin: string) { await setPinFn({ uid, pin }); }
