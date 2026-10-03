import { useCallback, useEffect, useRef, useState } from 'react';
import type { Personality } from '@shared/ai';
import type { RuleOptions } from '@shared/engine';
import { Backdrop } from './components/Backdrop';
import { Home } from './components/Home';
import { Setup } from './components/Setup';
import { Table } from './components/Table';
import { Room } from './components/Room';
import { botNameFor, loadSavedGame, LocalDriver, type SavedGame } from './game/local';
import { RemoteDriver, type RemoteMeta } from './game/remote';
import { loadProfile } from './game/profile';
import type { DriverSnapshot, GameDriver } from './game/driver';

type Screen = 'home' | 'setup' | 'table' | 'room';

function routeCode(): string | null {
  const m = /^\/r\/([A-Za-z0-9]{4,6})\/?$/.exec(location.pathname);
  return m ? m[1]!.toUpperCase() : null;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => (routeCode() ? 'room' : 'home'));
  const [driver, setDriver] = useState<GameDriver | null>(null);
  const [snap, setSnap] = useState<DriverSnapshot | null>(null);
  const [hasSave, setHasSave] = useState(() => loadSavedGame() !== null);
  const animateDeal = useRef(true);

  useEffect(() => {
    if (!driver) {
      setSnap(null);
      return;
    }
    return driver.subscribe(setSnap);
  }, [driver]);

  useEffect(() => {
    const onPop = () => {
      const code = routeCode();
      if (code) setScreen('room');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // opening /r/CODE directly joins that room
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const code = routeCode();
    if (code) {
      const d = new RemoteDriver({ code, create: false });
      animateDeal.current = false;
      setDriver(d);
      setScreen('room');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goHome = useCallback(() => {
    setDriver((d) => {
      if (d instanceof RemoteDriver) d.leave();
      d?.dispose();
      return null;
    });
    setHasSave(loadSavedGame() !== null);
    setScreen('home');
    history.replaceState(null, '', '/');
  }, []);

  const startGame = (
    personality: Personality,
    rules: Partial<RuleOptions>,
    resume?: SavedGame,
  ) => {
    const profile = loadProfile();
    const d = new LocalDriver(
      { personality, rules, names: [profile.name, botNameFor(personality)] },
      resume,
    );
    animateDeal.current = !resume;
    setDriver(d);
    setScreen('table');
  };

  const enterRoom = (code: string | null, create: boolean) => {
    const d = new RemoteDriver({ code, create });
    animateDeal.current = false;
    setDriver(d);
    setScreen('room');
    if (code) history.replaceState(null, '', `/r/${code}`);
  };

  return (
    <>
      <Backdrop />
      {screen === 'home' && (
        <Home
          hasSave={hasSave}
          onResume={() => {
            const saved = loadSavedGame();
            if (saved) startGame(saved.personality, {}, saved);
          }}
          onSetup={() => setScreen('setup')}
          onCreateRoom={() => enterRoom(null, true)}
          onJoinRoom={(code) => enterRoom(code, false)}
        />
      )}
      {screen === 'setup' && (
        <Setup onBack={goHome} onStart={(p, rules) => startGame(p, rules)} />
      )}
      {screen === 'table' && driver && snap && (
        <Table
          snap={snap}
          onAct={(a) => driver.act(a)}
          onNextRound={() => driver.nextRound()}
          onRematch={() => driver.rematch()}
          onExit={goHome}
          onHint={driver.hint ? () => driver.hint!() : undefined}
          animateDeal={animateDeal.current}
        />
      )}
      {screen === 'room' && driver instanceof RemoteDriver && (
        <RoomScreen driver={driver} snap={snap} onLeave={goHome} />
      )}
    </>
  );
}

function RoomScreen({
  driver,
  snap,
  onLeave,
}: {
  driver: RemoteDriver;
  snap: DriverSnapshot | null;
  onLeave: () => void;
}) {
  const [meta, setMeta] = useState<RemoteMeta | null>(null);
  const [returned, setReturned] = useState(false);

  useEffect(() => driver.subscribeMeta(setMeta), [driver]);

  const status = meta?.room?.status;
  useEffect(() => {
    if (status === 'playing') setReturned(false);
  }, [status]);

  const playing = status === 'playing' && snap !== null;
  const matchSheet = snap?.view.phase === 'matchOver';
  const ended = meta?.ended ?? null;
  const showTable = !returned && snap !== null && (playing || matchSheet || ended !== null);

  if (!meta || !showTable) {
    return <Room driver={driver} meta={meta ?? driver.currentMeta()} onLeave={onLeave} />;
  }

  const seat = snap.seat ?? snap.view.viewer;
  const spectator = seat === null;
  return (
    <Table
      snap={snap}
      spectator={spectator}
      timer={
        snap.turnDeadline && snap.turnTimerMs
          ? { deadline: snap.turnDeadline, totalMs: snap.turnTimerMs }
          : null
      }
      oppOffline={snap.oppReconnectDeadline ?? null}
      readySent={seat !== null && (snap.ready?.[seat] ?? false)}
      autoRoundMs={snap.autoRoundMs}
      canRematch={meta.room?.isHost ?? false}
      confirmExit={!spectator}
      ended={ended}
      onReturnRoom={() => setReturned(true)}
      onAct={(a) => driver.act(a)}
      onNextRound={() => driver.nextRound()}
      onRematch={() => driver.rematch()}
      onExit={onLeave}
      animateDeal={false}
    />
  );
}
