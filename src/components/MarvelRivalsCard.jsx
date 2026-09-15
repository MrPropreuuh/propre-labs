import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Data is produced server-side by the fetcher on the Pi and served at /data/player.json.
// No API key in the browser anymore. The page polls this file so it stays fresh while open.
const DATA_URL = '/data/player.json';
const POLL_MS  = 60_000;

const IMG_BASE   = 'https://marvelrivalsapi.com';
const heroImgUrl = name => name
  ? `${IMG_BASE}/rivals/heroes/card/${name.toLowerCase().replace(/\s+/g, '-')}.png`
  : null;
// Rank icons live under /rivals/ranked/{tier}.png (the API omits the /rivals prefix).
const rankImgUrl = path => path ? `${IMG_BASE}/rivals${path}` : null;

// ── Rank tiers (level → tier/division), used for the all-time peak ────────────
const RANK_TIERS = [
  { name: 'Bronze',        color: '#C8843C' },
  { name: 'Silver',        color: '#AEB7C2' },
  { name: 'Gold',          color: '#F2C94C' },
  { name: 'Platinum',      color: '#58E1E8' },
  { name: 'Diamond',       color: '#B388FF' },
  { name: 'Grandmaster',   color: '#F2A23C' },
  { name: 'Celestial',     color: '#7BE0D6' },
  { name: 'Eternity',      color: '#FF6EC7' },
  { name: 'One Above All', color: '#FF3B3B' },
];
const DIVISIONS = ['III', 'II', 'I'];

function rankFromLevel(level) {
  const idx  = Math.min(Math.floor((level - 1) / 3), RANK_TIERS.length - 1);
  const tier = RANK_TIERS[idx];
  const div  = DIVISIONS[(level - 1) % 3];
  const label = tier.name === 'One Above All' ? tier.name : `${tier.name} ${div}`;
  const image = `/ranked/${tier.name.toLowerCase().replace(/ /g, '-')}.png`;
  return { tier: tier.name, color: tier.color, division: div, level, label, image };
}

// Highest rank ever reached across all ranked seasons.
function bestRankAllTime(rgs) {
  const arr = Object.values(rgs ?? {});
  if (!arr.length) return null;
  const top = arr.reduce((b, s) =>
    (s.max_level > b.max_level ||
      (s.max_level === b.max_level && s.max_rank_score > b.max_rank_score)) ? s : b);
  return {
    ...rankFromLevel(top.max_level),
    score:    Math.round(top.max_rank_score).toLocaleString(),
    winCount: top.win_count ?? null,
  };
}

const DEFAULT_SEASON = 'Current Season'; // overridden by the fetcher's seasonLabel

// ── Best Character · All Time ────────────────────────────────────────────────
// Curated reference (tracker.gg lifetime + percentiles — not exposed by the API).
// Edit these numbers by hand whenever the all-time best changes.
const ALL_TIME_BEST = {
  name:    'Groot',
  role:    'Vanguard',
  overall: 'TOP 13.7%',
  stats: [
    { label: 'Win Rate',         value: '53.9%',  pct: 'TOP 28.8%' },
    { label: 'KDA',              value: '3.74',   pct: 'TOP 12.6%' },
    { label: 'Matches Played',   value: '204',    pct: 'TOP 11.6%' },
    { label: 'Avg K/D/A',        value: '25.1 / 6.9 / 0.9' },
    { label: 'Damage / Min',     value: '1,510',  pct: 'TOP 18.7%' },
    { label: 'Dmg Taken / Min',  value: '3,855',  pct: 'TOP 20.2%' },
    { label: 'MVPs',             value: '62',     pct: 'TOP 2.31%' },
    { label: 'SVPs',             value: '54',     pct: 'TOP 1.79%' },
  ],
  combat: { kills: '5,111', deaths: '1,414', assists: '181', totalDamage: '3.4M', totalDamageTaken: '8.8M' },
};

const STATIC = {
  name:      'MrPropreter',
  level:     '43',
  rankLabel: 'Platinum III',
  rankColor: '#58E1E8',
  rankIcon:  null,
  rankScore: '3,975',
  winCount:  7,
  season:    DEFAULT_SEASON,
  heroes:    [],
  heroMap:   {},
  matches:   [],
};

// ── Shared parsing of a raw Marvel Rivals player response ─────────────────────
function parsePlayer(data, seasonLabel = DEFAULT_SEASON) {
  if (!data?.player) return null;

  const p       = data.player;
  const pInfo   = p.info ?? {};
  const seasons = Object.values(pInfo.rank_game_season ?? {});
  const rankS   = seasons.sort((a, b) => b.rank_game_id - a.rank_game_id)[0] ?? null;

  const overall  = data.overall_stats ?? {};
  const ranked   = overall.ranked   ?? {};
  const unranked = overall.unranked ?? {};
  const totalM   = (ranked.total_matches ?? 0) + (unranked.total_matches ?? 0);
  const totalW   = (ranked.total_wins    ?? 0) + (unranked.total_wins    ?? 0);
  const totalK   = (ranked.total_kills   ?? 0) + (unranked.total_kills   ?? 0);
  const totalD   = (ranked.total_deaths  ?? 0) + (unranked.total_deaths  ?? 0);
  const totalA   = (ranked.total_assists ?? 0) + (unranked.total_assists ?? 0);

  const allHeroes = [
    ...(data.heroes_ranked   ?? []),
    ...(data.heroes_unranked ?? []),
  ]
    .reduce((acc, h) => {
      const existing = acc.find(x => x.hero_id === h.hero_id);
      if (existing) {
        existing.matches += h.matches ?? 0;
        existing.wins    += h.wins    ?? 0;
        existing.kills   += h.kills   ?? 0;
        existing.deaths  += h.deaths  ?? 0;
        existing.assists += h.assists ?? 0;
        existing.mvp     += h.mvp     ?? 0;
        existing.svp     += h.svp     ?? 0;
      } else {
        acc.push({ ...h });
      }
      return acc;
    }, [])
    .sort((a, b) => (b.matches ?? 0) - (a.matches ?? 0));

  const heroMap = Object.fromEntries(allHeroes.map(h => [h.hero_name, h.hero_thumbnail]));

  return {
    name:      p.name ?? STATIC.name,
    level:     p.level ?? STATIC.level,
    rankLabel: p.rank?.rank   ?? STATIC.rankLabel,
    rankColor: p.rank?.color  ?? STATIC.rankColor,
    rankIcon:  p.rank?.image  ?? null,
    rankScore: rankS ? Math.round(rankS.rank_score).toLocaleString() : STATIC.rankScore,
    winCount:  rankS?.win_count ?? STATIC.winCount,
    season:    seasonLabel,
    winRate:   totalM > 0 ? `${((totalW / totalM) * 100).toFixed(1)}%` : null,
    kda:       totalD > 0 ? ((totalK + totalA) / totalD).toFixed(2) : null,
    kdaSub:    totalD > 0 ? `${totalK} / ${totalD} / ${totalA}` : null,
    totalM,
    totalW,
    heroes:    allHeroes,
    heroMap,
    matches:   data.match_history ?? [],
    bestRank:  bestRankAllTime(pInfo.rank_game_season),
  };
}

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] },
});

export const RevealCard = ({ children, delay = 0, className = '' }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    className={`bg-surface/70 backdrop-blur border border-muted/20 p-5 rounded-xl hover:border-white/20 transition-all duration-300 ${className}`}
  >
    {children}
  </motion.div>
);

function HeroThumb({ name, size = 'md' }) {
  const src = heroImgUrl(name);
  const dim = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-24 h-24' : 'w-16 h-16';
  if (!src) return null;
  return (
    <img
      src={src}
      alt={name}
      className={`${dim} rounded-xl object-cover flex-shrink-0 bg-black/40`}
      style={{ objectPosition: '50% 8%' }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

function StatBlock({ label, value, sub, color, delay }) {
  return (
    <RevealCard delay={delay}>
      <p className="text-xs text-muted uppercase tracking-widest mb-2">{label}</p>
      <p className="text-2xl font-bold leading-none" style={{ color: color ?? '#fff' }}>
        {value ?? '—'}
      </p>
      {sub && <p className="text-xs text-muted mt-1.5">{sub}</p>}
    </RevealCard>
  );
}

// ── Section header with a "Best Character" feel ───────────────────────────────
function SectionTitle({ kicker, title }) {
  return (
    <motion.div {...fadeUp(0)}>
      <p className="text-xs text-accent mt-0.5 uppercase tracking-[0.25em] font-semibold mb-1">{kicker}</p>
      <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
    </motion.div>
  );
}

// ── Best Character · Season (data-driven from live current-season heroes) ─────
function SeasonBestCard({ hero, season, live }) {
  if (!hero) return null;
  const wr   = hero.matches > 0 ? `${((hero.wins / hero.matches) * 100).toFixed(1)}%` : '—';
  const kda  = hero.deaths > 0 ? ((hero.kills + hero.assists) / hero.deaths).toFixed(2) : '—';
  const good = hero.matches > 0 && hero.wins / hero.matches >= 0.5;

  const cells = [
    { label: 'Win Rate', value: wr,                       color: good ? '#34D399' : '#F43F5E' },
    { label: 'KDA',      value: kda },
    { label: 'Matches',  value: String(hero.matches ?? '—') },
    { label: 'K/D/A',    value: `${hero.kills ?? 0} / ${hero.deaths ?? 0} / ${hero.assists ?? 0}` },
  ];

  return (
    <RevealCard className="flex flex-col sm:flex-row gap-6 items-start">
      <div className="flex items-center gap-4">
        <HeroThumb name={hero.hero_name} size="lg" />
        <div>
          <p className="text-xs text-muted uppercase tracking-widest mb-1">{hero.hero_class ?? 'Hero'}</p>
          <p className="text-3xl font-black text-white capitalize leading-none">{hero.hero_name}</p>
          <p className="text-xs text-muted mt-1.5">{live ? `Live · ${season}` : season}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 w-full">
        {cells.map(c => (
          <div key={c.label}>
            <p className="text-xs text-muted uppercase tracking-widest mb-1.5">{c.label}</p>
            <p className="text-lg font-bold leading-none" style={{ color: c.color ?? '#fff' }}>{c.value}</p>
          </div>
        ))}
      </div>
    </RevealCard>
  );
}

// ── Best Character · All Time (curated reference) ─────────────────────────────
function AllTimeBestCard() {
  const b = ALL_TIME_BEST;
  return (
    <RevealCard className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <HeroThumb name={b.name} size="lg" />
        <div>
          <p className="text-xs text-muted uppercase tracking-widest mb-1">{b.role}</p>
          <p className="text-3xl font-black text-white leading-none">{b.name}</p>
          <span className="inline-block mt-2 px-2.5 py-1 rounded-full bg-accent/15 border border-accent/40 text-accent text-xs font-bold tracking-wide">
            Competitive · {b.overall}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {b.stats.map(s => (
          <div key={s.label}>
            <p className="text-xs text-muted uppercase tracking-widest mb-1.5">{s.label}</p>
            <p className="text-lg font-bold text-white leading-none">{s.value}</p>
            {s.pct && <p className="text-[11px] text-accent font-semibold mt-1">{s.pct}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-muted/15">
        {[
          ['Kills', b.combat.kills],
          ['Deaths', b.combat.deaths],
          ['Assists', b.combat.assists],
          ['Total Damage', b.combat.totalDamage],
          ['Damage Taken', b.combat.totalDamageTaken],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] text-muted uppercase tracking-widest mb-1">{label}</p>
            <p className="text-sm font-bold text-white/90">{value}</p>
          </div>
        ))}
      </div>
    </RevealCard>
  );
}

// ── Best Rank · All Time (peak tier reached across all seasons) ───────────────
function BestRankCard({ rank, current, currentColor, currentIcon }) {
  if (!rank) return null;
  const img = rankImgUrl(rank.image);
  return (
    <RevealCard className="flex flex-col sm:flex-row gap-6 items-center sm:items-stretch">
      <div
        className="relative flex items-center justify-center w-40 rounded-xl overflow-hidden flex-shrink-0 py-6"
        style={{ background: `radial-gradient(circle at 50% 40%, ${rank.color}26, transparent 70%)` }}
      >
        {img && (
          <img
            src={img}
            alt={rank.label}
            className="w-28 h-28 object-contain drop-shadow-[0_0_18px_rgba(0,0,0,0.6)]"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      <div className="flex-1 flex flex-col justify-center text-center sm:text-left gap-3">
        <div>
          <p className="text-xs text-muted uppercase tracking-widest mb-1">Peak Rank</p>
          <p className="text-4xl font-black leading-none" style={{ color: rank.color }}>{rank.label}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-1">
          <div>
            <p className="text-xs text-muted uppercase tracking-widest mb-1.5">Peak Score</p>
            <p className="text-lg font-bold text-white leading-none">{rank.score}</p>
          </div>
          {rank.winCount != null && (
            <div>
              <p className="text-xs text-muted uppercase tracking-widest mb-1.5">Ranked Wins</p>
              <p className="text-lg font-bold text-white leading-none">{rank.winCount}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted uppercase tracking-widest mb-1.5">Current</p>
            <p className="text-lg font-bold leading-none flex items-center gap-1.5 justify-center sm:justify-start" style={{ color: currentColor ?? '#fff' }}>
              {currentIcon && (
                <img src={rankImgUrl(currentIcon)} alt="" className="w-5 h-5 object-contain"
                     onError={e => { e.currentTarget.style.display = 'none'; }} />
              )}
              {current ?? '—'}
            </p>
          </div>
        </div>
      </div>
    </RevealCard>
  );
}

function MatchRow({ match, idx }) {
  const perf     = match.player_performance ?? {};
  const heroName = perf.hero_name ?? '—';
  const isWin    = perf.is_win?.is_win ?? false;
  const result   = isWin ? 'WIN' : 'LOSS';
  const kda      = `${perf.kills ?? '?'}/${perf.deaths ?? '?'}/${perf.assists ?? '?'}`;
  const date     = match.match_time_stamp
    ? new Date(match.match_time_stamp * 1000).toLocaleDateString('en-CA') : '—';
  const mode     = match.game_mode_id === 2 ? 'Ranked' : match.game_mode_id === 1 ? 'Unranked' : '—';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: idx * 0.05, ease: 'easeOut' }}
      className="grid grid-cols-[1fr_90px_60px_80px_90px_96px] gap-3 px-4 py-3 border-b border-muted/10 last:border-0 hover:bg-white/[0.02] transition-colors items-center"
    >
      <span className="flex items-center gap-2 min-w-0">
        <HeroThumb name={heroName} size="sm" />
        <span className="text-sm font-semibold text-white truncate capitalize">{heroName}</span>
      </span>
      <span className="text-xs text-muted truncate">{mode}</span>
      <span className={`text-xs font-bold ${result === 'WIN' ? 'text-emerald-400' : 'text-rose-500'}`}>{result}</span>
      <span className="text-xs text-white/70 font-mono">{kda}</span>
      <span className="text-xs text-muted font-mono">
        {perf.score_change != null ? (perf.score_change > 0 ? `+${Math.round(perf.score_change)}` : Math.round(perf.score_change)) : '—'}
      </span>
      <span className="text-xs text-muted/50 font-mono">{date}</span>
    </motion.div>
  );
}

export default function MarvelRivalsCard() {
  const [display, setDisplay] = useState(STATIC);
  const [live,    setLive]    = useState(false);
  const [updated, setUpdated] = useState(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        const parsed = parsePlayer(json.current, json.seasonLabel ?? DEFAULT_SEASON);
        if (parsed) {
          setDisplay(parsed);
          setLive(true);
          setUpdated(json.updatedAt ?? null);
        }
      } catch {
        /* keep last known data */
      }
    };

    load();
    const id = setInterval(load, POLL_MS); // auto-refresh while the tab is open
    return () => { alive = false; clearInterval(id); };
  }, []);

  const d = display;
  const seasonBest = d.heroes?.[0] ?? null;

  const stats = [
    { label: 'Rank',        value: d.rankLabel,        sub: `Score ${d.rankScore}`,                                          color: d.rankColor },
    { label: 'Season Wins', value: String(d.winCount), sub: d.season },
    { label: 'Win Rate',    value: d.winRate ?? '—',   sub: d.totalM > 0 ? `${d.totalW}W / ${d.totalM - d.totalW}L` : null },
    { label: 'KDA',         value: d.kda ?? '—',       sub: d.kdaSub ?? null },
    { label: 'Top Hero',    value: seasonBest?.hero_name ? seasonBest.hero_name.replace(/\b\w/g, c => c.toUpperCase()) : '—',
                            sub: seasonBest ? `${seasonBest.matches} games` : null },
    { label: 'Level',       value: String(d.level),    sub: 'Account' },
  ];

  const updatedLabel = updated
    ? new Date(updated).toLocaleString('en-CA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
    : null;

  return (
    <main className="relative max-w-5xl mx-auto px-6 py-20 space-y-20">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center gap-6">
        <motion.span
          {...fadeUp(0)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-muted/30 bg-surface/80 backdrop-blur text-xs text-muted uppercase tracking-widest"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
          Marvel Rivals · {live ? 'Live' : 'Last known data'}
          {updatedLabel && <span className="text-muted/60 normal-case tracking-normal">· updated {updatedLabel}</span>}
        </motion.span>

        <motion.h1
          {...fadeUp(0.1)}
          className="text-6xl sm:text-8xl font-black tracking-tighter leading-none"
          style={{
            background: 'linear-gradient(160deg, #ffffff 40%, #3a3a3a 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {d.name}
        </motion.h1>

        <motion.p {...fadeUp(0.2)} className="flex items-center gap-2 text-muted text-base">
          Level {d.level} ·{' '}
          {d.rankIcon && (
            <img
              src={rankImgUrl(d.rankIcon)}
              alt={d.rankLabel}
              className="w-5 h-5 object-contain inline-block"
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <span style={{ color: d.rankColor }}>{d.rankLabel}</span>
        </motion.p>

        <motion.div {...fadeUp(0.3)} className="flex gap-3 pt-2">
          <a href="#stats"   className="px-5 py-2.5 bg-accent text-[#04140f] text-sm font-semibold rounded-lg hover:bg-[#10B981] transition-colors">Stats</a>
          <a href="#best"    className="px-5 py-2.5 border border-muted/30 text-white/80 text-sm font-semibold rounded-lg hover:bg-surface transition-colors">Best Heroes</a>
          <a href="#matches" className="px-5 py-2.5 border border-muted/30 text-white/80 text-sm font-semibold rounded-lg hover:bg-surface transition-colors">Matches</a>
        </motion.div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <section id="stats" className="space-y-5">
        <SectionTitle kicker={live ? `Live · ${d.season}` : 'Last known data'} title="Season Stats" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <StatBlock key={s.label} {...s} delay={i * 0.07} />
          ))}
        </div>
      </section>

      {/* ── Best Rank · All Time ──────────────────────────────────────────── */}
      {d.bestRank && (
        <section id="rank" className="space-y-5">
          <SectionTitle kicker="Best Rank · All Time" title="Career Peak" />
          <BestRankCard
            rank={d.bestRank}
            current={d.rankLabel}
            currentColor={d.rankColor}
            currentIcon={d.rankIcon}
          />
        </section>
      )}

      {/* ── Best Character · All Time ─────────────────────────────────────── */}
      <section id="best" className="space-y-5">
        <SectionTitle kicker="Best Character · All Time" title="Career Signature Hero" />
        <AllTimeBestCard />
      </section>

      {/* ── Best Character · Season ───────────────────────────────────────── */}
      {seasonBest && (
        <section className="space-y-5">
          <SectionTitle kicker={`Best Character · ${d.season}`} title="This Season's Standout" />
          <SeasonBestCard hero={seasonBest} season={d.season} live={live} />
        </section>
      )}

      {/* ── Hero breakdown ─────────────────────────────────────────────────── */}
      {d.heroes?.length > 0 && (
        <section className="space-y-5">
          <SectionTitle kicker="Most played" title="Hero Breakdown" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {d.heroes.slice(0, 8).map((h, i) => {
              const wr     = h.matches > 0 ? `${((h.wins / h.matches) * 100).toFixed(0)}%` : '—';
              const isGood = h.matches > 0 && (h.wins / h.matches) >= 0.5;
              return (
                <RevealCard key={h.hero_id ?? i} delay={i * 0.05} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <HeroThumb name={h.hero_name} size="md" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted uppercase tracking-widest leading-none mb-0.5">{h.hero_class ?? '—'}</p>
                      <p className="text-sm font-bold text-white truncate capitalize">{h.hero_name ?? h.hero_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">{h.matches ?? '?'} games</span>
                    <span className={`text-xs font-bold ${isGood ? 'text-emerald-400' : 'text-rose-500'}`}>{wr}</span>
                  </div>
                </RevealCard>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Matches ───────────────────────────────────────────────────────── */}
      <section id="matches" className="space-y-5">
        <SectionTitle kicker={d.matches?.length > 0 ? `${d.matches.length} games` : 'No data'} title="Match History" />
        <div className="rounded-xl border border-muted/20 overflow-hidden bg-surface/60 backdrop-blur">
          <div className="grid grid-cols-[1fr_90px_60px_80px_90px_96px] gap-3 px-4 py-3 border-b border-muted/20 bg-black/30">
            {['Hero','Mode','Result','KDA','±Score','Date'].map(h => (
              <span key={h} className="text-xs text-muted uppercase tracking-widest">{h}</span>
            ))}
          </div>
          {(!d.matches || d.matches.length === 0) ? (
            <div className="px-4 py-10 text-center text-muted text-sm">
              No match data available.
            </div>
          ) : (
            <AnimatePresence>
              {d.matches.slice(0, 10).map((m, i) => (
                <MatchRow key={m.match_uid ?? i} match={m} idx={i} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </section>

    </main>
  );
}
