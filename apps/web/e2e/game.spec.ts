import { type Browser, type Page, expect, test } from '@playwright/test';

async function enter(browser: Browser, name: string) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel(/Seu nome/).fill(name);
  return { ctx, page };
}

const turnLabel = (p: Page) => p.getByTestId('turn-label');

test('criar sala, 2º jogador entra, iniciar e jogar uma vez', async ({ browser }) => {
  const a = await enter(browser, 'Ana');
  await a.page.getByRole('button', { name: 'Criar sala' }).click();
  const code = (await a.page.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);

  const b = await enter(browser, 'Bia');
  await b.page.getByLabel('Código da sala').fill(code);
  await b.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(b.page.getByTestId('room-code')).toHaveText(code);

  // mesmo nome em outro dispositivo (token diferente) é recusado
  const c = await enter(browser, 'ana');
  await c.page.getByRole('button', { name: 'Criar sala' }).click();
  await expect(c.page.getByRole('alert')).toContainText('já está em uso');

  await a.page.getByRole('button', { name: /Iniciar partida/ }).click();
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId('hand')).toBeVisible();
    await expect(p.locator('[data-card-id]')).toHaveCount(11);
  }

  // quem tem a vez compra e descarta
  const mine = (await turnLabel(a.page).textContent())!.includes('Sua vez') ? a.page : b.page;
  const other = mine === a.page ? b.page : a.page;
  await expect(turnLabel(mine)).toContainText('Sua vez');
  await mine.getByTestId('stock').click();
  await expect(mine.locator('[data-card-id]')).toHaveCount(12);
  await mine.locator('[data-card-id]').first().tap();
  await mine.getByTestId('discard-btn').click();
  await expect(mine.locator('[data-card-id]')).toHaveCount(11);
  await expect(turnLabel(other)).toContainText('Sua vez');
  await expect(other.getByTestId('discard')).toContainText('Lixo · 1');

  // sem rolagem horizontal da página
  const overflow = await mine.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // reconexão: recarregar volta à mesma partida
  await other.reload();
  await expect(other.getByTestId('hand')).toBeVisible();
  await expect(other.locator('[data-card-id]')).toHaveCount(11);

  // arrastar uma carta até o lixo (descartar por drag & drop)
  await other.getByTestId('stock').click();
  const card = other.locator('[data-card-id]').first();
  const box = (await card.boundingBox())!;
  const dest = (await other.getByTestId('discard').boundingBox())!;
  await other.mouse.move(box.x + 10, box.y + 20);
  await other.mouse.down();
  await other.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 8 });
  await other.mouse.up();
  await expect(other.locator('[data-card-id]')).toHaveCount(11);
  await expect(other.getByTestId('discard')).toContainText('Lixo · 2');

  await a.page.screenshot({ path: 'test-results/mesa-mobile.png' });
  await a.ctx.close();
  await b.ctx.close();
  await c.ctx.close();
});
