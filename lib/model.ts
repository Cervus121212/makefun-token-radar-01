// Token Radar — the value model (radar-2, "category comps").
//
// A protocol that records no token has no market price, so this model prices
// it the way a buyer would price a private company: by what the market
// already pays for the same kind of business. For every category the
// snapshot's live-token protocols give a market multiple — median market cap
// per dollar of TVL — and a pre-token protocol is valued at its own TVL times
// its category's multiple, adjusted for its own seven-day growth, how long
// it has run, and how many chains it runs on. No protocol name is ever
// special-cased; the same arithmetic scores every row, and every number in
// it comes from the snapshot itself.
//
//   catMultiple  = median(mcap_usd / tvl_usd) over live-token protocols in
//                  the same category (3+ comps), else the global median
//   growthMult   = 1 + clamp(change_7d, -50, +100) / 100 * 0.6
//   ageMult      = 0.70 + 0.30 * min(ageDays, 730) / 730   (unknown: 0.85)
//   chainMult    = 1 + 0.02 * min(chains - 1, 5)
//   implied      = max(1, round(tvl_usd * catMultiple * growthMult
//                        * ageMult * chainMult))
//
// The board ranks every rankable pre-token protocol: the 40 on the
// watchlist plus every other pre-token protocol below the floor that is not
// a CEX, a bridge, a liquid-staking product or a versioned pool. Protocols
// whose token already trades are kept apart in the Live view, shown at the
// market's own value, never mixed into the ranked board.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_mult: number;
  chain_step: number;
  chain_cap: number;
  min_comps: number;
}

export const MODEL: ModelParams = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.7,
  age_range: 0.3,
  age_cap_days: 730,
  unknown_age_mult: 0.85,
  chain_step: 0.02,
  chain_cap: 5,
  min_comps: 3,
};

export const MODEL_VERSION = 'radar-2-category-comps';

const DAY_MS = 86_400_000;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories the house's watchlist rule keeps out: a wrapped, staked or bridged product is not a launch of its own. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A protocol records no token when the snapshot carries no market cap, no CoinGecko id and no symbol for it. */
export function recordsNoToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank this protocol: pre-token, and not a CEX, bridge, staking product or versioned pool. */
export function isRankable(p: SnapProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

function finiteNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Whole days from `listedAt` to `asOf`, or null when either date is missing or unparsable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/**
 * The market multiple for a category: the median mcap/TVL of the live-token
 * protocols in that category, when at least `min_comps` of them report both
 * figures. Falls back to the global median across all live protocols.
 */
export function categoryMultiples(
  protocols: SnapProtocol[],
  minComps: number,
): { byCategory: Record<string, number>; global: number; counts: Record<string, number> } {
  const live = protocols.filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const global = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const perCat = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = perCat.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCat.set(p.category, list);
  }
  const byCategory: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [cat, vals] of [...perCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    counts[cat] = vals.length;
    if (vals.length >= minComps) byCategory[cat] = median(vals);
  }
  return { byCategory, global, counts };
}

export interface ScoredProtocol {
  p: SnapProtocol;
  implied: number;
  catMultiple: number;
  catComps: number;
  catFallback: boolean;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  age: number | null;
}

/** One protocol's implied value under the model, with every multiplier kept for the detail view. */
export function scoreProtocol(
  p: SnapProtocol,
  asOf: string,
  multiples: { byCategory: Record<string, number>; global: number; counts: Record<string, number> },
  model: ModelParams = MODEL,
): ScoredProtocol {
  const age = ageDays(asOf, p.listed_at);
  const cat = p.category ?? '';
  const catMultiple = cat !== '' && cat in multiples.byCategory ? multiples.byCategory[cat]! : multiples.global;
  const catFallback = !(cat !== '' && cat in multiples.byCategory);
  const catComps = cat !== '' ? multiples.counts[cat] ?? 0 : 0;
  const rawGrowth = finiteNum(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult =
    age === null
      ? model.unknown_age_mult
      : model.age_floor + (Math.min(age, model.age_cap_days) / model.age_cap_days) * model.age_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * catMultiple * growthMult * ageMult * chainMult));
  return { p, implied, catMultiple, catComps, catFallback, growthPct, growthMult, ageMult, chainMult, age };
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'records-no-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comps: number;
    category_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  cat_multiple: number;
  cat_comps: number;
  cat_fallback: boolean;
  growth_pct: number;
  growth_mult: number;
  age_mult: number;
  chain_mult: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  model_note: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  category_multiples: Record<string, number>;
  rows: RadarRow[];
  live: LiveRow[];
}

export const LIVE_ROWS = 24;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Capital one farm position needs, tiered from the protocol's own TVL. */
function capitalFor(p: SnapProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How many days to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain the protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: SnapProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC on ${name} (${chain}) and leave the supply open so the position accrues every week.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield') || c.includes('vault') || c.includes('allocator') || c.includes('curator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('prediction'))
    return `Fund ${name} with $${capital} and take one position in an active market.`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launch') || c.includes('nft'))
    return `Join ${name}'s next launch or mint on ${chain} with $${capital} and hold what you receive.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

function stepText(s: FarmStep): string {
  let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out = `${out} Keep a log of the wallet, the dates and every transaction.`;
  return out;
}

/**
 * One protocol's farm plan: six steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm with, and write its seed phrase on paper, offline.`,
      cost: 'no cost, and about $2 of gas to fund it',
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital plus about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action a week — a deposit, a swap, a borrow or a vote — so the wallet shows steady use, not a single burst.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so it is counted in more than one snapshot if the protocol takes them.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, check the protocol's own points or rewards page and claim only from a link it publishes itself.`,
      cost: 'free to check, and never pay anyone to claim for you',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map(stepText);
}

/** The ranked board: every rankable pre-token protocol, watchlist first in coverage, scored and sorted by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelParams = MODEL): { board: BoardRow[]; multiples: ReturnType<typeof categoryMultiples> } {
  const multiples = categoryMultiples(snapshot.protocols, model.min_comps);
  const chosen = new Map<string, SnapProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()]
    .map((p) => scoreProtocol(p, snapshot.as_of, multiples, model))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'records-no-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.catMultiple),
      category_comps: s.catComps,
      category_fallback: s.catFallback,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      chain_multiplier: round4(s.chainMult),
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, multiples };
}

/** Live-token protocols, by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    cat_multiple: row.model.category_multiple,
    cat_comps: row.model.category_comps,
    cat_fallback: row.model.category_fallback,
    growth_pct: row.model.growth_pct,
    growth_mult: row.model.growth_multiplier,
    age_mult: row.model.age_multiplier,
    chain_mult: row.model.chain_multiplier,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelParams = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_note:
      'Implied value = TVL x the category multiple the live market already pays (median mcap/TVL of live-token protocols in the same category), adjusted for 7-day growth, age and chain count. It is this entry\'s own claim, never make.fun\'s, and it does not predict whether or when a token is issued.',
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    category_multiples: Object.fromEntries(
      Object.entries(multiples.byCategory).map(([k, v]) => [k, round4(v)]),
    ),
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols: SnapProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
