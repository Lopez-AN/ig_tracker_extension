# Contrato del adaptador y trabajos

Esta extensión no publica una API HTTP ni necesita un workspace remoto. Los contratos reutilizables viven en `src/core/types.ts`; el adaptador y sus errores se comprueban con peticiones interceptadas en las pruebas. No se guardan credenciales en colecciones, fixtures ni repositorio.

## Puente de Instagram

Solo recibe `IG_TRACKER_BRIDGE` desde el ID de la propia extensión. No escucha `window.postMessage` ni acepta URLs arbitrarias.

| Operación | Entrada | Salida |
| --- | --- | --- |
| `session` | Cuenta esperada opcional y `refresh` | Perfil de la sesión, ID y recuentos enteros o `null`; `refresh: true` fuerza recuentos de red para validar la captura |
| `list` | Cuenta propia, `followers`/`following`, cursor, 50/100/200 | Usuarios normalizados, siguiente cursor, fin de lista |
| `action` | Cuenta propia, ID destino, `follow`/`unfollow`/`removeFollower` | Relación confirmada o error |

Las solicitudes solo van a `https://www.instagram.com/api/v1/…` y `https://www.instagram.com/api/graphql`, con `credentials: include`, CSRF del origen y tiempo de espera de 20 segundos. La sesión se comprueba antes y después; los errores se traducen sin guardar cuerpos de respuestas con información sensible.

Interfaces observadas en el paquete público de referencia, **no una API oficial garantizada**:

- Datos JSON ya cargados en Instagram, seleccionados exclusivamente por el ID de sesión: identidad sin una petición de identificación adicional.
- `POST /api/graphql`, consulta **de lectura** `PolarisProfilePageContentQuery`: perfil y recuentos frescos. El adaptador usa el document ID `26672929172408668`, observado en InsTF 6.1.26. Instagram puede invalidarlo sin aviso.
- `GET users/{id}/info/`: alternativa cuando no hay datos web de arranque o la consulta web no es admitida.
- `GET friendships/{id}/followers/?count=…&max_id=…`: página de seguidores.
- `GET friendships/{id}/following/?count=…&max_id=…`: página de seguidos.
- `POST friendships/create/{id}/`, `destroy/{id}/`, `remove_follower/{id}/`: cambios de relación.

No se consulta `accounts/current_user`: esa comprobación adicional podía terminar con 429 antes de crear el escaneo. Solo se cambia al endpoint alternativo ante formato no admitido o rechazo de la consulta; nunca para eludir 429, inicio de sesión, verificación o bloqueo. Si Instagram deja de admitir una operación, se informa del fallo en lugar de afirmar un éxito. Los tokens de arranque permanecen en el origen de Instagram y no se incluyen en diagnósticos.

## Reglas de captura

1. El ID de Instagram, no el nombre de usuario, identifica a una persona.
2. La deduplicación admite solapamientos entre páginas; cursores repetidos y páginas enteramente repetidas son errores.
3. Solo una lista terminada se considera completa. El fin no se infiere por recibir menos usuarios que el tamaño solicitado.
4. Antes de publicar una captura, se vuelven a consultar los recuentos. Deben estar disponibles y coincidir exactamente con los IDs únicos descargados; si faltan, se pausa sin guardar una captura no validada.
5. Un trabajo pausado, cancelado o incompleto nunca genera una captura de historial.
6. El estado, la captura y los metadatos finales se confirman transaccionalmente. El historial no cambia cuando se ejecuta una acción posterior.
7. Los escaneos de solo seguidores no actualizan las listas históricas de seguidos; la UI muestra su antigüedad.

## Estados

Escaneo: `running → paused/completed/cancelled`; `paused → running/cancelled`. El avance se conserva en cada página. Las alarmas MV3 recuperan trabajos, no inician analíticas nuevas.

Lote: cada cuenta pasa de `pending → sending → succeeded/failed/unknown`. Una interrupción en `sending` se recupera como `unknown` y pausa el lote. Continuar procesa solo pendientes, nunca repite desconocidos. Repetir una acción exige selección y confirmación nuevas.

## Errores principales

| Código | Recuperación |
| --- | --- |
| `LOGIN`, `CHALLENGE` | Completar sesión/verificación en Instagram y reanudar |
| `ACCOUNT_CHANGED` | Seleccionar la sesión correcta; no mezclar cuentas |
| `RATE_LIMIT` | Durante el escaneo: espera exponencial y `Retry-After`, máximo cuatro reintentos antes de pausar. En conexión/preparación: estado persistente, cuenta atrás y confirmación manual; no se prueba cada pestaña ni se repite durante la espera |
| `NETWORK` | Lecturas: reintento limitado con avance persistente |
| `REJECTED` | Si se rechaza `count > 50` con 400, probar 50 una vez; otros casos pausan |
| `CURSOR`, `INCOMPLETE`, `COUNT_MISMATCH`, `COUNT_UNAVAILABLE` | Cancelar e iniciar nueva captura; no producir falsos cambios con listas truncadas o sin recuentos verificables |
| `UNKNOWN_ACTION` | Revisar Instagram antes de repetir; no hay reintento automático |
| `TAB` | Abrir/recargar Instagram y reanudar |

Los errores pueden incluir `endpoint` (solo la ruta, sin parámetros, con IDs sustituidos por `:id`). `AppState.connectionIssue` conserva el fallo previo al inicio y, para un 429, `retryAt`. El mensaje genérico de un 429 no afirma que exista un trabajo ni avance guardado: ese contexto solo se añade si hay un escaneo real.

## Evidencia

Las respuestas simuladas prueban nuestro código, no el servicio de Instagram. No se usa una cuenta real en las pruebas de entrega. No se promete exactitud frente a una lista que cambia mientras se descarga ni un tiempo fijo de escaneo.
