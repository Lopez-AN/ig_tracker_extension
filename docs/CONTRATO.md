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
- `POST /api/graphql`, mutación `usePolarisUnfollowMutation`, document ID `27789106940691111`: dejar de seguir. Variables: `target_user_id`, `container_module: profile` y `nav_chain` del perfil. Incluye `av`, `fb_dtsg`, `lsd`, `jazoest` y, solo si la página la publica, la revisión del cliente. Se exige CSRF y ambos tokens web antes de enviar; no se almacenan ni se devuelven al panel.
- `POST /api/graphql`, mutación `usePolarisFollowMutation`, document ID `26508036048874888`: seguir. Comparte con unfollow la envoltura web de sesión y las variables del destino. Se valida exclusivamente `data.xdt_create_friendship.friendship_status`: `following: true` confirma seguimiento, mientras que `following: false` y `outgoing_request: true` confirman solo una solicitud pendiente.
- `POST friendships/remove_follower/{id}/`: eliminar seguidores, sin cambios en esta corrección.

El unfollow ya no usa `friendships/destroy/{id}/`: la sesión del usuario devolvió una respuesta no JSON con HTTP 200. El contrato web de reemplazo está corroborado por [cobanov/instagram](https://github.com/cobanov/instagram/blob/main/src/instagram-unfollower.js), que documenta el abandono de las rutas REST antiguas en octubre de 2026. Se reutilizan los metadatos del protocolo, no su implementación. No es una API oficial ni se ha comprobado esta mutación con una cuenta real durante el desarrollo.

Se aceptan las respuestas `data.xdt_destroy_friendship.friendship_status` y `data.xdt_instagram_api__v1__friendships__unfollow__update.friendship_status`. Los errores GraphQL, incluso acompañados por datos parciales, no se consideran éxito ni se muestran en bruto. Una respuesta sin relación confirmada queda incierta. No hay fallback REST ni segunda mutación tras un error; tampoco se reenvían las acciones inciertas previas a la actualización.

Desde 1.0.4, seguir tampoco usa `friendships/create/{id}/`, que devolvió HTML con HTTP 200 en la sesión del usuario. El documento de follow, su nombre y el campo de respuesta se corroboraron en el paquete público InsTF 6.1.26 (extensión `deppcpikimfefmjmdpalknbdfmhdlein`). Solo se reutilizan metadatos del protocolo, no código ni tokens de ese paquete. `src/core/instagram-friendship.ts` mantiene ambos contratos web y conserva sin cambios el documento, las variables y la validación del unfollow ya confirmado por el usuario. Las pruebas de desarrollo siguen usando respuestas simuladas, no acciones reales.

El decodificador acepta objetos JSON, con o sin el prefijo protector `for (;;);`, sin evaluar código. Un HTML con HTTP 200 sigue siendo un resultado incierto para una mutación, con diagnóstico explícito y sin revelar el cuerpo. Una redirección a verificación se reconoce como `CHALLENGE` antes de intentar leer JSON.

No se consulta `accounts/current_user`: esa comprobación adicional podía terminar con 429 antes de crear el escaneo. Solo se cambia al endpoint alternativo ante formato no admitido o rechazo de la consulta; nunca para eludir 429, inicio de sesión, verificación o bloqueo. Si Instagram deja de admitir una operación, se informa del fallo en lugar de afirmar un éxito. Los tokens de arranque permanecen en el origen de Instagram y no se incluyen en diagnósticos.

## Reglas de captura

1. El ID de Instagram, no el nombre de usuario, identifica a una persona.
2. La deduplicación admite solapamientos entre páginas; cursores repetidos y páginas enteramente repetidas son errores.
3. Solo una lista terminada se considera completa. El fin no se infiere por recibir menos usuarios que el tamaño solicitado.
4. Antes de publicar una captura, se vuelven a consultar los recuentos. Si no están disponibles, se pausa. Con todas las páginas terminadas se permite una diferencia de hasta `max(1, min(5, floor(recuento * 0.01)))` cuentas, salvo si el contador o la lista son cero. Una diferencia mayor sigue siendo `COUNT_MISMATCH` y no genera historial. Este margen permite usar los datos observados, pero no certifica que la lista sea íntegra.
5. Un trabajo pausado, cancelado o incompleto nunca genera una captura de historial.
6. El estado, la captura y los metadatos finales se confirman transaccionalmente. El historial no cambia cuando se ejecuta una acción posterior.
7. Los escaneos de solo seguidores no actualizan las listas históricas de seguidos; la UI muestra su antigüedad.
8. Las diferencias admitidas se guardan por lista como `Snapshot.countDiscrepancies` y se conservan también en `SnapshotMeta`. Las capturas antiguas sin ese campo siguen siendo referencias validadas, porque antes solo se guardaban con coincidencia exacta. No se inventan perfiles para cuadrar un contador.
9. Una lista con diferencias nunca prueba ausencias: seguidores discrepantes impiden confirmar pérdidas y «No te siguen de vuelta»; seguidos discrepantes impiden «No sigues de vuelta». Las cuentas observadas, las coincidencias mutuas y las incorporaciones respecto de una referencia validada siguen disponibles. La UI distingue «sin confirmar» de cero resultados y no exporta categorías sin confirmar.
10. `previous` y `previousFull` seleccionan la última referencia anterior validada de seguidores y de seguidos, respectivamente, omitiendo observaciones discrepantes de esa lista. Así no se generan altas falsas cuando reaparecen perfiles omitidos. No se mutan ni se borran las capturas anteriores. Reanudar un trabajo antiguo pausado en `verify` aplica estas mismas reglas sin volver a descargar sus páginas.

## Estados

Escaneo: `running → paused/completed/cancelled`; `paused → running/cancelled`. El avance se conserva en cada página. Las alarmas MV3 recuperan trabajos, no inician analíticas nuevas.

Lote: cada cuenta pasa de `pending → sending → succeeded/failed/unknown`. Una interrupción en `sending` se recupera como `unknown`. Un fallo o resultado incierto pausa el lote solo si quedan cuentas pendientes; en caso contrario lo finaliza con errores, liberando los botones. La última acción confirmada finaliza el lote sin esperar el intervalo entre acciones. Continuar procesa solo pendientes, nunca repite desconocidos. Repetir una acción exige selección y confirmación nuevas. Al reiniciar se finalizan los lotes antiguos pausados sin pendientes, sin enviar solicitudes.

Un unfollow solo se considera confirmado con `friendship_status.following: false` y sin `outgoing_request: true`. Una respuesta reconocida que conserva el seguimiento o una solicitud es `REJECTED`, no un éxito. Un follow debe confirmar seguimiento o solicitud. Si falta una relación reconocida, el resultado sigue siendo `UNKNOWN_ACTION`. No se guardan modificaciones locales para resultados rechazados o inciertos.

El lote puede conservar `failure: ErrorInfo` con código, estado HTTP y ruta saneada, sin cuerpos de respuesta ni credenciales. Su progreso y controles son visibles al desplazarse; cada fila muestra su espera o error. Eliminar seguidores solo se ofrece para IDs presentes en la lista actual de seguidores, incluidas las modificaciones confirmadas posteriores al escaneo.

## Errores principales

| Código | Recuperación |
| --- | --- |
| `LOGIN`, `CHALLENGE` | Completar sesión/verificación en Instagram y reanudar |
| `ACCOUNT_CHANGED` | Seleccionar la sesión correcta; no mezclar cuentas |
| `RATE_LIMIT` | Durante el escaneo: espera exponencial y `Retry-After`, máximo cuatro reintentos antes de pausar. En conexión/preparación: estado persistente, cuenta atrás y confirmación manual; no se prueba cada pestaña ni se repite durante la espera |
| `NETWORK` | Lecturas: reintento limitado con avance persistente |
| `REJECTED` | Si se rechaza `count > 50` con 400, probar 50 una vez; otros casos pausan |
| `CURSOR`, `INCOMPLETE`, `COUNT_MISMATCH`, `COUNT_UNAVAILABLE` | Cancelar e iniciar nueva captura; no producir falsos cambios con listas truncadas, diferencias grandes o sin recuentos verificables. Las diferencias pequeñas admitidas ya no son errores bloqueantes: finalizan con metadatos y aviso |
| `UNKNOWN_ACTION` | Revisar Instagram antes de repetir; no hay reintento automático |
| `TAB` | Abrir/recargar Instagram y reanudar |

Los errores pueden incluir `endpoint` (solo la ruta, sin parámetros, con IDs sustituidos por `:id`). `AppState.connectionIssue` conserva el fallo previo al inicio y, para un 429, `retryAt`. El mensaje genérico de un 429 no afirma que exista un trabajo ni avance guardado: ese contexto solo se añade si hay un escaneo real.

## Evidencia

Las respuestas simuladas prueban nuestro código, no el servicio de Instagram. No se usa una cuenta real en las pruebas de entrega. No se promete exactitud frente a una lista que cambia mientras se descarga ni un tiempo fijo de escaneo.
