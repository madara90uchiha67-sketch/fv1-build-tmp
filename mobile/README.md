# Founder — app móvil Android (nativa, Expo + React Native)

> **Estado N0 (19 nov 2026).** Esta es la app Android principal de Founder: interfaz nativa propia, sin TWA, sin Chrome y sin WebView. Las pantallas de Inicio, Negocio, Chat, Laboratorio, Notas, Estrategia, Historial y Cuenta ya existen (las secciones más abajo que dicen lo contrario están desactualizadas). Faltan, por orden: N1 (adjuntos, memoria, reto diario, insights, push), N2 (voz en tiempo real completa), N3 (Google Play Billing), N4 (pruebas y accesibilidad).

## Compilación de prueba (GitHub Actions)
Workflow `.github/workflows/android-nativa.yml` (rama `feat/founder-nativa-expo`): `expo prebuild` → firma de release con la clave de prueba (secretos `FOUNDER_KEYSTORE_*`, nunca en el repositorio) → APK + AAB → verificación de firma/SDK → comprobación de que es nativa (sin `androidbrowserhelper`, sin `react-native-webview`, con Hermes y bundle JS embebido) → prueba de humo en emulador Android 14 (la actividad en primer plano debe ser `inc.founder/.MainActivity`, no Chrome). El artefacto es `founder-nativa-release`.

## Inicio de sesión y base de datos
La app usa `/api/mobile/auth/*`, que depende de la tabla `MobileSession`. Comprobación de solo lectura del 19 nov 2026: la tabla existe en la base de producción (con filas), por lo que el login móvil no debería estar bloqueado por esa migración. No se aplicó ni se modificó nada en Supabase. El login real con cuenta aún no se ha probado en un dispositivo.

Cliente móvil en español con Expo Router, React Native y TypeScript. Consume el backend Next.js existente del repositorio; no incorpora un backend ni pagos/suscripciones dentro de la app.

## Desarrollo local

Requiere Node.js compatible con Expo SDK 57 y npm 10.9.9.

```bash
cd mobile
npm ci
cp .env.example .env  # opcional: define EXPO_PUBLIC_API_URL si no usarás la URL predeterminada
npm run android        # inicia Expo para abrirlo en Android
npm run typecheck
```

No ejecutes `expo install --fix`: las versiones están fijadas y el lockfile es la fuente reproducible. Para comprobarlas usa `npx expo install --check`.

## Comprobaciones realizadas

En la rama de reparación se verificó una instalación limpia (`npm ci`), `npm run typecheck`, `npx expo install --check`, `npx expo export --platform android --no-minify` y `npm audit --audit-level=low` (0 vulnerabilidades). La exportación de `dist/` produjo el bundle JavaScript Android; no es el instalador AAB.

Smoke HTTP no destructivo al backend/sitio de producción: `/legal/terminos`, `/legal/privacidad` y `/account-deletion` respondieron 200; endpoints privados de sesión y negocio respondieron 401 sin credenciales; el registro con datos inválidos respondió 400. No se creó ninguna cuenta ni se modificaron datos. La inspección del código indica que el registro exige `agreed: true` y no bloquea por verificación de correo. La migración de sesiones móviles existe en el repositorio; no se ha aplicado en producción.

## Builds Android con EAS

Los perfiles de `eas.json` están configurados para APK interno (`preview`) y Android App Bundle (`production`). El identificador Android configurado por decisión del titular es `inc.founder` (derivado de `founder.inc`); el nombre mostrado de la app sigue siendo **Founder**. El identificador es una clave técnica, no el nombre destacado para el público; puede ser visible en enlaces de Play y herramientas técnicas, y debe mantenerse estable tras publicar.

Proyecto EAS vinculado: [`@founderinc/founder`](https://expo.dev/accounts/founderinc/projects/founder), ID `a51fa749-9f12-4cbb-a756-cd655d03a9a0`.

```bash
npx eas build --platform android --profile preview
npx eas build --platform android --profile production
```

Build EAS Android de producción completado: ID `d2497669-db20-4226-bd1e-1572eb3f388c`, app version `1.0.0`, versionCode `1`, en [EAS Build](https://expo.dev/accounts/founderinc/projects/founder/builds/d2497669-db20-4226-bd1e-1572eb3f388c). El AAB se firmó con credenciales remotas EAS; se verificó la firma CMS, el digest del manifiesto, los 1.380 SHA-256 de entradas y la integridad ZIP. SHA-256: `21dce075357404dff806e752785855a581cd24e6df41f1c0700fc67651bb727f`.

Build EAS de prueba Android completado: ID `dc400a5f-f5f8-427e-abc0-eacb3c7f4b6a`, perfil `preview`, distribución interna, paquete `inc.founder`, versión `1.0.0` (build `1`), basado en `cbc86cf`. [Abrir página EAS / instalar en Android](https://expo.dev/accounts/founderinc/projects/founder/builds/dc400a5f-f5f8-427e-abc0-eacb3c7f4b6a); el artefacto alojado por EAS expira el 28 de noviembre de 2026. El APK descargado tiene 104.404.044 bytes y pasó la prueba de integridad ZIP; SHA-256: `254c4a52256140cba242c90c5acac4f00621994b29222d351312dc6d5718a506`. Ningún artefacto se subió a Google Play. El APK aún no se ha probado en un dispositivo físico.

## Integración y límites por probar

| Área | Rutas usadas por la app |
|---|---|
| Sesión y acceso | `/api/mobile/auth/{login,refresh,logout,me}`, `/api/auth/register`, `/api/auth/forgot-password`, `/api/auth/reset-password` |
| Resumen y gestión | `/api/business/summary`, `/api/business/{sales,customers,products}` |
| Chat e historial | `/api/chat` (streaming), `/api/conversations`, `/api/conversations/[id]` |
| Estrategia y cuenta | `/api/strategist`, `/api/settings`, `/api/account/delete` |

Los tokens se almacenan con `expo-secure-store`; no hay secretos de servidor en la app. El titular no dispone de staging, así que quedan pendientes las pruebas de autenticación real con la migración `MobileSession`, flujos autenticados de negocio/chat/estrategia, recuperación de acceso y eliminación con cuenta de prueba; no aplicar la migración ni ejecutar escrituras en producción como sustituto. También quedan pendientes la revisión en dispositivo físico y accesibilidad/TalkBack.

Las notificaciones push del backend no están integradas en esta versión. El flujo de preferencias no puede mostrar valores actuales preseleccionados porque el backend no los devuelve. El correo configurado en el backend coincide con el contacto mostrado por la app, pero no se verificó que el buzón se supervise como canal de soporte.

El ícono de la app utiliza `public/brand/yama-icon-1024.png`; el primer plano adaptativo es un recorte temporal y convendría sustituirlo por el vector original si está disponible. Identidad visual: tema oscuro/cálido con acento coral `#F29580`, Instrument Serif para títulos e Inter para texto.


## Estado de preparación — revisión del 15 de noviembre de 2026

La rama `fix/app-movil-android` sigue separada de `main`. En una instalación limpia de esta revisión pasaron `npm run typecheck`, `npx expo install --check` y `npm audit --audit-level=low` (0 vulnerabilidades). La exportación Android estándar intenta ejecutar el compilador Hermes x86-64, incompatible con el entorno ARM64 de esta verificación; con `--no-bytecode` sí se generó el bundle JavaScript Android, pero eso no es un APK/AAB ni sustituye un build nativo.

La app **todavía no está lista para publicar** por brechas funcionales observables en el árbol móvil actual: hay cuatro pestañas (Inicio, Negocio, Chat y Cuenta), pero no están implementadas las secciones/rutas de Laboratorio, Notas ni Reto diario; tampoco existe flujo de adjuntos ni dictado de voz en este cliente. No hay suite de pruebas automatizadas en `package.json`. El APK de preview documentado no se ha instalado ni validado en un dispositivo físico y no demuestra accesibilidad TalkBack.

Siguen sin poder validarse los flujos autenticados de negocio, chat, laboratorio y cuenta: no hay entorno/cuenta de staging disponible y no se deben hacer escrituras, borrados ni aplicar la migración de sesiones móviles en producción como sustituto. Las suscripciones/pagos y cualquier configuración propia de Play Console quedan fuera de esta revisión.
