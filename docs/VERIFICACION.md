# Verificación de la entrega

## Comprobado localmente

- TypeScript sin errores y compilación de producción con Vite/esbuild.
- **105 pruebas unitarias**: comparaciones por ID, cambios de nombre, aislamiento entre cuentas, modificaciones posteriores a capturas, más de 50 resultados, deduplicación, cursores, listas incompletas, recuentos ausentes/discrepantes, espera exponencial y cabeceras malformadas. Incluyen la selección del usuario correcto en datos web de arranque, ausencia de secretos en el perfil normalizado, espera específica para 429 y comprobaciones de confirmación de acciones. En 1.0.5 se reproduce 808/809, se acota el margen admitido y se comprueba que las discrepancias se persisten y no generan falsas ausencias ni altas al recuperar perfiles omitidos.
- Persistencia IndexedDB: confirmación atómica de capturas, cancelación/pausa durante verificación, actualizaciones concurrentes y eliminación limitada a una cuenta.
- CSV/XLSX completos con Unicode, escape de XML/comillas y protección frente a fórmulas de hojas de cálculo.
- **43 pruebas de navegador** con Playwright, incluyendo la extensión MV3 real instalada en **Chromium / Chrome for Testing**. Todas las respuestas de Instagram se interceptan y simulan, sin acceso a cuentas reales.
- Auditoría npm de la entrega anterior: **0 vulnerabilidades**; no se han cambiado dependencias ni repetido la auditoría en esta corrección.
- Artefactos generados: `dist/` y `release/ig-tracker-1.0.5.zip`, con manifiesto, scripts, interfaz, iconos e instrucciones. El manifiesto se genera desde la plantilla y la versión de `package.json`.

Comando reproducible: `npm run check`. El ZIP se genera con `npm run build`.

## Qué cubren las pruebas de navegador

1. Conectar una sesión simulada, paginar seguidores/seguidos, guardar y comparar capturas, detectar 60 pérdidas y exportar las 60 sin recorte.
2. Pausar durante una petición, recargar el panel, reanudar sin volver al primer cursor y cancelar sin crear historial.
3. Recuperarse de 429 y rechazar una descarga truncada sin sustituir una captura válida.
4. Detectar cursores repetidos y pausar sin inventar pérdidas.
5. No reintentar una acción de resultado incierto; continuar exclusivamente las pendientes.
6. Detener y reiniciar el service worker con CDP; conservar el avance y recuperar un lote interrumpido como incierto.
7. Usar la alternativa de perfil de sesión y bajar a páginas de 50 si Instagram rechaza páginas mayores.
8. Rechazar una captura cuando faltan recuentos verificables.
9. Rechazar comandos de control originados en el contexto web de Instagram.
10. Aceptar una cuenta con cero seguidores y verificar por separado seguir, dejar de seguir y eliminar seguidores, sin modificar capturas históricas.
11. Mostrar el estado inicial sin datos inventados.
12. Navegar la demostración, buscar, filtrar, seleccionar 128 cuentas, confirmar una acción simulada y descargar CSV/Excel.
13. Comprobar el layout y la navegación a 390 px, sin desbordamiento global.
14. Conectar desde la identidad ya cargada sin consultas de identificación y exigir recuentos nuevos al terminar el escaneo.
15. Reproducir el fallo 429 antes de empezar: diagnóstico persistente tras recargar, ausencia de un escaneo ficticio, respeto de la espera y sin repetir por cada pestaña abierta.
16. Si el 429 no incluye `Retry-After`, conservar al menos un minuto de espera sin reintento automático de conexión.
17. Tratar la consulta web de perfil como lectura: conservar páginas descargadas, mostrar cuándo se reintenta y terminar al recuperarse de un 429 en validación.
18. Ejecutar unfollow desde el botón y la confirmación reales del panel; mostrar progreso visible al desplazarse, quitar la fila tras confirmación y enviar una sola mutación.
19. Rechazar un unfollow sin efecto (`following: true`), mostrar el error y desbloquear los botones sin alterar la captura ni la relación local.
20. Tratar una relación ausente como resultado incierto, sin repetirla al recargar o continuar.
21. Tratar una interrupción de red como resultado incierto, con el mismo desbloqueo seguro.
22. Mostrar ruta saneada y HTTP 403 ante un rechazo, sin credenciales y sin éxito falso.
23. Mantener visible un lote pausado con pendientes; cancelar libera los botones sin enviar las cuentas restantes.
24. Ofrecer eliminar seguidores únicamente para cuentas que te siguen; esa acción no modifica tu seguimiento.
25. Recuperar un lote antiguo pausado sin pendientes al reiniciar el worker, sin reenviar la acción incierta.
26. Reproducir HTTP 200 con HTML durante una mutación; mostrarlo como incierto, sin exponer el cuerpo ni probar la ruta antigua.
27. Rechazar errores GraphQL incluso con una relación parcial, sin mostrar sus mensajes en bruto ni modificar la relación local.
28. Reconocer JSON protegido con `for (;;);` y la variante `xdt_instagram_api__v1__friendships__unfollow__update`, con una sola mutación web.
29. No enviar ninguna mutación si faltan los tokens web; pedir recargar Instagram y conservar la relación anterior.
30. Seguir una cuenta pública desde la fila y su confirmación, mostrando progreso y confirmando una sola mutación web sin usar create REST.
31. Seguir una cuenta privada muestra «Solicitud enviada» y conserva `following: false`; no permite reenviar una solicitud pendiente, tampoco tras recargar.
32. Rechazar un follow sin seguimiento ni solicitud, sin éxito falso ni relación local inventada.
33. Tratar una respuesta de follow sin relación como incierta, con botones desbloqueados y sin reintento automático.
34. Conservar como incierto un follow interrumpido por un error de red.
35. Mostrar el rechazo HTTP de un follow sin afirmar que se haya completado.
36. Reproducir el HTML con HTTP 200 del follow, sin mostrar el cuerpo ni probar otra mutación.
37. Rechazar errores GraphQL de follow, incluso con datos parciales que aparenten éxito.
38. No enviar ninguna mutación de follow si faltan los tokens web ni usar create REST como alternativa.
39. La versión del lateral y del pie coincide con el manifiesto instalado en Chromium y con la versión fuente del paquete.
40. La vista previa utiliza el paquete; una prueba con manifiesto simulado distinto comprueba que una extensión instalada prioriza su versión real.
41. Reproducir 808 seguidores recuperados frente a 809 en el perfil: finalizar con aviso persistente, permitir exportar los 808, liberar los controles y no presentar pérdidas o relaciones no confirmadas como cero. Repetir la observación y recuperar la cuenta omitida sin sustituir la referencia válida ni inventar altas.
42. Una diferencia de seguidos bloquea «No sigues de vuelta» y muestra relaciones ausentes como «Sin comprobar», conservando coincidencias mutuas observadas.
43. Reanudar un trabajo antiguo pausado en validación por 808/809 sin repetir la descarga.

Desde 1.0.3, el simulador hace fallar expresamente el unfollow REST antiguo con HTML y HTTP 200; desde 1.0.4 también rechaza create REST. Las pruebas de éxito exigen la mutación `/api/graphql` y comprueban documento, nombre, destino, tokens y cabeceras. Así, una simulación complaciente de las rutas antiguas ya no puede ocultar estos fallos. Las capturas del usuario son evidencia de sus fallos reales; el usuario también confirmó el unfollow real de 1.0.3. El agente solo ha ejecutado mutaciones contra el simulador.

Capturas de pantalla generadas al ejecutar estas pruebas:

- `test-results/inicio-escritorio.png`
- `test-results/resumen-escritorio.png`
- `test-results/seguidores-perdidos-escritorio.png`
- `test-results/seguidores-perdidos-movil.png`
- `test-results/conexion-limitada.png`
- `test-results/unfollow-progreso.png`
- `test-results/unfollow-error.png`
- `test-results/lote-en-pausa.png`
- `test-results/seguir-solicitud-privada.png`
- `test-results/escaneo-diferencia-recuentos.png`

## Pendiente con tu sesión

**El agente no probó Instagram en vivo**: no se utilizó una sesión real durante el desarrollo ni se realizaron acciones reales desde las herramientas. El usuario sí confirmó el funcionamiento del unfollow de 1.0.3; queda pendiente comprobar el follow y la recuperación del escaneo 808/809 con su propia sesión. La captura del usuario prueba el bloqueo anterior, pero no permite deducir la causa de la discrepancia del contador.

La instalación y las APIs de extensión se verificaron en Chromium. El manifiesto utiliza APIs compartidas con Chrome y Edge (MV3, mínimo Chromium 120), pero no se certificó una instalación interactiva en ambos navegadores del usuario.

Para la primera prueba real:

1. Carga `dist/` desde la página de extensiones de Chrome o Edge.
2. Abre Instagram y conecta tu sesión desde IG Tracker.
3. Haz un escaneo completo; comprueba que los recuentos coincidan con el perfil.
4. Más adelante, repite el escaneo para obtener cambios reales.
5. Si deseas verificar acciones, empieza por una sola cuenta y confirma el resultado en Instagram.

Las pruebas simuladas no prueban que Instagram mantenga estas interfaces ni permiten prometer un tiempo real de escaneo o ausencia de restricciones. Si exige verificación o limita solicitudes, se conserva el avance y no se registra una captura incompleta.
