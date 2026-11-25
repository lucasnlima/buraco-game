import { t } from '../i18n';
import { useStore } from '../store';

export function Page({ title, children }: { title: string; children: React.ReactNode }) {
  const setPage = useStore((s) => s.setPage);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 p-3">
        <button className="btn-ghost" onClick={() => setPage('home')}>
          ← {t.back}
        </button>
        <h1 className="text-xl font-bold">{title}</h1>
      </header>
      <main className="flex-1 overflow-y-auto px-4 pb-8">{children}</main>
    </div>
  );
}

const Item = ({ h, children }: { h: string; children: React.ReactNode }) => (
  <section className="mb-4 rounded-xl bg-white/10 p-3">
    <h2 className="mb-1 font-bold text-gold">{h}</h2>
    <div className="space-y-1 text-sm text-white/90">{children}</div>
  </section>
);

export function HowTo() {
  return (
    <Page title={t.howTo}>
      <Item h="Objetivo">
        <p>
          Forme sequências, faça canastras e seja o primeiro a bater. Vence quem chegar primeiro à
          pontuação da sala (padrão 3.000).
        </p>
      </Item>
      <Item h="Sua vez em 3 passos">
        <p>
          <b>1. Comprar</b> — toque no monte (1 carta) ou no lixo (pega o lixo inteiro; no Aberto
          não precisa usar nada na hora). Se o lixo tinha só uma carta, ela não pode ser descartada
          na mesma vez.
        </p>
        <p>
          <b>2. Baixar</b> (opcional) — selecione 3+ cartas e toque em “Baixar”. Para adicionar a um
          jogo seu, selecione as cartas e toque no jogo (ou arraste a carta até ele).
        </p>
        <p>
          <b>3. Descartar</b> — selecione 1 carta e toque em “Descartar” (ou arraste para o lixo).
        </p>
      </Item>
      <Item h="Sequências">
        <p>
          Só existem sequências: no mínimo 3 cartas do mesmo naipe em ordem. O Ás vale baixo (A-2-3)
          ou alto (Q-K-A), mas não dá a volta (K-A-2).
        </p>
        <p>
          O 2 é curinga (no máximo 1 por sequência). Ele também pode ficar no lugar natural dele
          (A♥-2♥-3♥); aí não conta como curinga.
        </p>
        <p>Você só adiciona cartas aos jogos da sua dupla/seus.</p>
      </Item>
      <Item h="Canastras">
        <p>
          7+ cartas. Suja (com curinga) +100 · Limpa +200 · Meia real (A a K limpa) +500 · Real (A a
          A limpa, 14 cartas) +1000.
        </p>
      </Item>
      <Item h="Morto e batida">
        <p>
          Quem zera a mão pega o morto: baixando (direto, continua jogando) ou descartando
          (indireto, joga com ele na vez seguinte).
        </p>
        <p>
          Para bater você precisa já ter pego o morto e ter pelo menos 1 canastra limpa. Batida:
          +100.
        </p>
        <p>Sem pegar o morto: −100. Cartas na mão no fim da mão contam negativo.</p>
      </Item>
      <Item h="Pontos das cartas">
        <p>3 a 7 = 5 · 8 a K = 10 · Ás = 15 · 2 = 10 · Coringa (joker) = 20.</p>
      </Item>
      <Item h="Em duplas (4 jogadores)">
        <p>Parceiros sentam frente a frente. Jogos, morto e pontos são da dupla.</p>
      </Item>
      <Item h="Voz e chat">
        <p>
          Toque em 🎙️ para entrar no chat de voz. Use “Apertar para falar” se preferir. No iPhone, a
          voz só liga depois do seu toque.
        </p>
      </Item>
    </Page>
  );
}
