import { expect, test } from '@playwright/test';

for (const bots of [1, 3]) {
  test(`treino contra o computador (${bots} bot${bots > 1 ? 's' : ''}): joga rodadas sem servidor`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel(/Seu nome/).fill('Treino');
    await page.getByRole('combobox').selectOption(String(bots));
    await page.getByTestId('play-local').click();
    await expect(page.locator('[data-card-id]')).toHaveCount(11);
    await expect(page.locator('[data-testid^=opp-]')).toHaveCount(bots);

    for (let round = 0; round < 3; round++) {
      await expect(page.getByTestId('turn-label')).toContainText('Sua vez', { timeout: 30_000 });
      await page.getByTestId('stock').click();
      await page.locator('[data-card-id]').first().tap();
      await page.getByTestId('discard-btn').click();
    }
    // adversários jogaram (lixo cresceu e o monte diminuiu mais que as minhas compras)
    const stock = await page.getByTestId('stock').textContent();
    expect(Number(/(\d+)$/.exec(stock!)![1])).toBeLessThan(bots === 1 ? 60 - 3 : 38 - 3);
    await page.screenshot({ path: `test-results/local-${bots}.png` });
  });
}
