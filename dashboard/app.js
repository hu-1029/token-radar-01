// Token Radar, radar-3 dashboard. Static page, no framework, no network: every byte it
// shows comes from window.RADAR, written beside this page by main.ts. It renders the ranked
// board of pre-token protocols, a detail drawer per protocol with the model's arithmetic and
// its farm plan, a live-token table set aside from the ranking, and the calibration table
// behind the category multiples. Selecting a row, filtering or searching updates the URL hash
// so a view can be linked and screenshotted.
(() => {
  'use strict';

  const DATA = window.RADAR;
  const app = document.getElementById('board');
  if (!DATA || !app) return;

  const state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };
  const WATCHLIST = new Set(DATA.watchlist || []);

  // ---- languages -------------------------------------------------------------
  // Four interface languages, all shipped in this file: the page never fetches
  // a translation. Protocol names, categories in the data and the farm plans
  // stay in English, the language board.json was written in.
  const LANGS = [
    { code: 'en', label: 'EN', html: 'en' },
    { code: 'zh', label: '中文', html: 'zh-CN' },
    { code: 'es', label: 'ES', html: 'es' },
    { code: 'ja', label: '日本語', html: 'ja' },
  ];
  const I18N = {
    snapshot: ['Snapshot', '快照', 'Instantánea', 'スナップショット'],
    source: ['DefiLlama protocol index', 'DefiLlama 协议索引', 'Índice de protocolos DefiLlama', 'DefiLlama プロトコル指数'],
    modelLabel: ['{v} model', '{v} 模型', 'modelo {v}', '{v} モデル'],
    ledeTitle: ['{n} watchlist protocols, ranked by implied value', '{n} 个 watchlist 协议，按隐含价值排名', '{n} protocolos de la watchlist, por valor implícito', 'ウォッチリスト {n} 件を推定価値順に表示'],
    ledeText: ['The watchlist is the floor: every protocol with at least ${floor}M of TVL and no token on record. The early radar adds {early} clean pre-token protocols below that floor, every one of them, and drops bridges, staking receipts and wrapped assets even when they sit below the floor. Implied value is a model, not a promise.', 'Watchlist 是门槛：TVL 不低于 ${floor}M 且没有发币记录的协议都在其中。早期雷达再补上门槛之下全部 {early} 个干净的未发币协议，桥、质押凭证和包装资产即使在门槛之下也会被剔除。隐含价值是模型估算，不是承诺。', 'La watchlist es el mínimo: todo protocolo con al menos ${floor}M de TVL y sin token registrado. El radar temprano añade los {early} protocolos limpios sin token por debajo de ese mínimo, todos ellos, y descarta puentes, recibos de staking y activos envueltos aunque estén por debajo. El valor implícito es un modelo, no una promesa.', 'ウォッチリストは下限です。TVL が ${floor}M 以上で、トークンの記録がないプロトコルがすべて対象です。アーリーレーダーは、その下限を下回るクリーンな未発行プロトコル {early} 件をすべて追加し、ブリッジ、ステーキング受領証、ラップ資産は下限以下でも除外します。推定価値はモデルによる推定であり、約束ではありません。'],
    factWatchlist: ['Watchlist covered', 'Watchlist 已覆盖', 'Watchlist cubierta', 'ウォッチリスト網羅'],
    factPreToken: ['Pre-token rows scored', '已评分的未发币行数', 'Filas sin token puntuadas', '採点済みの未発行行数'],
    factEarly: ['Early rows below the floor', '门槛之下的早期行数', 'Filas tempranas bajo el mínimo', '下限以下の早期行数'],
    factLive: ['Live-token protocols set aside', '已发币协议（另列）', 'Protocolos con token, aparte', '発行済みプロトコル（別掲）'],
    search: ['Search', '搜索', 'Buscar', '検索'],
    searchPh: ['Search name, category or chain', '搜名称、类别或链', 'Buscar nombre, categoría o cadena', '名前、カテゴリ、チェーンで検索'],
    searchAria: ['Search the board', '搜索榜单', 'Buscar en el tablero', 'ボードを検索'],
    category: ['Category', '类别', 'Categoría', 'カテゴリ'],
    categoryAria: ['Filter by category', '按类别筛选', 'Filtrar por categoría', 'カテゴリで絞り込む'],
    chain: ['Chain', '链', 'Cadena', 'チェーン'],
    chainAria: ['Filter by chain', '按链筛选', 'Filtrar por cadena', 'チェーンで絞り込む'],
    watchlist: ['Watchlist', 'Watchlist', 'Watchlist', 'ウォッチリスト'],
    watchlistOnly: ['Watchlist only', '仅看 Watchlist', 'Solo watchlist', 'ウォッチリストのみ'],
    tokenStatus: ['Token status', '代币状态', 'Estado del token', 'トークンの状態'],
    preToken: ['Pre-token', '未发币', 'Sin token', '未発行'],
    liveToken: ['Live token', '已发币', 'Con token', '発行済み'],
    allCategories: ['All categories', '全部类别', 'Todas las categorías', 'すべてのカテゴリ'],
    allChains: ['All chains', '全部链', 'Todas las cadenas', 'すべてのチェーン'],
    rowsShown: ['{n} rows shown', '显示 {n} 行', '{n} filas visibles', '{n} 行を表示'],
    liveCount: ['{n} live-token protocols', '{n} 个已发币协议', '{n} protocolos con token', '発行済みプロトコル {n} 件'],
    boardCaption: ['Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.', '未发币协议，按隐含价值从高到低。点一行查看模型和 farm 计划。', 'Protocolos sin token, por valor implícito descendente. Selecciona una fila para ver su modelo y su plan de farmeo.', '未発行プロトコルを推定価値の高い順に表示。行を選択するとモデルとファーム計画が見られます。'],
    thRank: ['Rank', '排名', 'Puesto', '順位'],
    thTvlRank: ['TVL rank', 'TVL 排名', 'Puesto por TVL', 'TVL 順位'],
    thDelta: ['Rank Δ', '排名差', 'Δ puesto', '順位差'],
    thProtocol: ['Protocol', '协议', 'Protocolo', 'プロトコル'],
    thTvl: ['TVL', 'TVL', 'TVL', 'TVL'],
    thGrowth: ['7d', '7日', '7d', '7日'],
    thAge: ['Age', '年龄', 'Edad', '経過'],
    thImplied: ['Implied value', '隐含价值', 'Valor implícito', '推定価値'],
    thToken: ['Token', '代币', 'Token', 'トークン'],
    noToken: ['no token', '未发币', 'sin token', '未発行'],
    emptyTitle: ['No protocol matches that filter', '没有符合筛选的协议', 'Ningún protocolo coincide con el filtro', '条件に合うプロトコルがありません'],
    emptyText: ['Clear the search or pick another category to see the board again.', '清除搜索或换个类别，就能重新看到榜单。', 'Limpia la búsqueda o elige otra categoría para volver a ver el tablero.', '検索をクリアするか、別のカテゴリを選ぶとボードが再表示されます。'],
    clearFilters: ['Clear filters', '清除筛选', 'Limpiar filtros', 'フィルタをクリア'],
    liveCaption: ['Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.', '已发币：这些协议的代币已经在交易，所以市值是事实，不是模型。它们不参与未发币排名，另列在此。', 'Token en vivo: estos protocolos ya cotizan, así que su capitalización es un hecho, no un modelo. Quedan fuera del ranking de protocolos sin token.', '発行済みトークン：これらのプロトコルはすでに取引されているため、時価総額は事実であり、モデルではありません。未発行ランキングからは除外しています。'],
    thStatus: ['Status', '状态', 'Estado', '状態'],
    thMcap: ['Market cap', '市值', 'Capitalización', '時価総額'],
    alreadyTrades: ['already trades', '已在交易', 'ya cotiza', '取引中'],
    statusLive: ['live', '已发币', 'en vivo', '取引中'],
    modelTitle: ['How implied value is computed', '隐含价值是怎么算出来的', 'Cómo se calcula el valor implícito', '推定価値の計算方法'],
    modelSub: ['Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.', '每一行都由同一个快照数字函数打分，没有协议名被特殊对待，也没有哪一行是手挑的。', 'Cada fila se puntúa con una sola función de las cifras de la instantánea. Ningún nombre de protocolo tiene trato especial y ninguna fila se eligió a mano.', 'すべての行はスナップショットの数値からなる単一の関数で採点されます。特定のプロトコル名が優遇されることはなく、行が手作業で選ばれることもありません。'],
    modelNote: ['The category multiple is 1 / median TVL per market-cap of that category\u2019s protocols that already trade, clamped to {floor}–{cap}. A category with fewer than {min} traded comparables uses a blend of its own median multiple and the global multiple {g}, weighted by how many comparables it has, so one outlier cannot set the price and the category\u2019s own signal is not thrown away. Age is the time since the protocol was first listed; an unlisted age uses {u} days. The early radar is every clean pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.', '类别倍数 = 1 / 该类别已发币协议的 TVL/市值中位数，夹在 {floor}–{cap} 之间。已发币可比协议少于 {min} 个的类别，取自家倍数和全局倍数 {g} 的加权混合，权重按可比协议个数算，避免一个异常值定价，也不会把类别自己的信号全扔掉。年龄指协议首次上榜至今的时间，未上榜的按 {u} 天算。早期雷达是门槛之下全部干净的未发币协议，已发币协议另列并展示市值。', 'El múltiplo de categoría es 1 / la mediana de TVL por capitalización de los protocolos de esa categoría que ya cotizan, limitado a {floor}–{cap}. Una categoría con menos de {min} comparables que cotizan usa una mezcla de su propio múltiplo mediano y el múltiplo global {g}, ponderada por cuántos comparables tiene, para que un valor atípico no fije el precio sin desechar la señal propia de la categoría. La edad es el tiempo desde la primera aparición del protocolo; una edad no registrada usa {u} días. El radar temprano incluye todos los protocolos limpios sin token por debajo del mínimo de la watchlist, y los protocolos con token se muestran aparte con su capitalización.', 'カテゴリ倍率は、すでに取引されているそのカテゴリのプロトコルの TVL/時価総額の中央値の逆数で、{floor}～{cap} に収めています。取引中の比較対象が {min} 件未満のカテゴリは、自らの中央値倍率と全体倍率 {g} を比較対象の件数で重み付けしたブレンドを使い、外れ値ひとつで価格が決まらないようにしつつ、カテゴリ自身のシグナルを捨てません。経過期間はプロトコルが初めて掲載されてからの期間で、未掲載の場合は {u} 日とします。アーリーレーダーはウォッチリスト下限以下のクリーンな未発行プロトコルすべてを含み、発行済みプロトコルは時価総額とともに別掲しています。'],
    multCaption: ['Category multiples, calibrated from this snapshot\u2019s traded protocols.', '类别倍数，按本快照已发币协议校准。', 'Múltiplos por categoría, calibrados con los protocolos que cotizan en esta instantánea.', 'カテゴリ倍率。このスナップショットの取引中プロトコルから較正。'],
    multCat: ['Category', '类别', 'Categoría', 'カテゴリ'],
    multComps: ['Traded comps', '已发币可比数', 'Comparables', '取引中の比較対象'],
    multMedian: ['Median TVL / mcap', 'TVL/市值中位数', 'Mediana TVL / cap.', 'TVL/時価総額の中央値'],
    multMultiple: ['Multiple', '倍数', 'Múltiplo', '倍率'],
    multSource: ['Source', '来源', 'Fuente', '出典'],
    srcCategory: ['category median', '类别中位数', 'mediana de categoría', 'カテゴリ中央値'],
    srcGlobal: ['global median', '全局中位数', 'mediana global', '全体中央値'],
    srcBlended: ['blended median', '混合中位数', 'mediana combinada', 'ブレンド中央値'],
    detailRank: ['Rank {r} of {n}', '第 {r} 名，共 {n} 名', 'Puesto {r} de {n}', '{n} 件中 {r} 位'],
    eqTvl: ['TVL', 'TVL', 'TVL', 'TVL'],
    eqGrowth: ['Seven-day growth', '7 日涨幅', 'Crecimiento a 7 días', '7日間の成長率'],
    eqAge: ['Age with no token', '未发币时长', 'Edad sin token', '未発行の期間'],
    eqCatMult: ['Category multiple', '类别倍数', 'Múltiplo de categoría', 'カテゴリ倍率'],
    eqGrowthMult: ['Growth multiplier', '增长乘数', 'Multiplicador de crecimiento', '成長倍率'],
    eqMatMult: ['Maturity multiplier', '成熟度乘数', 'Multiplicador de madurez', '成熟倍率'],
    eqChainMult: ['Chain multiplier', '多链乘数', 'Multiplicador de cadenas', 'チェーン倍率'],
    eqImplied: ['Implied value', '隐含价值', 'Valor implícito', '推定価値'],
    recomputeSame: ['Model {v}: the same function scores every protocol. The page recomputes this row as {n}, the same number board.json carries, within rounding. This is an estimate, not a price.', '模型 {v}：同一个函数给所有协议打分。本页重算该行得 {n}，与 board.json 一致（在舍入误差内）。这是估算，不是定价。', 'Modelo {v}: la misma función puntúa a todos los protocolos. La página recalcula esta fila como {n}, el mismo número que trae board.json, dentro del redondeo. Es una estimación, no un precio.', 'モデル {v}：同じ関数がすべてのプロトコルを採点します。このページで再計算すると {n} となり、board.json の数値と丸め誤差の範囲で一致します。これは推定であり、価格ではありません。'],
    recomputeDiff: ['Model {v}: the same function scores every protocol. The page recomputes this row as {n}, which differs from the board: the data would be stale. This is an estimate, not a price.', '模型 {v}：同一个函数给所有协议打分。本页重算该行得 {n}，与榜单不一致：数据可能已过期。这是估算，不是定价。', 'Modelo {v}: la misma función puntúa a todos los protocolos. La página recalcula esta fila como {n}, distinto del tablero: los datos estarían desactualizados. Es una estimación, no un precio.', 'モデル {v}：同じ関数がすべてのプロトコルを採点します。このページで再計算すると {n} となり、ボードと異なります。データが古い可能性があります。これは推定であり、価格ではありません。'],
    farmPlan: ['Farm plan', 'Farm 计划', 'Plan de farmeo', 'ファーム計画'],
    whyTitle: ['Why this rank', '为什么排这名', 'Por qué este puesto', 'この順位の理由'],
    farmNote: ['Farm plans are written in English.', 'Farm 计划为英文原文。', 'Los planes de farmeo están escritos en inglés.', 'ファーム計画は英語で記載されています。'],
    close: ['Close', '关闭', 'Cerrar', '閉じる'],
    closeAria: ['Close details', '关闭详情', 'Cerrar detalles', '詳細を閉じる'],
    ageUnknown: ['unknown', '未知', 'desconocida', '不明'],
    langLabel: ['Language', '语言', 'Idioma', '言語'],
    skip: ['Skip to the board', '跳到榜单', 'Saltar al tablero', 'ボードへスキップ'],
    title: ['Token Radar · pre-token protocols ranked by implied value', 'Token Radar · 未发币协议按隐含价值排名', 'Token Radar · protocolos sin token por valor implícito', 'Token Radar · 未発行プロトコルを推定価値順に表示'],
    chainUnnamed: ['an unnamed chain', '未具名链', 'una cadena sin nombre', '名前のないチェーン'],
  };
  // Category display names, by the same four languages; an unlisted category
  // falls back to the name the snapshot carries.
  const CATNAMES = {
    'Risk Curators': ['Risk Curators', '风险管理方', 'Curadores de riesgo', 'リスクキュレーター'],
    'Dexs': ['Dexs', '去中心化交易所', 'DEX', 'DEX'],
    'RWA': ['RWA', '现实世界资产', 'RWA', 'RWA'],
    'Yield': ['Yield', '收益', 'Rendimiento', 'イールド'],
    'Onchain Capital Allocator': ['Onchain Capital Allocator', '链上资金配置方', 'Asignadores de capital on-chain', 'オンチェーン資金配分'],
    'Lending': ['Lending', '借贷', 'Préstamos', 'レンディング'],
    'Derivatives': ['Derivatives', '衍生品', 'Derivados', 'デリバティブ'],
    'CDP': ['CDP', 'CDP', 'CDP', 'CDP'],
    'Yield Aggregator': ['Yield Aggregator', '收益聚合器', 'Agregadores de rendimiento', 'イールドアグリゲーター'],
    'Basis Trading': ['Basis Trading', '基差交易', 'Basis trading', 'ベーシストレーディング'],
    'Chain': ['Chain', '公链', 'Cadena', 'チェーン'],
    'Staking Pool': ['Staking Pool', '质押池', 'Pool de staking', 'ステーキングプール'],
    'Liquidity Manager': ['Liquidity Manager', '流动性管理', 'Gestores de liquidez', '流動性マネージャー'],
    'Restaking': ['Restaking', '再质押', 'Restaking', 'リステーキング'],
    'CeDeFi': ['CeDeFi', 'CeDeFi', 'CeDeFi', 'CeDeFi'],
    'Anchor BTC': ['Anchor BTC', '锚定 BTC', 'BTC anclado', 'アンカーBTC'],
    'Leveraged Farming': ['Leveraged Farming', '杠杆挖矿', 'Farmeo apalancado', 'レバレッジファーミング'],
    'Dual-Token Stablecoin': ['Dual-Token Stablecoin', '双代币稳定币', 'Stablecoin de doble token', 'デュアルトークン・ステーブルコイン'],
    'Decentralized BTC': ['Decentralized BTC', '去中心化 BTC', 'BTC descentralizado', '分散型BTC'],
    'Collateral Markets': ['Collateral Markets', '抵押品市场', 'Mercados de colateral', '担保市場'],
    'Payments': ['Payments', '支付', 'Pagos', '決済'],
    'Stablecoin Wrapper': ['Stablecoin Wrapper', '稳定币包装', 'Envoltorio de stablecoin', 'ステーブルコインラッパー'],
    'Insurance': ['Insurance', '保险', 'Seguros', '保険'],
    'Governance Incentives': ['Governance Incentives', '治理激励', 'Incentivos de gobernanza', 'ガバナンスインセンティブ'],
    'Crypto Card Issuer': ['Crypto Card Issuer', '加密卡发行方', 'Emisores de tarjetas cripto', '暗号資産カード発行'],
    'Farm': ['Farm', '挖矿', 'Farmeo', 'ファーム'],
    'Uncollateralized Lending': ['Uncollateralized Lending', '无抵押借贷', 'Préstamos sin colateral', '無担保レンディング'],
    'Prediction Market': ['Prediction Market', '预测市场', 'Mercados de predicción', '予測市場'],
    'Interest Rate Derivatives': ['Interest Rate Derivatives', '利率衍生品', 'Derivados de tipos de interés', '金利デリバティブ'],
    'Indexes': ['Indexes', '指数', 'Índices', 'インデックス'],
  };
  const langIndex = (code) => Math.max(0, LANGS.findIndex((l) => l.code === code));
  const storedLang = () => {
    try { return window.localStorage.getItem('token-radar-lang'); } catch (e) { return null; }
  };
  const defaultLang = () => {
    const saved = storedLang();
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
    const nav = (window.navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS.some((l) => l.code === nav) ? nav : 'en';
  };
  state.lang = defaultLang();
  const t = (key, vars) => {
    const row = I18N[key] || [key];
    let s = row[langIndex(state.lang)] || row[0];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', String(v));
    return s;
  };
  const catName = (cat) => {
    const row = CATNAMES[cat || ''];
    return row ? (row[langIndex(state.lang)] || row[0]) : (cat || 'Other');
  };
  const setLang = (code) => {
    if (!LANGS.some((l) => l.code === code) || code === state.lang) return;
    state.lang = code;
    try { window.localStorage.setItem('token-radar-lang', code); } catch (e) { /* private mode */ }
    document.documentElement.lang = LANGS[langIndex(code)].html;
    document.title = t('title');
    const skip = document.querySelector('.skip');
    if (skip) skip.textContent = t('skip');
    render();
  };
  document.documentElement.lang = LANGS[langIndex(state.lang)].html;
  document.title = t('title');
  const skipLink = document.querySelector('.skip');
  if (skipLink) skipLink.textContent = t('skip');

  // ---- formatting ---------------------------------------------------------
  const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  };
  const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const age = (days) => {
    if (days === null || days === undefined) return t('ageUnknown');
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };
  const chainLabel = (row) => (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : t('chainUnnamed'));

  // ---- the model, recomputed in the page ----------------------------------
  // Same arithmetic as lib/model.ts, so the page can check the number board.json carries.
  // Multiples are calibrated per category from the traded protocols in this snapshot; a
  // category with fewer than 3 traded comparables uses a blend of its own multiple and the
  // global one, weighted by its sample count.
  const multipleFor = (category) => {
    const table = DATA.category_multiples || [];
    const hit = table.find((x) => x.category === (category || 'Uncategorized'));
    return hit ? hit.multiple : DATA.global_multiple;
  };
  const impliedOf = (row) => {
    const m = DATA.model;
    const growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d ?? 0));
    const growthMult = 1 + (growth / 100) * m.growth_weight;
    const ageDays = row.age_days ?? m.unknown_age_days;
    const maturity = m.maturity_floor + m.maturity_range * Math.sqrt(Math.min(Math.max(ageDays, 0), m.maturity_days) / m.maturity_days);
    const chainMult = 1 + m.chain_bonus * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_bonus_max);
    return Math.max(1, Math.round(row.tvl_usd * multipleFor(row.category) * growthMult * maturity * chainMult));
  };

  // Farm plans arrive verbatim from board.json, so the page can never disagree with the
  // board about a plan. They were derived in main.ts from each protocol's category, main
  // chain, TVL and age; no protocol name is special-cased.
  const farmSteps = (row) => row.farm_steps || [];

  // ---- tiny DOM helper -----------------------------------------------------
  // h('div', { class: 'x', text: 'hi' }, child1, child2) — attrs starting with "on"
  // are event listeners, "text" sets textContent, everything else is an attribute.
  const h = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined) continue;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  };

  // ---- URL hash: shareable views -------------------------------------------
  const readHash = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
  };
  const writeHash = () => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  };

  // ---- filtering and sorting -------------------------------------------------
  const visibleRows = () => {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchlistOnly && !WATCHLIST.has(r.slug)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().includes(q);
    });
  };
  const sortValue = (r, key) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d ?? -Infinity;
    if (key === 'age') return r.age_days ?? Infinity;
    if (key === 'tvlRank') return r.tvl_rank;
    if (key === 'delta') return r.rank_delta;
    return r.implied_value_usd;
  };
  const sortedRows = (list) => list.slice().sort((a, b) => {
    const av = sortValue(a, state.sort);
    const bv = sortValue(b, state.sort);
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.slug < b.slug ? -1 : 1;
  });

  // ---- page sections ---------------------------------------------------------
  const langSwitch = () => h('div', { class: 'lang-switch', role: 'group', 'aria-label': t('langLabel') },
    ...LANGS.map((l) => h('button', {
      type: 'button',
      'aria-pressed': state.lang === l.code ? 'true' : 'false',
      text: l.label,
      onclick: () => setLang(l.code),
    })));

  const pageHeader = () => h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
    h('div', { class: 'top-right' },
      langSwitch(),
      h('div', { class: 'top-meta' },
        h('span', { text: t('snapshot') + ' ' + DATA.as_of }),
        h('span', { text: t('source') }),
        h('span', { text: t('modelLabel', { v: DATA.model_version }) }))));
  const lede = () => h('section', { class: 'lede' },
    h('div', null,
      h('h1', { text: t('ledeTitle', { n: DATA.watchlist_size }) }),
      h('p', { text: t('ledeText', { floor: Math.round(DATA.floor_usd / 1e6), early: DATA.early_size }) })),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: t('factWatchlist') }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      h('div', { class: 'fact' }, h('span', { text: t('factPreToken') }), h('b', { text: String(DATA.board_size) })),
      h('div', { class: 'fact' }, h('span', { text: t('factEarly') }), h('b', { text: String(DATA.early_size) })),
      h('div', { class: 'fact' }, h('span', { text: t('factLive') }), h('b', { text: String(DATA.live_size) }))));

  const optionList = (values, current, allLabel) => [
    h('option', { value: 'all', text: allLabel }),
    ...values.map((v) => h('option', { value: v, text: catName(v), selected: v === current ? 'selected' : null })),
  ];
  const controls = () => {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: t('searchPh'), value: state.q, 'aria-label': t('searchAria') });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
    const categorySelect = h('select', { id: 'category', 'aria-label': t('categoryAria') }, ...optionList(categories, state.category, t('allCategories')));
    categorySelect.addEventListener('change', () => { state.category = categorySelect.value; writeHash(); render(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': t('chainAria') }, ...optionList(chains, state.chain, t('allChains')));
    chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; writeHash(); render(); });
    const wlBtn = h('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: t('watchlistOnly'), onclick: () => { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    const tabBtn = (tab, label) => h('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: () => { state.tab = tab; render(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: t('search') }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: t('category') }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: t('chain') }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: t('watchlist') }), wlBtn),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: t('tokenStatus') }), h('div', { class: 'tabs' }, tabBtn('pre-token', t('preToken')), tabBtn('live', t('liveToken')))),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? t('rowsShown', { n: visibleRows().length }) : t('liveCount', { n: DATA.live.length }) }));
  };

  const sortHeader = (key, label) => h('th', { scope: 'col' },
    h('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label,
      state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));

  const boardTable = () => {
    const list = sortedRows(visibleRows());
    if (!list.length) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: t('emptyTitle') }),
        h('p', { text: t('emptyText') }),
        h('button', { class: 'button primary', type: 'button', text: t('clearFilters'), onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })));
    }
    const max = Math.max(...list.map((r) => r.implied_value_usd || 0), 1);
    const tbody = h('tbody');
    for (const r of list) {
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', { class: 'num', text: String(r.tvl_rank) }),
        h('td', { class: 'num ' + (r.rank_delta < 0 ? 'pos' : r.rank_delta > 0 ? 'neg' : ''), text: (r.rank_delta > 0 ? '+' : '') + String(r.rank_delta) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: catName(r.category) + ' on ' + chainLabel(r) + (WATCHLIST.has(r.slug) ? ' · watchlist' : '') }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: pct(r.change_7d) }),
        h('td', { class: 'num', text: age(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) }))),
        h('td', null, h('span', { class: 'status', text: t('noToken') }))));
    }
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sub', text: t('boardCaption') }),
        h('thead', null, h('tr', null,
          sortHeader('implied', t('thRank')), sortHeader('tvlRank', t('thTvlRank')), sortHeader('delta', t('thDelta')), sortHeader('name', t('thProtocol')), sortHeader('tvl', t('thTvl')),
          sortHeader('growth', t('thGrowth')), sortHeader('age', t('thAge')), sortHeader('implied', t('thImplied')),
          h('th', { scope: 'col', text: t('thToken') }))),
        tbody)));
  };

  const liveTable = () => {
    const tbody = h('tbody');
    for (const r of DATA.live) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: t('statusLive') }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: catName(r.category) + ' on ' + chainLabel(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: t('alreadyTrades') }))));
    }
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sub', text: t('liveCaption') }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: t('thStatus') }), h('th', { scope: 'col', text: t('thProtocol') }), h('th', { scope: 'col', text: t('thTvl') }), h('th', { scope: 'col', text: t('thGrowth') }), h('th', { scope: 'col', text: t('thMcap') }), h('th', { scope: 'col', text: t('thToken') }))),
        tbody)));
  };

  const modelPanel = () => {
    const m = DATA.model;
    const present = new Set(DATA.rows.map((r) => r.category || 'Uncategorized'));
    const multRows = (DATA.category_multiples || []).filter((x) => present.has(x.category))
      .sort((a, b) => b.multiple - a.multiple);
    const tbody = h('tbody');
    for (const x of multRows) {
      tbody.appendChild(h('tr', null,
        h('td', { text: catName(x.category) }),
        h('td', { class: 'num', text: String(x.samples) }),
        h('td', { class: 'num', text: x.median_ratio === null ? 'n/a' : String(x.median_ratio) }),
        h('td', { class: 'num', text: String(x.multiple) }),
        h('td', { text: x.source === 'category' ? t('srcCategory') : x.source === 'blended' ? t('srcBlended') : t('srcGlobal') })));
    }
    return h('section', { class: 'panel model' },
      h('h2', { text: t('modelTitle') }),
      h('p', { class: 'sub', text: t('modelSub') }),
      h('div', { class: 'formula', text: 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x sqrt(min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ')) x (1 + ' + m.chain_bonus + ' x min(chains - 1, ' + m.chain_bonus_max + ')) )' }),
      h('p', { class: 'sub', text: t('modelNote', { floor: m.multiple_floor, cap: m.multiple_cap, min: m.category_min_samples, g: DATA.global_multiple, u: m.unknown_age_days }) }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: t('multCaption') }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: t('multCat') }), h('th', { scope: 'col', text: t('multComps') }), h('th', { scope: 'col', text: t('multMedian') }), h('th', { scope: 'col', text: t('multMultiple') }), h('th', { scope: 'col', text: t('multSource') }))),
          tbody)));
  };

  // ---- detail drawer ---------------------------------------------------------
  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  const equationRow = (label, value) => h('div', null, h('span', { text: label }), h('b', { class: 'num', text: value }));
  const openDetail = (slug) => {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    const recomputed = impliedOf(row);
    const matches = Math.abs(recomputed - row.implied_value_usd) / row.implied_value_usd < 0.005;
    dialog.append(
      h('div', { class: 'detail-head' },
        h('div', null,
          h('span', { class: 'brand-name', text: t('detailRank', { r: row.rank, n: DATA.board_size }) }),
          h('h2', { id: 'detail-title', text: row.name }),
          h('p', { class: 'sub', text: catName(row.category) + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : t('chainUnnamed')) })),
        h('button', { class: 'close', type: 'button', 'aria-label': t('closeAria'), text: t('close'), onclick: () => dialog.close() })),
      h('section', { class: 'detail-section' },
        h('h3', { text: t('whyTitle') }),
        h('p', { class: 'sub', text: row.why })),
      h('section', { class: 'detail-section' },
        h('h3', { text: t('thImplied') }),
        h('div', { class: 'equation' },
          equationRow(t('eqTvl'), money(row.tvl_usd)),
          equationRow(t('eqGrowth'), pct(row.change_7d)),
          equationRow(t('eqAge'), age(row.age_days)),
          equationRow(t('eqCatMult'), String(row.category_multiple)),
          equationRow(t('eqGrowthMult'), String(row.growth_multiplier)),
          equationRow(t('eqMatMult'), String(row.maturity_multiplier)),
          equationRow(t('eqChainMult'), String(row.chain_multiplier)),
          equationRow(t('eqImplied'), money(row.implied_value_usd))),
        h('p', { class: 'sub', text: matches ? t('recomputeSame', { v: DATA.model_version, n: money(recomputed) }) : t('recomputeDiff', { v: DATA.model_version, n: money(recomputed) }) })),
      h('section', { class: 'detail-section' },
        h('h3', { text: t('farmPlan') }),
        h('p', { class: 'sub farm-note', text: t('farmNote') }),
        h('ol', { class: 'steps' }, farmSteps(row).map((s) => {
          const at = s.indexOf(' Cost: ');
          const action = at >= 0 ? s.slice(0, at) : s;
          const tail = at >= 0 ? s.slice(at + 1) : '';
          return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
        }))));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  // ---- render ------------------------------------------------------------------
  const render = () => {
    app.textContent = '';
    const shell = h('div', { class: 'shell' },
      pageHeader(), lede(), controls(),
      state.tab === 'pre-token' ? boardTable() : liveTable(),
      ...(state.tab === 'pre-token' ? [modelPanel()] : []));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  };

  readHash();
  render();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
