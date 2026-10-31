import { expect, test } from '@playwright/test';

// feature search (#461): Strg+K or the toolbar button, type, Enter – the function opens
test('Funktionssuche findet Bereich, Werkzeug und Ansicht', async ({ page }) => {
  await page.goto('/?e2e');
  await expect(page.locator('.app[data-ready="true"]')).toBeVisible();

  await page.getByRole('button', { name: 'Funktion suchen' }).click();
  const field = page.getByRole('combobox', { name: 'Funktion suchen' });
  await expect(field).toBeFocused();
  await field.fill('heizkosten');
  await expect(page.getByRole('option').first()).toContainText('Heizkosten');
  await field.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Funktion suchen' })).toBeHidden();
  await expect(page.locator('.panel.right .tabs button.active')).toHaveText('Projekt');
  await expect(page.locator('.panel.right .panel-section', { hasText: 'Heizkosten (grobe Schätzung)' }).first()).toBeInViewport();

  // keyboard: Strg+K, umlaut-free spelling, arrow down + Enter
  await page.locator('body').click({ position: { x: 5, y: 880 } });
  await page.keyboard.press('Control+k');
  await field.fill('kuche');
  await expect(page.getByRole('option', { name: /Küche/ }).first()).toBeVisible();
  await field.press('Enter');
  await expect(page.locator('.panel.left .tabs button.active')).toHaveText('Küche');

  await page.keyboard.press('Control+k');
  await field.fill('wand zeichnen');
  await field.press('Enter');
  await expect(page.locator('.panel.left .tabs button.active')).toHaveText('Werkzeuge');
  await expect(page.locator('.tool-btn.active')).toContainText('Wand');

  await page.keyboard.press('Control+k');
  await field.fill('nur 3d');
  await field.press('Enter');
  await expect(page.locator('.workspace.view-3d')).toBeVisible();

  // Esc closes without doing anything
  await page.keyboard.press('Control+k');
  await field.press('Escape');
  await expect(field).toBeHidden();
});
