import { expect, test } from '@playwright/test';
import packageInfo from '../../package.json' with { type: 'json' };

const { version } = packageInfo;

test('panel inicial honesto, sin resultados inventados', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tu comunidad, de un vistazo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar mi Instagram' })).toBeVisible();
  await expect(page.getByText('Vista previa web.')).toBeVisible();
  await expect(page.locator('.brand-version')).toHaveText(`v${version}`);
  await expect(page.getByText('Tu comunidad, más clara', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/inicio-escritorio.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('la marca muestra la versión instalada del manifiesto, no otra copia del paquete', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { id: 'version-fixture', getManifest: () => ({ version: '9.8.7.6' }) } } });
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.brand-version')).toHaveText('v9.8.7.6');
  await expect(page.locator('.app-footer .version')).toHaveText('v9.8.7.6');
});

test('demo: navegación, búsqueda, filtros, selección y exportaciones completas', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Tu comunidad, de un vistazo' })).toBeVisible();
  await page.screenshot({ path: 'test-results/resumen-escritorio.png', fullPage: true });
  await page.getByRole('navigation').getByRole('button', { name: 'Seguidores perdidos' }).click();
  await expect(page.getByRole('heading', { name: 'Seguidores perdidos', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(14);
  await page.screenshot({ path: 'test-results/seguidores-perdidos-escritorio.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Buscar usuario o nombre' }).fill('lucia');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await page.getByRole('button', { name: 'Privadas', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: /^Todas/ }).click();
  await page.getByRole('checkbox', { name: 'Seleccionar página actual' }).check();
  await expect(page.getByText('14 seleccionadas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar selección' }).click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar CSV' }).click();
  const csvDownload = await csv;
  expect(csvDownload.suggestedFilename()).toContain('seguidores-perdidos');
  await page.getByRole('navigation').getByRole('button', { name: 'No te siguen de vuelta' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('checkbox', { name: 'Seleccionar página actual' }).check();
  await page.getByRole('button', { name: 'Seleccionar las 128' }).click();
  await expect(page.getByText('128 seleccionadas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dejar de seguir', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('128 cuentas seleccionadas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar acción' }).click();
  await expect(page.getByRole('status')).toContainText('Modo demostración');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Historial' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('navigation').getByRole('button', { name: 'Exportar datos' }).click();
  const excel = page.waitForEvent('download');
  await page.getByRole('button', { name: 'XLSX', exact: true }).first().click();
  expect((await excel).suggestedFilename()).toContain('.xlsx');
  await page.getByRole('navigation').getByRole('button', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Motor de escaneo' })).toBeVisible();
});

test('layout móvil sin desbordamiento global y navegación accesible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Tu comunidad, de un vistazo' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Seguidores perdidos' }).click();
  await expect(page.getByRole('heading', { name: 'Seguidores perdidos', exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/seguidores-perdidos-movil.png', fullPage: true });
});
