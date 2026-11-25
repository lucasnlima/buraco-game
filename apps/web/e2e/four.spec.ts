import { expect, test } from '@playwright/test';

test('4 jogadores em duplas: parceiro identificado, 3 adversários na mesa', async ({ browser }) => {
  const names = ['Ana', 'Bruno', 'Carla', 'Diego'];
  const pages = [];
  let code = '';
  for (const [i, name] of names.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByLabel(/Seu nome/).fill(name + 'Q');
    if (i === 0) {
      await page.getByRole('button', { name: 'Criar sala' }).click();
      code = (await page.getByTestId('room-code').textContent())!.trim();
    } else {
      await page.getByLabel('Código da sala').fill(code);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.getByTestId('room-code')).toHaveText(code);
    }
    pages.push(page);
  }
  await expect(pages[0]!.getByText('Dupla A').first()).toBeVisible();
  await pages[0]!.getByRole('button', { name: /Iniciar partida/ }).click();
  for (const p of pages) await expect(p.locator('[data-card-id]')).toHaveCount(11);
  await expect(pages[0]!.getByTestId('opp-2')).toContainText('parceiro');
  await expect(pages[0]!.locator('[data-testid^=opp-]')).toHaveCount(3);
  await pages[0]!.screenshot({ path: 'test-results/mesa-4p.png' });
});
