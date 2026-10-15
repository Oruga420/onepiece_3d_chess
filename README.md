# One Piece: Grand Line Chess

Ajedrez 3D personal en el navegador: diez tripulaciones contra la Marina, 66 modelos de personajes texturizados de Meshy y órdenes en español por texto, voz de ElevenLabs y herramientas WebMCP.

El juego aplica reglas de ajedrez estándar. Los poderes de One Piece son efectos de captura; no transforman piezas ni cambian las reglas.

## Jugar

Selecciona tu tripulación, haz clic en una pieza y elige una casilla iluminada. Todas las casillas tienen ID de A1 a H8. El turno inicial corresponde a tu tripulación; la Marina responde automáticamente si la IA está activada. Puedes cambiar dificultad, deshacer y empezar otra partida. Cambiar de tripulación reinicia la partida.

Hay tres vistas seguras: frontal, cenital y opuesta. El zoom tiene límites y el botón de reinicio devuelve la cámara al tablero. No hay desplazamiento libre. Las capturas combinan movimiento del atacante, impacto y desaparición del rival, con modo de movimiento reducido.

## Órdenes en español

El cuadro de texto y la voz usan el mismo registro de acciones del juego. Puedes nombrar una pieza de ajedrez o su personaje:

| Orden | Resultado |
|---|---|
| `Selecciona a Chopper de E2` | Ilumina a Chopper y sus destinos legales. |
| `Mueve a la reina` | Selecciona la reina e ilumina sus movimientos; no adivina un destino. |
| `Mueve el peón de E2 a E4` | Propone el movimiento legal y espera confirmación. |
| `Mueve el alfil a D7` | Propone el movimiento si una pieza puede realizarlo; pide origen si hay ambigüedad. |
| `Sí, confirma` | Confirma la propuesta visible; todavía puedes detener la cuenta atrás. |
| `Alto` | Cancela la orden pendiente y detiene la voz. |
| `Cámara cenital` | Activa una vista segura. |
| `Deshaz el último movimiento` | Propone deshacer la última jugada. |

Los nombres `King` y `Queen` de la tripulación de Kaido se interpretan como personajes. `Rey` y `reina` se interpretan como roles de ajedrez. Las órdenes ambiguas nunca eligen una pieza al azar. La promoción permite reina, torre, alfil y caballo.

Para hablar, abre el orbe de voz, conecta y concede permiso al micrófono. Esta integración opcional utiliza un agente privado de ElevenLabs y confirma las jugadas antes de ejecutarlas.

## Ejecutar localmente

Requiere Node.js 24 y las dependencias del repositorio.

```powershell
npm ci
Copy-Item .env.example .env.local
# Completa .env.local con tus credenciales personales.
node --env-file=.env.local server.js
```

Abre `http://127.0.0.1:3000`. No abras `index.html` directamente: la sesión, los modelos protegidos y las rutas de voz necesitan el servidor.

La contraseña y el secreto de sesión viven en el servidor. Configura una contraseña en `APP_PASSWORD`, un secreto aleatorio largo en `SESSION_SECRET` y el origen exacto en `APP_ORIGIN`. Mantén las credenciales personales fuera del código público.

La voz necesita `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, una base Neon personal en `CHESS_QUOTA_DATABASE_URL` y las reservas de presupuesto. `node --env-file=.env.local scripts/setup-quota.cjs` prepara únicamente el esquema aislado `epic_chess`. La aplicación rechaza emitir sesiones de voz si falta el almacenamiento duradero o la reserva. Una llamada dura como máximo cinco minutos y solo puede haber una activa.

## Verificar

```powershell
npm test
node scripts/verify-perft.mjs
node scripts/verify-assets.mjs --strict
node scripts/verify-quality.mjs
```

Los verificadores de navegador, efectos y WebMCP reciben `--base-url`; usa una sesión autenticada y conserva sus salidas. Las pruebas de voz tienen modos separados para simulación gratuita y llamadas reales al proveedor. Los modos reales requieren credenciales y una reserva de presupuesto. La prueba de producción de acceso usa `DEPLOY_URL`, `APP_PASSWORD` y `EXPECTED_BUILD_SHA` en el entorno.

## Modelos y despliegue

`assets/models/manifest.json` contiene los 66 modelos, proveedor, checksum y revisión. Cada partida reutiliza doce modelos distintos para sus 32 piezas. `vendor/` conserva los módulos fijados de Three.js, GLTFLoader, ElevenLabs y la implementación oficial de WebMCP; el adaptador informa si la ruta es nativa o el polyfill.

El acceso se verifica en el servidor mediante sesión firmada HttpOnly/SameSite, con limitación duradera de intentos y revocación al cerrar sesión. En Vercel, configura los secretos del servidor en las variables del proyecto y conserva las reglas de enrutamiento protegido de `vercel.json`.

Las credenciales de Meshy y Replicate se usan solo durante la preparación local de modelos; no forman parte del servidor del juego. Los reportes, herramientas de generación, evidencia y configuración privada quedan fuera del despliegue.
