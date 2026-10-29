# IG Tracker

Extensión independiente para **Chrome y Edge**, en español, con analítica local de Instagram y un diseño oscuro azul/violeta con acentos fucsias. Implementación original; no incluye código ni recursos de InsTF.

## Instalar la versión compilada

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Modo de desarrollador** → **Cargar descomprimida**.
3. Selecciona **`dist/`** (no la raíz del repositorio).
4. Abre Instagram, inicia sesión y pulsa el icono de IG Tracker.
5. **Conectar Instagram** → **Nuevo escaneo** → **Escaneo completo**.

También se genera **`release/ig-tracker-1.0.4.zip`**. Extráelo antes de cargarlo. Instrucciones detalladas: [docs/INSTALACION.txt](docs/INSTALACION.txt).

### Actualizar desde una versión anterior

Pulsa **Recargar** en la tarjeta de IG Tracker de la página de extensiones y recarga también las pestañas de Instagram y del panel. Si instalaste desde un ZIP en otra carpeta, sustituye sus archivos por los del ZIP nuevo antes de recargar. No desinstales la extensión: así conservas su almacenamiento.

La versión 1.0.1 elimina la identificación mediante `accounts/current_user`, prioriza la identidad ya cargada en la sesión web y muestra un diagnóstico persistente si Instagram rechaza la comprobación. Un 429 al conectar no se confunde con un escaneo iniciado ni con avance guardado.

La versión 1.0.2 corrige los botones bloqueados tras una acción individual fallida, recupera los lotes antiguos sin pendientes al reiniciar la extensión y solo confirma un unfollow si Instagram indica que ya no sigues a la cuenta ni tienes una solicitud pendiente. El progreso y los controles del lote permanecen visibles al desplazarte; los errores aparecen también en la fila. El icono «Eliminar de tus seguidores» solo aparece para cuentas que te siguen: no es otro botón de unfollow.

La versión 1.0.3 sustituye el unfollow REST antiguo, que puede devolver HTML con HTTP 200, por la mutación web `usePolarisUnfollowMutation`. Los tokens permanecen en la pestaña de Instagram; si faltan se pide recargar sin enviar la acción. También se reconoce JSON con el prefijo protector de Meta. No se reenvían las acciones anteriores de resultado incierto ni se prueba una segunda ruta después de enviar una mutación.

La versión 1.0.4 aplica la mutación web también a «Seguir». Distingue el seguimiento confirmado de una solicitud pendiente a una cuenta privada. Bajo el nombre de la aplicación aparece la versión instalada, en lugar de «Tu comunidad, más clara».

## Funciones

- Seguidores perdidos y nuevos, nuevos seguidos, relaciones no correspondidas, seguidores mutuos y listas completas.
- Escaneo completo o solo de seguidores; progreso, pausa, reanudación y cancelación.
- Historial separado por cuenta, sin cuotas comerciales.
- Búsqueda, filtros de privacidad, ordenación, paginación y selección de todas las coincidencias.
- Seguir, dejar de seguir y eliminar seguidores, individualmente o en lotes confirmados.
- Exportaciones **CSV, XLSX y JSON completas**; exportación de selecciones o de listas enteras.
- Ajustes de tamaño de página, velocidad, filas e imágenes.
- Modo demostración explícito, sin solicitudes a Instagram ni modificaciones reales.

**No hay suscripción, login adicional, servidor propio, telemetría ni restricciones Free/Pro.** Los límites de Instagram y la capacidad del dispositivo siguen existiendo.

## Desarrollo

Requiere Node.js 22.12+ y npm.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run dev` permite explorar la interfaz; no conecta Instagram desde una página web. Usa el botón de demostración o `http://127.0.0.1:5173/?demo=1`.

`npm run build` comprueba TypeScript, compila la interfaz y los scripts MV3, genera iconos originales y empaqueta `dist/` y el ZIP. No requiere credenciales. No se publican cambios en servicios externos.

### Fuente de la versión

**`package.json` es la única fuente de versión para compilar.** El build combina `scripts/manifest.template.json` (sin versión duplicada) con el campo `version` del paquete y genera `dist/manifest.json`. Chrome toma su versión de ese manifiesto, no de `package.json` ni de `.version` directamente.

El panel muestra `chrome.runtime.getManifest().version`, tanto bajo el nombre como en el pie, para reflejar la extensión realmente instalada. La vista previa web utiliza la versión de `package.json`. El archivo `.version` no participa en la compilación y no se modifica. Referencia: [Chrome runtime.getManifest](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getManifest).

## Arquitectura

- `src/ui/`: panel React y estilos adaptables; todos los recursos ejecutables son locales.
- `src/extension/content.ts`: puente aislado dentro de Instagram, origen único de las solicitudes autenticadas. No comunica cookies ni tokens al panel ni los persiste.
- `src/extension/background.ts`: coordinación de trabajos, control de sesión, límites adaptativos y alarmas de recuperación MV3.
- `src/core/`: contratos internos, comparación por identificador, validación de paginación, IndexedDB y exportación segura.
- `tests/`: pruebas locales, visuales y de integración con respuestas de Instagram simuladas.
- [docs/CONTRATO.md](docs/CONTRATO.md): operaciones, errores y límites de verificación.

El panel puede cerrarse sin perder el avance. Cada página se guarda de forma transaccional; al terminar se guardan la captura y sus metadatos junto con el estado del trabajo en una única transacción. Una acción por lote se marca antes de enviarla: si el proceso termina sin confirmar su resultado, se considera **incierta** y no se repite. Las capturas históricas son inmutables; los resultados de acciones posteriores se guardan por separado.

## Precisión y limitaciones

- **El primer escaneo es la referencia.** No puede reconstruir pérdidas anteriores. Para nuevos seguidos hacen falta dos escaneos completos.
- Una cuenta ausente puede haber dejado de seguirte, haberse desactivado/eliminado o haberte bloqueado. La fecha indica detección, no la fecha exacta del cambio.
- Los cursores son secuenciales: no se hacen peticiones paralelas con cursores inventados. Se evitan búsquedas de perfil por cada usuario y se cargan las fotos bajo demanda.
- No existe un contrato público estable para estas listas. El adaptador usa interfaces web de la sesión del usuario; Instagram puede rechazarlas, cambiarlas, pedir verificaciones o restringir la cuenta. Respeta sus condiciones. No hay promesa de un tiempo fijo ni de riesgo cero.
- Ante 429 durante un escaneo se aplica espera exponencial y hasta cuatro reintentos de lectura, mostrando el próximo reintento. Sin `Retry-After`, la espera inicial es de al menos un minuto. Antes de conectar o iniciar el trabajo, un 429 produce un diagnóstico persistente y exige confirmación manual después de la espera; no se repite la petición por cada pestaña abierta. La espera no garantiza que Instagram haya retirado la restricción.
- Ante verificación, cursor repetido, duplicación sospechosa, recuentos no disponibles o discrepancias de recuentos se pausa sin sustituir la referencia válida.
- Las listas no son una transacción atómica de Instagram. Si cambian mientras se escanea, la validación de recuentos puede exigir otro intento. Recuentos iguales no prueban que no haya habido intercambios simultáneos de seguidores.
- Las acciones requieren confirmación expresa, son secuenciales y no se reintentan automáticamente. Si Instagram no confirma una relación, revisa el resultado en su web. No se ejecutaron acciones contra cuentas reales durante el desarrollo.
- Los datos no se sincronizan entre navegadores/dispositivos. Cada perfil tiene su IndexedDB. El almacenamiento no está cifrado por una contraseña propia; depende de la seguridad del perfil del navegador.
- Solo se accede a tus cuentas con sesión disponible. No se incluye el análisis de perfiles ajenos ni escaneos programados de analítica; las alarmas son únicamente para recuperar trabajos iniciados manualmente.

## Permisos

| Permiso | Uso |
| --- | --- |
| `https://www.instagram.com/*` | Puente de sesión y solicitudes solo a Instagram |
| `scripting` | Reinstalar el puente si Instagram estaba abierto antes de instalar/actualizar |
| `storage` | Avisos de actualización del panel |
| `unlimitedStorage` | Historial local sin la cuota estándar; sujeto a espacio disponible |
| `alarms` | Recuperar trabajos manuales tras suspensión del service worker |

Las fotos se cargan directamente desde CDN de Instagram/Meta cuando están habilitadas. No se solicita acceso a cookies mediante la API `chrome.cookies`, contraseñas, historial global, identidad Google ni dominios de terceros.

## Comprobaciones

Consulta **[docs/VERIFICACION.md](docs/VERIFICACION.md)** para los resultados reales de la entrega. Las pruebas simuladas no certifican la compatibilidad actual de los endpoints ni la velocidad real con una sesión de Instagram. Esa comprobación requiere tu sesión al volver.
