import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from 'motion/react';
import { GOODS, PLAYER_COUNT, RULE_META, SEALS_TO_WIN, CAMEL_BONUS } from '@shared/engine';
import type { Action, Card, CardType, RuleOptions } from '@shared/engine';
import type { PublicPlayer } from '@shared/engine/view';
import type { Personality } from '@shared/ai';
import type { DriverSnapshot, LogEntry } from '../game/driver';
import { formatTokens, rupeesToTokens } from '@shared/format';
import { cardColor, typeName } from './CardView';
import { inferAction, EMPTY_SELECTION, type Selection } from '../game/selection';
import { Glyph } from './Glyph';
import { CardView } from './CardView';
import { TokenChip, BonusChip, BonusPileChip, CamelToken, Seal } from './Pieces';
import {
  PrimaryButton,
  SecondaryButton,
  Stepper,
  PersonalityChip,
} from './Controls';
import { Sheet } from './Sheet';
import { RoundEndSheet } from './Sheets';
import css from './Table.module.css';

let fakeSeq = 0;
const fakeCard = (type: CardType): Card => ({ id: `__fake-${++fakeSeq}`, type });

/* ids seen face-up in the previous committed render — lets a remount flip mid-flight */
const FacePrev = createContext<ReadonlyMap<string, boolean>>(new Map());

export interface TableProps {
  snap: DriverSnapshot;
  onAct: (a: Action) => { ok: true } | { ok: false; reason: string };
  onNextRound: () => void;
  onRematch: () => void;
  onExit: () => void;
  onHint?: () => Action | undefined;
  animateDeal?: boolean;
  /** pvp extras */
  spectator?: boolean;
  canRematch?: boolean;
  readySent?: boolean;
  autoRoundMs?: number;
  timer?: { deadline: number; totalMs: number } | null;
  oppOffline?: number | null;
  confirmExit?: boolean;
  ended?: { reason: 'left' | 'timeout'; name: string } | null;
  onReturnRoom?: () => void;
}

export function Table(props: TableProps) {
  const { snap } = props;
  const { view, names, thinking } = snap;
  const spectator = props.spectator ?? false;

  const seen = useRef<Set<string>>(new Set());
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [invalidIds, setInvalidIds] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);

  const seat = view.viewer ?? 0;
  const opp = (seat + 1) % PLAYER_COUNT;
  const me = view.players[seat]!;
  const oppP = view.players[opp]!;
  const playing = view.phase === 'playing';
  const myTurn = playing && view.current === seat && !spectator;

  // mark cards as "new" (arriving from deck) — they mount face-down then flip
  const isNew = useMemo(() => {
    const ids = new Set<string>();
    const mark = (id: string) => {
      if (!seen.current.has(id)) {
        ids.add(id);
        seen.current.add(id);
      }
    };
    for (const c of view.market) mark(c.id);
    for (const c of view.discard) mark(c.id);
    for (const p of view.players) {
      for (const id of p.handIds) mark(id);
      for (const c of p.hand ?? []) mark(c.id);
      for (const id of p.herdIds ?? []) mark(id);
    }
    return ids;
  }, [view]);

  // record which ids were face-up for the next render's flipFrom
  const facePrev = useRef(new Map<string, boolean>());
  useEffect(() => {
    const m = new Map<string, boolean>();
    for (const c of view.market) m.set(c.id, true);
    for (const c of view.discard) m.set(c.id, true);
    for (const p of view.players) {
      for (const id of p.handIds) if (!m.has(id)) m.set(id, false);
      for (const c of p.hand ?? []) m.set(c.id, true);
      for (const id of p.herdIds ?? []) m.set(id, true);
    }
    facePrev.current = m;
  }, [view]);

  const inferred = useMemo(() => inferAction(view, sel), [view, sel]);

  const myGoodsTokens = me.goodsTokens;
  const myRupees =
    myGoodsTokens.reduce((a, t) => a + t.value, 0) +
    me.bonusTokens.reduce((a, t) => a + (t.value ?? 0), 0);
  /* hand sorted by goods order (stable) — resorting animates via the
     TravelCard FLIP since keyed cards keep their identity */
  const handList: { id: string; card: Card | null }[] = useMemo(() => {
    const list = me.hand
      ? me.hand.map((c) => ({ id: c.id, card: c as Card | null }))
      : me.handIds.map((id) => ({ id, card: null as Card | null }));
    if (me.hand) {
      const rank = (c: Card) =>
        c.type === 'camel' ? GOODS.length : (GOODS as readonly CardType[]).indexOf(c.type);
      list.sort((a, b) => rank(a.card!) - rank(b.card!));
    }
    return list;
  }, [me.hand, me.handIds]);

  const tryAct = () => {
    if (!inferred.action) return;
    const res = props.onAct(inferred.action);
    if (!res.ok) {
      setInvalid(res.reason);
      setInvalidIds([...sel.marketGoods, ...sel.hand]);
      setTimeout(() => setInvalidIds([]), 450);
    } else {
      setSel(EMPTY_SELECTION);
      setInvalid(null);
    }
  };

  const clickMarket = (c: Card) => {
    if (!myTurn) return;
    setInvalid(null);
    setSel((s) => {
      if (c.type === 'camel') return { ...s, marketCamels: !s.marketCamels };
      const m = new Set(s.marketGoods);
      if (m.has(c.id)) m.delete(c.id);
      else m.add(c.id);
      return { ...s, marketGoods: m };
    });
  };
  const clickHand = (id: string) => {
    if (!myTurn) return;
    setInvalid(null);
    setSel((s) => {
      const h = new Set(s.hand);
      if (h.has(id)) h.delete(id);
      else h.add(id);
      return { ...s, hand: h };
    });
  };
  const clearSel = () => {
    setSel(EMPTY_SELECTION);
    setInvalid(null);
  };

  const askExit = () => (props.confirmExit ? setExitAsk(true) : props.onExit());

  /* ── rails ── */
  const goodsRows = GOODS.map((g) => ({ good: g, pile: view.goodsPiles[g] }));

  const rail = (key: string, icon: ReactNode, chips: ReactNode, count: number) => (
    <div className={css.railRow} key={key}>
      {icon}
      <span className={css.rowChips}>
        {count > 0 ? chips : <span className={css.railEmpty}>取完</span>}
      </span>
      {count > 0 && <span className={css.railCount}>×{count}</span>}
    </div>
  );

  const goodsRail = goodsRows.map((r) =>
    rail(
      r.good,
      <span className={css.railGlyph} style={{ color: cardColor(r.good) }}>
        <Glyph type={r.good} size={20} />
      </span>,
      r.pile.map((t, i) => (
        <span key={t.id} style={{ position: 'relative', zIndex: r.pile.length - i }}>
          <TokenChip token={t} plain />
        </span>
      )),
      r.pile.length,
    ),
  );
  const bonusRail = ([3, 4, 5] as const).map((tier) => {
    const n = view.bonusPileCounts[tier];
    const layers = Math.min(4, n);
    return (
      <div className={css.bonusRow} key={`b${tier}`}>
        <span className={css.bonusStack}>
          {n === 0 ? (
            <span className={css.bonusWell} />
          ) : (
            Array.from({ length: layers }, (_, i) => (
              <span
                key={i}
                className={css.bonusLayer}
                style={{ '--o': i, zIndex: i } as CSSProperties}
              >
                {i === layers - 1 ? (
                  <BonusPileChip tier={tier} />
                ) : (
                  <span className={css.bonusBack} />
                )}
              </span>
            ))
          )}
        </span>
        {n > 0 ? (
          <span className={css.railCount}>×{n}</span>
        ) : (
          <span className={css.railEmpty}>取完</span>
        )}
      </div>
    );
  });

  const status = spectator
    ? '旁观中 · 座位空出后可在房间里坐下'
    : (snap.netError ??
      (thinking ? '对手行动中…' : ((invalid ?? inferred.status) || '拿取 · 交换 · 卖出')));
  const showButtons =
    !spectator &&
    myTurn &&
    ((inferred.action !== null && inferred.check?.ok === true) ||
      (inferred.check !== null && !inferred.check.ok));

  return (
    <main className={css.page}>
      <div className={css.topbar}>
        <div className={css.topLeft}>
          <span className={css.wordmark}>Jaipur</span>
          <span className={css.roundLabel}>第 {view.round} 轮</span>
          {spectator && <span className={css.specPill}>旁观中</span>}
        </div>
        <div className={css.topRight}>
          {!spectator && props.onHint && (
            <SecondaryButton
              disabled={!myTurn}
              onClick={() => {
                const a = props.onHint!();
                if (a) props.onAct(a);
              }}
              ariaLabel="提示"
            >
              提示
            </SecondaryButton>
          )}
          <div className={css.desktopGroup}>
            <SecondaryButton onClick={() => setShowLog(true)} ariaLabel="记录">
              记录
            </SecondaryButton>
            <SecondaryButton onClick={() => setShowRules(true)} ariaLabel="规则">
              规则
            </SecondaryButton>
            <SecondaryButton onClick={askExit} ariaLabel="退出">
              退出
            </SecondaryButton>
          </div>
          <button
            type="button"
            className={css.menuBtn}
            aria-label="菜单"
            onClick={() => setMenu(true)}
          >
            ⋯
          </button>
        </div>
      </div>

      <FacePrev.Provider value={facePrev.current}>
        <LayoutGroup>
          <div className={css.stage}>
            {/* opponent strip */}
            <PlayerStrip
              player={oppP}
              name={names[opp] ?? '对手'}
              personality={snap.personalities[opp] ?? null}
              isTurn={playing && view.current === opp}
              offline={props.oppOffline ?? null}
              thinking={thinking}
              timer={
                props.timer && view.current === opp && playing ? props.timer : null
              }
              isNew={(id) => isNew.has(id)}
              idPrefix="opp"
            />

            {/* mobile 2×3 goods summary above the table */}
            <div className={css.mobileRails}>
              {goodsRows.map((r) => (
                <div key={r.good} className={css.mobileRailCell}>
                  <span className={css.railGlyph} style={{ color: cardColor(r.good) }}>
                    <Glyph type={r.good} size={14} />
                  </span>
                  <span>
                    {r.pile.length > 0
                      ? `${r.pile[0]!.value}K ×${r.pile.length}`
                      : '取完'}
                  </span>
                </div>
              ))}
            </div>

            {/* the slab */}
            <div className={css.table}>
              <div className={css.tableHead}>
                <div className={css.headPiles}>
                  <div className={css.headPile}>
                    <div className={css.headPileBox}>
                      <DeckBack tag="a" />
                      <DeckBack tag="b" />
                    </div>
                    <span className={css.headCount}>{view.deckCount}</span>
                  </div>
                  <div className={css.headPile}>
                    <div className={css.headPileBox}>
                      {view.discardTop ? (
                        <CardView card={view.discardTop} mini selectable={false} />
                      ) : (
                        <div className={css.emptyWell} />
                      )}
                    </div>
                    <span className={css.headCount}>{view.discardCount}</span>
                  </div>
                </div>
                <div className={css.headBonus}>
                  {[3, 4, 5].map((t) => `×${t} ${view.bonusPileCounts[t as 3 | 4 | 5]}`).join(' · ')}
                  {` · 骆驼 ${formatTokens(rupeesToTokens(CAMEL_BONUS))}`}
                </div>
              </div>
              <div className={css.tableRow}>
                <div className={css.rail}>
                  <div className={css.railHead}>货物代币 · K</div>
                  {goodsRail}
                </div>
                <div className={css.wells}>
                  {view.market.map((c, i) => (
                    <div key={i} className={css.well}>
                      <TravelCard
                        card={c}
                        id={c.id}
                        faceDown={false}
                        isNew={isNew.has(c.id)}
                        selected={
                          c.type === 'camel' ? sel.marketCamels : sel.marketGoods.has(c.id)
                        }
                        invalid={invalidIds.includes(c.id)}
                        selectable={myTurn}
                        onClick={() => clickMarket(c)}
                        ariaLabel={`${typeName(c.type)}，市场第 ${i + 1} 张`}
                        z={5 + i}
                      />
                    </div>
                  ))}
                </div>
                <div className={css.rail}>
                  {bonusRail}
                  <div className={css.bonusRow}>
                    <CamelToken />
                  </div>
                </div>
              </div>
              <div className={css.piles}>
                <div className={css.pile}>
                  <div className={css.pileBox}>
                    <DeckBack tag="c" />
                    <DeckBack tag="d" />
                    <DeckBack tag="e" />
                  </div>
                  <span className={css.pileLabel}>牌堆 {view.deckCount}</span>
                </div>
                <div className={css.pile}>
                  <div className={css.pileBox}>
                    {view.discard.length === 0 ? (
                      <div className={css.emptyWell} />
                    ) : (
                      view.discard.slice(-3).map((c, i) => (
                        <TravelCard
                          key={c.id}
                          card={c}
                          id={c.id}
                          faceDown={false}
                          isNew={false}
                          selectable={false}
                          mini
                          z={i}
                        />
                      ))
                    )}
                  </div>
                  <span className={css.pileLabel}>弃牌 {view.discardCount}</span>
                </div>
              </div>
            </div>

            {/* your tray — spectators get a mirrored seat strip instead */}
            {spectator ? (
              <PlayerStrip
                player={me}
                name={names[seat] ?? '玩家'}
                isTurn={playing && view.current === seat}
                timer={
                  props.timer && view.current === seat && playing ? props.timer : null
                }
                isNew={(id) => isNew.has(id)}
                idPrefix="seat"
              />
            ) : (
              <div className={css.tray}>
                {myTurn && <div className={css.trayGlow} />}
                <div className={css.herdGroup}>
                  <HerdStack
                    herdIds={me.herdIds}
                    herdCount={me.herdCount}
                    hasCamels={me.hasCamels}
                    isNew={(id) => isNew.has(id)}
                    idPrefix="me"
                  />
                  {sel.marketGoods.size > 0 && (
                    <div className={css.stepperRow}>
                      <Stepper
                        value={sel.giveCamels}
                        min={0}
                        max={me.herdIds?.length ?? 0}
                        label="交出骆驼数"
                        onChange={(v) => setSel((s) => ({ ...s, giveCamels: v }))}
                      />
                    </div>
                  )}
                </div>

              <div
                className={`${css.hand} ${handList.length > 5 ? css.tight : ''}`}
                style={{ '--n': handList.length } as CSSProperties}
              >
                {handList.map((h, i) => (
                  <div key={h.id} className={css.handCard} style={{ '--i': i } as CSSProperties}>
                    <TravelCard
                      card={h.card ?? fakeCard('leather')}
                      id={h.id}
                      faceDown={h.card === null}
                      isNew={isNew.has(h.id)}
                      selected={h.card !== null && sel.hand.has(h.id)}
                      invalid={invalidIds.includes(h.id)}
                      selectable={myTurn && h.card !== null}
                      onClick={() => clickHand(h.id)}
                      ariaLabel={
                        h.card ? `${typeName(h.card.type)}，手牌第 ${i + 1} 张` : `手牌第 ${i + 1} 张`
                      }
                    />
                  </div>
                ))}
              </div>

              <div className={css.panel}>
                <div className={css.panelSide}>
                  <span className={css.panelName}>你</span>
                  <span className={css.panelSeals}>
                    {Array.from({ length: SEALS_TO_WIN }, (_, i) => (
                      <Seal key={i} earned={i < me.seals} animate={false} />
                    ))}
                  </span>
                </div>
                <div className={css.panelStats}>
                  <span className={css.stat}>
                    <span className={css.statLabel}>货物</span>
                    <span className={css.statVal}>{formatTokens(rupeesToTokens(myRupees))}</span>
                    <span className={css.goodsMini}>
                      {GOODS.map((g) => {
                        const n = myGoodsTokens.filter((t) => t.good === g).length;
                        if (!n) return null;
                        return (
                          <span
                            key={g}
                            className={css.goodsItem}
                            style={{ '--c': cardColor(g) } as CSSProperties}
                          >
                            <Glyph type={g} size={12} />
                            {n}
                          </span>
                        );
                      })}
                    </span>
                  </span>
                  <span className={css.stat}>
                    <span className={css.statLabel}>奖励</span>
                    <span className={css.statVal}>×{me.bonusTokens.length}</span>
                    <span className={css.statChips}>
                      {me.bonusTokens.map((b) => (
                        <BonusChip key={b.id} bonus={b} />
                      ))}
                    </span>
                  </span>
                </div>
                {props.timer && view.current === seat && playing && (
                  <TimerBar deadline={props.timer.deadline} totalMs={props.timer.totalMs} />
                )}
              </div>
              </div>
            )}

            {/* action bar */}
            {spectator ? (
              <div className={css.bar}>
                <p className={css.status}>{status}</p>
              </div>
            ) : (
              <div className={css.bar}>
                <p className={css.status}>
                  {inferred.preview && !invalid && inferred.check?.ok ? (
                    <>
                      <em>{inferred.preview}</em> {inferred.status}
                    </>
                  ) : (
                    status
                  )}
                </p>
                {showButtons && (
                  <div className={css.barBtns}>
                    {inferred.check?.ok ? (
                      <>
                        <SecondaryButton onClick={clearSel}>取消</SecondaryButton>
                        <PrimaryButton onClick={tryAct}>{inferred.button}</PrimaryButton>
                      </>
                    ) : (
                      <PrimaryButton disabled>{inferred.button}</PrimaryButton>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </LayoutGroup>
      </FacePrev.Provider>

      <AnimatePresence>
        {menu && (
          <Sheet title="Jaipur" onClose={() => setMenu(false)}>
            <div className={css.menuList}>
              <SecondaryButton
                onClick={() => {
                  setMenu(false);
                  setShowLog(true);
                }}
              >
                记录
              </SecondaryButton>
              <SecondaryButton
                onClick={() => {
                  setMenu(false);
                  setShowRules(true);
                }}
              >
                规则
              </SecondaryButton>
              <SecondaryButton
                onClick={() => {
                  setMenu(false);
                  askExit();
                }}
              >
                退出
              </SecondaryButton>
            </div>
          </Sheet>
        )}
        {exitAsk && (
          <Sheet title="退出对局" onClose={() => setExitAsk(false)}>
            <p className={css.sheetText}>现在退出会直接结束这局对局。确定退出？</p>
            <div className={css.sheetBtns}>
              <SecondaryButton onClick={() => setExitAsk(false)}>继续对局</SecondaryButton>
              <PrimaryButton
                onClick={() => {
                  setExitAsk(false);
                  props.onExit();
                }}
              >
                退出
              </PrimaryButton>
            </div>
          </Sheet>
        )}
        {showLog && (
          <Sheet title="记录" onClose={() => setShowLog(false)}>
            <LogList log={snap.log} />
          </Sheet>
        )}
        {showRules && (
          <Sheet title="规则" onClose={() => setShowRules(false)} wide>
            <RulesContent rules={view.rules} />
          </Sheet>
        )}
        {view.phase !== 'playing' && !props.ended && (
          <RoundEndSheet
            view={view}
            names={names}
            spectator={spectator}
            canRematch={props.canRematch ?? !spectator}
            readySent={props.readySent ?? false}
            autoRoundSec={props.autoRoundMs ? Math.round(props.autoRoundMs / 1000) : undefined}
            onNext={props.onNextRound}
            onRematch={props.onRematch}
            onExit={props.onReturnRoom ?? props.onExit}
            exitLabel={props.onReturnRoom ? '返回房间' : '返回大厅'}
          />
        )}
        {props.ended && (
          <Sheet title="对局结束">
            <p className={css.sheetText}>
              {props.ended.name}
              {props.ended.reason === 'left' ? ' 退出了，对局结束' : ' 掉线超时，对局结束'}
            </p>
            <PrimaryButton onClick={props.onReturnRoom ?? props.onExit}>返回房间</PrimaryButton>
          </Sheet>
        )}
      </AnimatePresence>
    </main>
  );
}

/* ── helpers ── */

/** Seat strip: mini face-down fan + herd stack + name/chip/seals + stats.
    Used for the opponent (top) and, for spectators, the bottom seat (V9). */
function PlayerStrip({
  player,
  name,
  personality = null,
  isTurn,
  offline = null,
  thinking = false,
  timer = null,
  isNew,
  idPrefix,
}: {
  player: PublicPlayer;
  name: string;
  personality?: Personality | null;
  isTurn: boolean;
  offline?: number | null;
  thinking?: boolean;
  timer?: { deadline: number; totalMs: number } | null;
  isNew: (id: string) => boolean;
  /** namespaces synthetic herd-card ids so two strips never share FLIP keys */
  idPrefix: string;
}) {
  const rupees =
    player.goodsTokens.reduce((a, t) => a + t.value, 0) +
    player.bonusTokens.reduce((a, t) => a + (t.value ?? 0), 0);
  return (
    <div className={`${css.oppStrip} ${isTurn ? css.turnGlow : ''}`}>
      <div className={css.oppFan}>
        {player.handIds.map((id, i) => (
          <TravelCard
            key={id}
            card={fakeCard('leather')}
            id={id}
            faceDown
            isNew={isNew(id)}
            mini
            z={i}
          />
        ))}
      </div>
      <HerdStack
        herdIds={player.herdIds}
        herdCount={player.herdCount}
        hasCamels={player.hasCamels}
        isNew={isNew}
        idPrefix={idPrefix}
      />
      <div className={css.oppInfo}>
        <div className={css.oppTop}>
          <span className={css.oppName}>{name}</span>
          {personality && <PersonalityChip p={personality} />}
          <span className={css.panelSeals}>
            {Array.from({ length: SEALS_TO_WIN }, (_, i) => (
              <Seal key={i} earned={i < player.seals} animate={false} />
            ))}
          </span>
          {offline ? (
            <OfflineNote deadline={offline} />
          ) : (
            thinking && <span className={css.thinking}>思考中 · · ·</span>
          )}
        </div>
        <div className={css.oppStats}>
          <span className={css.stat}>
            <span className={css.statLabel}>
              <Glyph type="camel" size={13} /> 骆驼
            </span>
            <span className={css.statVal}>
              {player.herdCount !== null
                ? `×${player.herdCount}`
                : player.hasCamels
                  ? '有骆驼'
                  : '无骆驼'}
            </span>
          </span>
          <span className={css.stat}>
            <span className={css.statLabel}>货物</span>
            <span className={css.statVal}>{formatTokens(rupeesToTokens(rupees))}</span>
          </span>
          <span className={css.stat}>
            <span className={css.statLabel}>奖励</span>
            <span className={css.statVal}>×{player.bonusTokens.length}</span>
            <span className={css.statChips}>
              {player.bonusTokens.slice(0, 3).map((b) => (
                <BonusChip key={b.id} bonus={b} />
              ))}
            </span>
          </span>
        </div>
      </div>
      {timer && <TimerBar deadline={timer.deadline} totalMs={timer.totalMs} />}
    </div>
  );
}

/** Compact camel stack: 3px vertical offsets, ≤6 visible, top card face-up,
    count badge. Falls back to generic camel cards when ids are hidden. */
function HerdStack({
  herdIds,
  herdCount,
  hasCamels,
  isNew,
  idPrefix,
}: {
  herdIds: string[] | null;
  herdCount: number | null;
  hasCamels: boolean;
  isNew: (id: string) => boolean;
  idPrefix: string;
}) {
  if (herdIds === null && herdCount === null) {
    return <span className={css.herdNote}>{hasCamels ? '有骆驼' : '无骆驼'}</span>;
  }
  const ids =
    herdIds ?? Array.from({ length: herdCount ?? 0 }, (_, i) => `__herd-${idPrefix}-${i}`);
  if (ids.length === 0) return <div className={css.emptyWell} />;
  const visible = ids.slice(-6);
  const top = visible.length - 1;
  return (
    <div className={css.herdStack}>
      {visible.map((id, i) => (
        <TravelCard
          key={id}
          card={fakeCard('camel')}
          id={id}
          faceDown={i < top}
          isNew={isNew(id)}
          selectable={false}
          mini
          z={i}
          style={{ position: 'absolute', left: 0, top: i * 3 }}
        />
      ))}
      <span className={css.herdCount}>{ids.length}</span>
    </div>
  );
}

function LogList({ log }: { log: LogEntry[] }) {
  return (
    <div className={css.logList}>
      {log.length === 0 && <p className={css.sheetText}>还没有记录。</p>}
      {[...log].reverse().map((e) => (
        <div key={e.id} className={css.logRow}>
          <span className={css.logRound}>第{e.round}轮</span>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Read-only rules summary — also used on the Home rules sheet and the room screen. */
export function RulesContent({ rules }: { rules: RuleOptions }) {
  return (
    <div className={css.rulesList}>
      {RULE_META.map((m) => {
        const v = rules[m.key];
        const opt = m.options.find((o) => o.value === v);
        return (
          <div key={m.key} className={css.rulesRow}>
            <span className={css.rulesLabel}>
              {m.label}
              <span className={css.rulesDesc}>{m.description}</span>
            </span>
            <span className={css.rulesVal}>{opt?.label ?? String(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DeckBack({ tag }: { tag: string }) {
  const c = useRef<Card>({ id: `__deck-${tag}`, type: 'leather' });
  return <CardView card={c.current} faceDown mini selectable={false} />;
}

/* last painted rect per card id — drives the manual FLIP travel animation.
   (layoutId/shared-element projection intermittently pins transforms when a
   card remounts in another container; measuring rects ourselves is exact.) */
const travelRects = new Map<string, { x: number; y: number }>();

function TravelCard({
  card,
  id,
  faceDown,
  isNew,
  mini = false,
  selected = false,
  selectable = false,
  invalid = false,
  onClick,
  ariaLabel,
  z = 1,
  style,
}: {
  card: Card;
  id: string;
  faceDown: boolean;
  isNew: boolean;
  mini?: boolean;
  selected?: boolean;
  selectable?: boolean;
  invalid?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  z?: number;
  style?: CSSProperties;
}) {
  const [down, setDown] = useState(isNew);
  useEffect(() => {
    if (!isNew) return;
    const t = setTimeout(() => setDown(false), 170 + Math.random() * 90);
    return () => clearTimeout(t);
  }, [isNew]);
  const facePrev = useContext(FacePrev);
  // the deal-flip only applies to cards whose destination is face-up —
  // face-down targets (opponent fan, deck) must stay backs
  const effDown = faceDown ? true : isNew ? down : false;
  const wasUp = facePrev.get(id);
  // face changed across this remount → flip mid-flight (R5)
  const flipFrom =
    !isNew && wasUp !== undefined && wasUp === effDown
      ? wasUp
        ? 'up'
        : 'down'
      : undefined;

  /* manual FLIP: snap to the card's previous rect, then spring to 0 */
  const controls = useAnimationControls();
  const elRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const prev = travelRects.get(id);
    travelRects.set(id, { x: r.x, y: r.y });
    if (prev && Math.abs(prev.x - r.x) + Math.abs(prev.y - r.y) > 2) {
      controls.set({ x: prev.x - r.x, y: prev.y - r.y });
      controls.start({
        x: 0,
        y: 0,
        transition: { type: 'spring', stiffness: 400, damping: 34 },
      });
    }
  });

  return (
    <motion.div
      ref={elRef}
      animate={controls}
      style={{ zIndex: z, position: 'relative', ...style }}
    >
      <CardView
        card={card}
        faceDown={effDown}
        flipFrom={flipFrom}
        mini={mini}
        selected={selected}
        selectable={selectable}
        invalid={invalid}
        onClick={onClick}
        ariaLabel={ariaLabel}
      />
    </motion.div>
  );
}

function TimerBar({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const remain = Math.max(0, deadline - now);
  const frac = Math.min(1, remain / totalMs);
  return (
    <div className={css.timerTrack}>
      {remain <= 10_000 && remain > 0 && (
        <span className={css.timerText}>剩余 {Math.ceil(remain / 1000)} 秒</span>
      )}
      <div className={css.timerFill} style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

function OfflineNote({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remain = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={css.thinking}>掉线 · 等待重连 {remain}s</span>;
}
