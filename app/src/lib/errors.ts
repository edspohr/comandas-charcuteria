// Turn Firestore / Firebase errors into short, user-facing Chilean Spanish
// strings. Passes our own `throw new Error("mensaje en es-CL")` through so
// domain logic can still surface specific messages.
//
// The detail is logged to the console so debugging keeps the original code.

interface FirebaseErrorLike { code?: string; message?: string; }

const CODE_MESSAGE: Record<string, string> = {
  'permission-denied':   'No tiene permisos para realizar esta acción.',
  'failed-precondition': 'La operación no se puede completar en este momento. Puede faltar un índice o el pedido cambió de estado.',
  'unavailable':         'El servicio no está disponible. Verifique su conexión y reintente.',
  'not-found':           'El elemento no existe o fue eliminado.',
  'already-exists':      'Ya existe un registro con esos datos.',
  'aborted':             'La operación se canceló por conflicto de datos. Vuelva a intentarlo.',
  'unauthenticated':     'La sesión expiró. Vuelva a iniciar sesión.',
  'resource-exhausted':  'Cuota temporalmente excedida. Reintente en unos segundos.',
  'cancelled':           'La operación se canceló.',
  'deadline-exceeded':   'La operación tardó demasiado. Verifique su conexión y reintente.',
  'internal':            'Ocurrió un error interno. Reintente y avise si persiste.',
  'invalid-argument':    'Los datos enviados no son válidos.',
};

// Recognisable prefixes we know Firestore emits — we hide the SDK-level
// verbiage and show the friendly line instead.
const SDK_PREFIXES = [
  'Function ',                           // Function Transaction.set() called with…
  'The query requires an index',
  'Missing or insufficient permissions',
];

export function describeFirestoreError(err: unknown): string {
  if (err instanceof Error) {
    console.error('[firestore]', err);
    const code = (err as FirebaseErrorLike).code;
    if (code && CODE_MESSAGE[code]) return CODE_MESSAGE[code];
    const msg = err.message ?? '';
    if (SDK_PREFIXES.some((p) => msg.includes(p))) {
      return 'Ocurrió un error al hablar con la base de datos. Reintente en unos segundos.';
    }
    // Domain-level throws already carry a friendly es-CL string.
    return msg;
  }
  console.error('[firestore]', err);
  return String(err);
}
