import { type Browser, expect, test } from '@playwright/test';

async function enter(browser: Browser, name: string) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel(/Seu nome/).fill(name);
  return { ctx, page };
}

test('chat de voz P2P entre dois jogadores + chat de texto', async ({ browser }) => {
  const a = await enter(browser, 'Vera');
  await a.page.getByRole('button', { name: 'Criar sala' }).click();
  const code = (await a.page.getByTestId('room-code').textContent())!.trim();
  const b = await enter(browser, 'Vitor');
  await b.page.getByLabel('Código da sala').fill(code);
  await b.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(b.page.getByTestId('room-code')).toHaveText(code);

  for (const p of [a.page, b.page]) {
    await p.getByRole('button', { name: 'Chat', exact: true }).click();
    await p.getByRole('tab').nth(1).click();
    await p.getByRole('button', { name: /Entrar na voz/ }).click();
    await expect(p.getByRole('button', { name: /Sair da voz/ })).toBeVisible();
  }
  for (const p of [a.page, b.page]) {
    await expect
      .poll(
        () =>
          p.evaluate(() =>
            (window as unknown as { __buracoVoice: () => string[] }).__buracoVoice(),
          ),
        { timeout: 20_000 },
      )
      .toEqual(['connected']);
  }

  // mutar e push-to-talk não quebram a conexão
  await a.page.getByRole('button', { name: /Mutar/ }).click();
  await expect(a.page.getByRole('button', { name: /Desmutar/ })).toBeVisible();

  // chat de texto
  await b.page.getByRole('tab').nth(0).click();
  await b.page.getByPlaceholder('Mensagem…').fill('olá, Vera!');
  await b.page.getByRole('button', { name: 'Enviar' }).click();
  await a.page.getByRole('tab').nth(0).click();
  await expect(a.page.getByText('olá, Vera!')).toBeVisible();

  await a.ctx.close();
  await b.ctx.close();
});
