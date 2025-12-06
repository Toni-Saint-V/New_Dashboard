const dashboardState = {
    chart: null,
    candleSeries: null,
    candles: [],
    lastCandleTime: null,
    ws: null,
    wsReconnectTimer: null,
    activeSelection: { symbol: null, timeframe: null },
    defaultSelection: { symbol: null, timeframe: null },
    elements: {},
};

const WS_RECONNECT_DELAY = 3000;
const DEFAULT_LIMIT = 300;

function getElements() {
    return {
        root: document.getElementById("chart-root"),
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

function normalizeCandle(c) {
    return {
        time: Number(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
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

    // If the stream doesn't provide metadata, only accept it when we are viewing the
    // default selection to avoid mixing instruments/intervals.
    if (defaultSelection.symbol && defaultSelection.timeframe) {
        return (
            symbol === defaultSelection.symbol && timeframe === defaultSelection.timeframe
        );
    }

    return true;
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
    });
    ro.observe(root);
}

function initDashboard() {
    dashboardState.elements = getElements();
    const { root } = dashboardState.elements;
    if (!root) return;

    dashboardState.defaultSelection = {
        symbol: dashboardState.elements.symbol?.value || null,
        timeframe: dashboardState.elements.timeframe?.value || null,
    };

    const chartSetup = createChart(root);
    if (!chartSetup) return;

    dashboardState.chart = chartSetup.chart;
    dashboardState.candleSeries = chartSetup.candleSeries;

    bindControls();
    observeResize(root);
    loadHistoryAndStream();
}

window.addEventListener("load", initDashboard);
