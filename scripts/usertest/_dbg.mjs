import { chromium } from '@playwright/test';
import { pdfOf, roomWalls, symbols } from './scenarios/_pdf.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await (await b.newContext({ baseURL: 'http://localhost:4180', viewport:{width:1440,height:900} })).newPage();
await page.goto('/?e2e'); await page.locator('input.project-name').waitFor(); await page.waitForTimeout(800);
await page.getByRole('button', { name: '2D', exact: true }).click();
await page.locator('.panel.left').getByRole('button', { name: 'Import' }).click();
const chooser = page.waitForEvent('filechooser');
await page.locator('.dropzone').click();
await (await chooser).setFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdfOf([...roomWalls(), ...symbols.socket(1.0,0.3), ...symbols.water(4,0.3)]) });
await page.getByText('Vektorzeichnung').waitFor({ timeout: 15000 });
const btn = page.getByRole('button', { name: 'Aus Angabe übernehmen' }); if (await btn.count()) await btn.click();
await page.evaluate(() => window.__wp.useProjectStore.getState().apply((d) => void ((d.underlay.calibrated = true), (d.underlay.scaleSource = 'reference'))));
await page.getByRole('button', { name: 'Erkennung starten' }).click();
await page.getByText('Import prüfen').waitFor({ timeout: 25000 });
const row = page.locator('.panel li', { hasText: /Steckdose/ });
console.log('rows', await row.count());
try { await row.first().getByRole('button').click({ timeout: 5000 }); console.log('clicked'); } catch (e) { console.log(String(e.message).slice(0, 1500)); }
await b.close();
