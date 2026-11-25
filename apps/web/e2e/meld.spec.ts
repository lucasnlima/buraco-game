import { expect, test } from '@playwright/test';

// Servidor de dev com baralho fixo: a 1ª jogadora recebe A♠ 2♠ 3♠ … J♠.
test('baixar sequência, adicionar tocando e arrastando, descartar', async ({ browser }) => {
  const mk = async (name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByLabel(/Seu nome/).fill(name);
    return { ctx, page };
  };
  const a = await mk('Mel');
  await a.page.getByRole('button', { name: 'Criar sala' }).click();
  const code = (await a.page.getByTestId('room-code').textContent())!.trim();
  const b = await mk('Nico');
  await b.page.getByLabel('Código da sala').fill(code);
  await b.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(b.page.getByTestId('room-code')).toHaveText(code);
  await a.page.getByRole('button', { name: /Iniciar partida/ }).click();

  const p = a.page;
  const card = (code: string) => p.locator(`[data-code="${code}"]`).first();
  await expect(p.getByTestId('turn-label')).toContainText('Sua vez');
  await p.getByTestId('stock').click();
  await expect(p.locator('[data-card-id]')).toHaveCount(12);

  // "Baixar" só habilita com seleção válida
  await expect(p.getByTestId('meld-btn')).toBeDisabled();
  await card('AS').tap();
  await card('2S').tap();
  await expect(p.getByTestId('meld-btn')).toBeDisabled(); // 2 cartas
  await card('3S').tap();
  await expect(p.getByTestId('meld-btn')).toBeEnabled();
  await p.getByTestId('meld-btn').click();
  const meld = p.getByTestId('meld-1');
  await expect(meld.locator('[role=img]')).toHaveCount(3);

  // adicionar tocando: seleciona 4♠ e toca no jogo
  await card('4S').tap();
  await meld.click();
  await expect(meld.locator('[role=img]')).toHaveCount(4);

  // adicionar arrastando 5♠ para o jogo
  const c5 = (await card('5S').boundingBox())!;
  const m = (await meld.boundingBox())!;
  await p.mouse.move(c5.x + 8, c5.y + 20);
  await p.mouse.down();
  await p.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 10 });
  await p.mouse.up();
  await expect(meld.locator('[role=img]')).toHaveCount(5);

  // carta que não encaixa é recusada pelo servidor com mensagem em pt-BR
  await card('9S').tap();
  await meld.click();
  await expect(p.getByText(/não podem ser adicionadas/)).toBeVisible();

  // descartar a carta
  await card('9S').tap();
  await p.getByTestId('discard-btn').click();
  await expect(p.getByTestId('discard')).toContainText('Lixo · 1');
  await expect(b.page.getByTestId('turn-label')).toContainText('Sua vez');
  // o adversário vê o jogo baixado
  await expect(b.page.getByTestId('meld-1')).toBeVisible();
  await a.ctx.close();
  await b.ctx.close();
});
