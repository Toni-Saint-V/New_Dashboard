const dashboardState = {
    chart: null,
    candleSeries: null,
    highlightSeries: null,
    candles: [],
    trades: [],
    tradeMap: new Map(),
    lastCandleTime: null,
    ws: null,
    wsReconnectTimer: null,
    activeSelection: { symbol: null, timeframe: null },
    defaultSelection: { symbol: null, timeframe: null },
    elements: {},
    tradeTooltip: null,
    pinnedTradeId: null,
    equityChart: null,
};

const WS_RECONNECT_DELAY = 3000;
const DEFAULT_LIMIT = 300;
const HOVER_DISTANCE_PX = 24;
const START_BALANCE = 10000;

function getElements() {
    return {
        root: document.getElementById("chart-root"),
        equityRoot: document.getElementById("equity-chart-root"),
        chartBody: document.querySelector(".cbp-chart-body"),
        symbol: document.getElementById("symbol"),
        timeframe: document.getElementById("tf"),
        wsDot: document.getElementById("st-inline-ws"),
        netDot: document.getElementById("st-inline-net"),
    };
}

function setDotState(el, state) {
    if (!el) return;
    const classes = ["cbp-dot-ok", "cbp-dot-warn", "cbp-dot-bad"];
    classes.forEach((c) => el.classList.remove(c));
    const map = { ok: "cbp-dot-ok", warn: "cbp-dot-warn", bad: "cbp-dot-bad" };
    if (map[state]) {
        el.classList.add(map[state]);
    }
}

function createChart(root) {
    if (!root) return null;
    root.innerHTML = "";
    const chart = LightweightCharts.createChart(root, {
        width: root.clientWidth,
        height: root.clientHeight,
        layout: { background: { color: "#0f0f0f" }, textColor: "#e2e8f0" },
        grid: {
            vertLines: { color: "#181818" },
            horzLines: { color: "#181818" },
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: "#30363d",
        },
        rightPriceScale: { borderColor: "#30363d" },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    const candleSeries = chart.addCandlestickSeries({
        upColor: "#2ecc71",
        downColor: "#ef5350",
        borderDownColor: "#ef5350",
        borderUpColor: "#2ecc71",
        wickDownColor: "#ef5350",
        wickUpColor: "#2ecc71",
    });

    return { chart, candleSeries };
}

function ensureHighlightSeries() {
    if (dashboardState.highlightSeries || !dashboardState.chart) return;
    dashboardState.highlightSeries = dashboardState.chart.addLineSeries({
        color: "#8b5cf6",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
}

function normalizeCandle(c) {
    return {
        time: Number(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
    };
}

function normalizeTrade(trade) {
    if (!trade) return null;
    const opened = trade.opened_at || trade.entry_time || trade.time;
    const closed = trade.closed_at || trade.exit_time || null;
    const open_ts = opened ? Math.floor(new Date(opened).getTime() / 1000) : null;
    const closed_ts = closed ? Math.floor(new Date(closed).getTime() / 1000) : null;
    const entry_price = trade.entry_price ?? trade.entry ?? trade.price ?? null;
    const exit_price = trade.exit_price ?? trade.exit ?? trade.close_price ?? null;

    return {
        ...trade,
        id: String(trade.id ?? `${open_ts || Date.now()}-${trade.side || "trade"}`),
        opened_at: opened,
        closed_at: closed,
        entry_price: entry_price !== null ? Number(entry_price) : null,
        exit_price: exit_price !== null ? Number(exit_price) : null,
        pnl: trade.pnl !== undefined ? Number(trade.pnl) : null,
        pnl_pct: trade.pnl_pct !== undefined ? Number(trade.pnl_pct) : null,
        max_drawdown_pct:
            trade.max_drawdown_pct !== undefined ? Number(trade.max_drawdown_pct) : undefined,
        side: trade.side || "long",
        open_ts,
        closed_ts,
        sortTime: closed_ts || open_ts || 0,
    };
}

async function fetchCandles(symbol, timeframe) {
    const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}&limit=${DEFAULT_LIMIT}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    const data = payload.data || payload.candles || [];
    return data.map(normalizeCandle).sort((a, b) => a.time - b.time);
}

function applyHistory(candles) {
    dashboardState.candles = candles;
    dashboardState.lastCandleTime = candles.length ? candles[candles.length - 1].time : null;
    dashboardState.candleSeries.setData(candles);
}

function handleLiveCandle(candle) {
    if (!dashboardState.candleSeries) return;
    const item = normalizeCandle(candle);
    dashboardState.lastCandleTime = Math.max(dashboardState.lastCandleTime || 0, item.time);
    dashboardState.candleSeries.update(item);
}

function applyTrades(trades) {
    const normalized = trades.map(normalizeTrade).filter(Boolean);
    dashboardState.trades = normalized;
    dashboardState.tradeMap = new Map(normalized.map((t) => [t.id, t]));
    updateTradeMarkers();
    updateEquity();
}

function updateTradeMarkers(activeTradeId) {
    if (!dashboardState.candleSeries) return;
    const markers = [];
    dashboardState.trades.forEach((t) => {
        if (!t.open_ts || !t.entry_price) return;
        markers.push({
            time: t.open_ts,
            position: "belowBar",
            color: activeTradeId && activeTradeId === t.id ? "#f59e0b" : t.side === "short" ? "#ef5350" : "#2ecc71",
            shape: "arrowUp",
            text: `${t.side === "short" ? "S" : "L"} ${t.entry_price}`,
        });
        if (t.closed_ts && t.exit_price !== null && t.exit_price !== undefined) {
            markers.push({
                time: t.closed_ts,
                position: "aboveBar",
                color: activeTradeId && activeTradeId === t.id ? "#f59e0b" : "#8b949e",
                shape: "arrowDown",
                text: `${t.exit_price}`,
            });
        }
    });
    dashboardState.tradeMarkers = markers;
    dashboardState.candleSeries.setMarkers(markers);
}

function clearHighlight() {
    if (dashboardState.highlightSeries) {
        dashboardState.highlightSeries.setData([]);
    }
}

function drawHighlight(trade) {
    ensureHighlightSeries();
    if (!dashboardState.highlightSeries || !trade) return;
    const points = [];
    if (trade.open_ts && trade.entry_price !== null && trade.entry_price !== undefined) {
        points.push({ time: trade.open_ts, value: trade.entry_price });
    }
    if (trade.closed_ts && trade.exit_price !== null && trade.exit_price !== undefined) {
        points.push({ time: trade.closed_ts, value: trade.exit_price });
    }
    dashboardState.highlightSeries.setData(points);
}

function getTradeAnchorCoords(trade) {
    if (!dashboardState.chart || !trade) return null;
    const timeScale = dashboardState.chart.timeScale();
    const entryX = trade.open_ts ? timeScale.timeToCoordinate(trade.open_ts) : null;
    const exitX = trade.closed_ts ? timeScale.timeToCoordinate(trade.closed_ts) : null;
    const entryY = trade.entry_price !== null && trade.entry_price !== undefined ? dashboardState.candleSeries.priceToCoordinate(trade.entry_price) : null;
    const exitY = trade.exit_price !== null && trade.exit_price !== undefined ? dashboardState.candleSeries.priceToCoordinate(trade.exit_price) : null;

    const anchor = entryX !== null && entryY !== null ? { x: entryX, y: entryY } : null;
    const exitAnchor = exitX !== null && exitY !== null ? { x: exitX, y: exitY } : null;

    if (anchor && exitAnchor) {
        // Choose closer to the right for better visibility
        return exitAnchor;
    }
    return exitAnchor || anchor;
}

function findNearestTrade(point) {
    if (!dashboardState.chart || !point) return null;
    let best = null;
    dashboardState.trades.forEach((trade) => {
        const anchors = [];
        const timeScale = dashboardState.chart.timeScale();
        const entryX = trade.open_ts ? timeScale.timeToCoordinate(trade.open_ts) : null;
        const exitX = trade.closed_ts ? timeScale.timeToCoordinate(trade.closed_ts) : null;
        const entryY = trade.entry_price !== null && trade.entry_price !== undefined ? dashboardState.candleSeries.priceToCoordinate(trade.entry_price) : null;
        const exitY = trade.exit_price !== null && trade.exit_price !== undefined ? dashboardState.candleSeries.priceToCoordinate(trade.exit_price) : null;
        if (entryX !== null && entryY !== null) anchors.push({ x: entryX, y: entryY });
        if (exitX !== null && exitY !== null) anchors.push({ x: exitX, y: exitY });
        anchors.forEach((anchor) => {
            const dx = (anchor.x || 0) - point.x;
            const dy = (anchor.y || 0) - point.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (!best || dist < best.distance) {
                best = { trade, distance: dist, anchor };
            }
        });
    });
    if (best && best.distance <= HOVER_DISTANCE_PX) return best;
    return null;
}

function showTradeTooltip(trade, pinned = false) {
    if (!trade || !dashboardState.tradeTooltip) return;
    const anchor = getTradeAnchorCoords(trade);
    if (!anchor) {
        dashboardState.tradeTooltip.hide();
        return;
    }
    const bodyRect = dashboardState.elements.chartBody?.getBoundingClientRect();
    const rootRect = dashboardState.elements.root?.getBoundingClientRect();
    if (!bodyRect || !rootRect) return;
    const offsetX = rootRect.left - bodyRect.left;
    const offsetY = rootRect.top - bodyRect.top;
    const absX = offsetX + anchor.x;
    const absY = offsetY + anchor.y;
    dashboardState.tradeTooltip.show(trade, { x: absX, y: absY, pinned }, bodyRect);
    updateTradeMarkers(trade.id);
    drawHighlight(trade);
}

function hideTradeTooltip() {
    if (dashboardState.tradeTooltip && !dashboardState.tradeTooltip.isPinned) {
        dashboardState.tradeTooltip.hide();
        updateTradeMarkers();
        clearHighlight();
    }
}

function handleCrosshairMove(param) {
    if (!param?.point) {
        hideTradeTooltip();
        return;
    }
    if (dashboardState.pinnedTradeId) {
        repositionPinnedTooltip();
        return;
    }
    const nearest = findNearestTrade(param.point);
    if (nearest) {
        dashboardState.tradeTooltip.isPinned = false;
        showTradeTooltip(nearest.trade, false);
    } else {
        hideTradeTooltip();
    }
}

function repositionPinnedTooltip() {
    if (!dashboardState.pinnedTradeId) return;
    const trade = dashboardState.tradeMap.get(dashboardState.pinnedTradeId);
    if (trade) {
        showTradeTooltip(trade, true);
    }
}

function handleChartClick(param) {
    if (!param?.point) return;
    const nearest = findNearestTrade(param.point);
    if (nearest) {
        dashboardState.pinnedTradeId = nearest.trade.id;
        dashboardState.tradeTooltip.isPinned = true;
        showTradeTooltip(nearest.trade, true);
    } else {
        dashboardState.pinnedTradeId = null;
        if (dashboardState.tradeTooltip) {
            dashboardState.tradeTooltip.hide();
        }
        updateTradeMarkers();
        clearHighlight();
    }
}

function closeSocket() {
    if (dashboardState.wsReconnectTimer) {
        clearTimeout(dashboardState.wsReconnectTimer);
        dashboardState.wsReconnectTimer = null;
    }
    if (dashboardState.ws) {
        dashboardState.ws.onopen = null;
        dashboardState.ws.onmessage = null;
        dashboardState.ws.onclose = null;
        dashboardState.ws.onerror = null;
        dashboardState.ws.close();
        dashboardState.ws = null;
    }
}

function isMatchingLiveCandle(msg) {
    const { activeSelection, defaultSelection } = dashboardState;
    const { symbol, timeframe } = activeSelection || {};

    const data = msg?.data || {};
    const msgSymbol = msg.symbol || data.symbol;
    const msgTimeframe = msg.tf || data.tf || data.timeframe;

    if (symbol && timeframe && msgSymbol && msgTimeframe) {
        return symbol === msgSymbol && timeframe === msgTimeframe;
    }

    if (defaultSelection.symbol && defaultSelection.timeframe) {
        return symbol === defaultSelection.symbol && timeframe === defaultSelection.timeframe;
    }

    return true;
}

function addOrUpdateTrade(trade) {
    const normalized = normalizeTrade(trade);
    if (!normalized) return;
    dashboardState.tradeMap.set(normalized.id, normalized);
    dashboardState.trades = Array.from(dashboardState.tradeMap.values());
    updateTradeMarkers(dashboardState.pinnedTradeId);
    updateEquity();
    repositionPinnedTooltip();
}

function connectSocket(symbol, timeframe) {
    closeSocket();
    const { wsDot } = dashboardState.elements;
    setDotState(wsDot, "warn");

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    if (timeframe) params.set("tf", timeframe);
    const query = params.toString();
    const ws = new WebSocket(
        `${protocol}://${window.location.host}/ws${query ? `?${query}` : ""}`
    );
    dashboardState.ws = ws;

    ws.onopen = () => setDotState(wsDot, "ok");

    ws.onmessage = (evt) => {
        try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "candle" && msg.data && isMatchingLiveCandle(msg)) {
                handleLiveCandle(msg.data);
            }
            if (msg.type === "trade" && msg.data) {
                addOrUpdateTrade(msg.data);
            }
        } catch (err) {
            console.error("WS message parse error", err);
        }
    };

    ws.onerror = () => setDotState(wsDot, "bad");

    ws.onclose = () => {
        setDotState(wsDot, "warn");
        const { symbol, timeframe } = dashboardState.activeSelection || {};
        dashboardState.wsReconnectTimer = setTimeout(
            () => connectSocket(symbol, timeframe),
            WS_RECONNECT_DELAY
        );
    };
}

async function loadHistoryAndStream() {
    const { netDot, symbol, timeframe } = dashboardState.elements;
    if (!symbol || !timeframe) return;

    const symbolVal = symbol.value;
    const tfVal = timeframe.value;

    setDotState(netDot, "warn");
    try {
        const candles = await fetchCandles(symbolVal, tfVal);
        applyHistory(candles);
        dashboardState.activeSelection = { symbol: symbolVal, timeframe: tfVal };
        setDotState(netDot, "ok");
    } catch (err) {
        console.error("Failed to load candles", err);
        setDotState(netDot, "bad");
        return;
    }

    connectSocket(symbolVal, tfVal);
}

async function loadTrades() {
    try {
        const resp = await fetch("/api/trades");
        if (resp.ok) {
            const payload = await resp.json();
            const trades = payload.data || payload.trades || [];
            applyTrades(trades);
            return;
        }
    } catch (err) {
        console.warn("Trades API unavailable, using mock", err);
    }
    // fallback mock data to demonstrate tooltip/equity
    const now = Math.floor(Date.now() / 1000);
    applyTrades([
        {
            id: "demo-1",
            side: "long",
            entry_price: 50000,
            exit_price: 51050,
            pnl: 210,
            pnl_pct: 2.1,
            max_drawdown_pct: -1.2,
            opened_at: new Date((now - 3600 * 4) * 1000).toISOString(),
            closed_at: new Date((now - 3600 * 3) * 1000).toISOString(),
            strategy_id: "demo-alpha",
            notes: "Breakout",
        },
        {
            id: "demo-2",
            side: "short",
            entry_price: 51500,
            exit_price: 50500,
            pnl: 180,
            pnl_pct: 1.8,
            max_drawdown_pct: -0.7,
            opened_at: new Date((now - 3600 * 2) * 1000).toISOString(),
            closed_at: new Date((now - 3600 * 1.5) * 1000).toISOString(),
            strategy_id: "demo-alpha",
            notes: "Reversal",
        },
        {
            id: "demo-open",
            side: "long",
            entry_price: 50300,
            pnl: 0,
            pnl_pct: 0,
            opened_at: new Date((now - 1200) * 1000).toISOString(),
            strategy_id: "demo-alpha",
            notes: "Open position",
        },
    ]);
}

function bindControls() {
    const { symbol, timeframe } = dashboardState.elements;
    if (symbol) {
        symbol.addEventListener("change", () => loadHistoryAndStream());
    }
    if (timeframe) {
        timeframe.addEventListener("change", () => loadHistoryAndStream());
    }
}

function observeResize(root) {
    if (!window.ResizeObserver || !root) return;
    const ro = new ResizeObserver(() => {
        if (!dashboardState.chart) return;
        dashboardState.chart.applyOptions({
            width: root.clientWidth,
            height: root.clientHeight,
        });
        if (dashboardState.equityChart) {
            dashboardState.equityChart.resize();
        }
        repositionPinnedTooltip();
    });
    ro.observe(root);
}

function updateEquity() {
    if (!dashboardState.equityChart) return;
    dashboardState.equityChart.setTrades(dashboardState.trades);
}

function initDashboard() {
    dashboardState.elements = getElements();
    const { root, equityRoot, chartBody } = dashboardState.elements;
    if (!root) return;

    dashboardState.defaultSelection = {
        symbol: dashboardState.elements.symbol?.value || null,
        timeframe: dashboardState.elements.timeframe?.value || null,
    };

    const chartSetup = createChart(root);
    if (!chartSetup) return;

    dashboardState.chart = chartSetup.chart;
    dashboardState.candleSeries = chartSetup.candleSeries;
    dashboardState.tradeTooltip = new TradeTooltip(chartBody || document.body);
    dashboardState.chart.subscribeCrosshairMove(handleCrosshairMove);
    dashboardState.chart.subscribeClick(handleChartClick);
    dashboardState.chart.timeScale().subscribeVisibleTimeRangeChange(() => repositionPinnedTooltip());

    if (equityRoot) {
        dashboardState.equityChart = new EquityChart(equityRoot, dashboardState.chart, START_BALANCE);
    }

    bindControls();
    observeResize(root.parentElement || root);
    loadHistoryAndStream();
    loadTrades();
}

window.addEventListener("load", initDashboard);
