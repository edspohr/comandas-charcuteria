# ADR-0007 — PIN personal autoasignado, ingreso con correo + PIN y reverificación en acciones clave

- **Estado:** Aceptada
- **Fecha:** 24-10-2026

## Contexto

En la planta y la tienda los teléfonos se comparten. La empresa quiere que cada acción quede a nombre de quien la hizo y que la persona responda por su cuenta. Google o contraseña en cada uso es demasiado lento.

## Decisión

- Cada persona crea su **PIN de 4 dígitos** desde una sesión Google o contraseña (`setOwnPin`) y acepta la declaración de responsabilidad, que queda versionada.
- El PIN se guarda como hash scrypt en `userPins/{uid}`, sin acceso para los clientes.
- Ingreso diario con correo + PIN (`pinLogin` devuelve un *custom token*). El mensaje de error es genérico para no revelar si el correo existe.
- La app se bloquea al abrirla y tras 30 minutos sin uso; se desbloquea con el PIN.
- Las acciones clave piden el PIN y el servidor lo verifica (`verifyPin`, o `checkPin` dentro de las funciones de Bsale). Todo queda en `pinLog`.
- 5 fallos bloquean el PIN 15 minutos; 10 lo desactivan. El superAdmin solo puede **borrar** un PIN.
- El cliente recuerda el PIN 2 minutos para acciones seguidas.

## Consecuencias

- Para la escritura de Firestore que sigue al PIN (anular, vincular, crear pedido), la reverificación es una confirmación iniciada por el cliente: las reglas no exigen un PIN reciente (deuda técnica DT-01).
- Claude no puede ingresar con cuentas reales para pruebas: las pruebas se hacen en staging con usuarios de demo.
