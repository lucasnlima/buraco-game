import { useEffect } from 'react';
import { Toast } from './components';
import { Home } from './screens/Home';
import { HowTo } from './screens/HowTo';
import { Lobby } from './screens/Lobby';
import { Profile, Ranking } from './screens/Ranking';
import { Table } from './screens/Table';
import { resumeLastRoom, useStore } from './store';

export function App() {
  const { code, lobby, page, connected } = useStore();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.get('sala')) resumeLastRoom();
  }, []);

  let body;
  if (code && lobby) body = lobby.phase === 'lobby' ? <Lobby /> : <Table />;
  else if (code)
    body = <div className="flex h-full items-center justify-center text-lg">Conectando…</div>;
  else if (page === 'ranking') body = <Ranking />;
  else if (page === 'profile') body = <Profile />;
  else if (page === 'howto') body = <HowTo />;
  else body = <Home />;

  return (
    <div className="mx-auto h-full w-full max-w-5xl" style={{ paddingTop: 'var(--safe-top)' }}>
      {code && !connected && (
        <div
          className="fixed inset-x-0 top-0 z-[55] bg-amber-500 py-1 text-center text-xs font-semibold text-black"
          style={{ paddingTop: 'var(--safe-top)' }}
        >
          Reconectando…
        </div>
      )}
      {body}
      <Toast />
    </div>
  );
}
