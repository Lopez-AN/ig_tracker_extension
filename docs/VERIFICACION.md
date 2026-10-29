# Verificación de la entrega

## Comprobado localmente

- TypeScript sin errores y compilación de producción con Vite/esbuild.
- **51 pruebas unitarias**: comparaciones por ID, cambios de nombre, aislamiento entre cuentas, modificaciones posteriores a capturas, más de 50 resultados, deduplicación, cursores, listas incompletas, recuentos ausentes/discrepantes, espera exponencial y cabeceras malformadas. Incluyen la selección del usuario correcto en datos web de arranque, ausencia de secretos en el perfil normalizado y espera específica para 429.
- Persistencia IndexedDB: confirmación atómica de capturas, cancelación/pausa durante verificación, actualizaciones concurrentes y eliminación limitada a una cuenta.
- CSV/XLSX completos con Unicode, escape de XML/comillas y protección frente a fórmulas de hojas de cálculo.
- **17 pruebas de navegador** con Playwright, incluyendo la extensión MV3 real instalada en **Chromium / Chrome for Testing**. Todas las respuestas de Instagram se interceptan y simulan, sin acceso a cuentas reales.
- Auditoría npm: **0 vulnerabilidades** en las dependencias de la entrega.
- Artefactos generados: `dist/` y `release/ig-tracker-1.0.1.zip`, con manifiesto, scripts, interfaz, iconos e instrucciones.

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

Capturas de pantalla generadas al ejecutar estas pruebas:

- `test-results/inicio-escritorio.png`
- `test-results/resumen-escritorio.png`
- `test-results/seguidores-perdidos-escritorio.png`
- `test-results/seguidores-perdidos-movil.png`
- `test-results/conexion-limitada.png`

## Pendiente con tu sesión

**No se probó Instagram en vivo**, por decisión acordada: no se dejó una sesión para utilizar durante el desarrollo. No se realizaron acciones reales de seguir, dejar de seguir ni eliminar seguidores.

La instalación y las APIs de extensión se verificaron en Chromium. El manifiesto utiliza APIs compartidas con Chrome y Edge (MV3, mínimo Chromium 120), pero no se certificó una instalación interactiva en ambos navegadores del usuario.

Para la primera prueba real:

1. Carga `dist/` desde la página de extensiones de Chrome o Edge.
2. Abre Instagram y conecta tu sesión desde IG Tracker.
3. Haz un escaneo completo; comprueba que los recuentos coincidan con el perfil.
4. Más adelante, repite el escaneo para obtener cambios reales.
5. Si deseas verificar acciones, empieza por una sola cuenta y confirma el resultado en Instagram.

Las pruebas simuladas no prueban que Instagram mantenga estas interfaces ni permiten prometer un tiempo real de escaneo o ausencia de restricciones. Si exige verificación o limita solicitudes, se conserva el avance y no se registra una captura incompleta.
