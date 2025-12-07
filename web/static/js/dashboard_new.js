const WS_RECONNECT_DELAY = 3000;
const DEFAULT_LIMIT = 300;
const TRADES_LIMIT = 5000;

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
    tradesStore: null,
};

function getElements() {
    return {
        root: document.getElementById("chart-root"),
        symbol: document.getElementById("symbol"),
        timeframe: document.getElementById("tf"),
        wsDot: document.getElementById("st-inline-ws"),
        netDot: document.getElementById("st-inline-net"),
        dealsValue: document.getElementById("deals-value"),
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

function fetchJSON(url, options) {
    return fetch(url, options).then(async (res) => {
        if (!res.ok) {
            const text = await res.text();
            throw new Error("HTTP " + res.status + " - " + text);
        }
        return res.json();
    });
}

class TradesStore {
    constructor(limit = 5000) {
        this.limit = limit;
        this.trades = [];
    }

    replace(list) {
        this.trades = Array.isArray(list) ? list.slice(-this.limit) : [];
    }

    add(trade) {
        if (!trade || !trade.id) return;
        this.trades.push(trade);
        if (this.trades.length > this.limit) {
            this.trades = this.trades.slice(-this.limit);
        }
    }

    addMany(list) {
        (list || []).forEach((t) => this.add(t));
    }

    getAll() {
        return this.trades.slice();
    }

    findByTime(ts) {
        return this.trades.find(
            (t) => t.entry_time === ts || t.exit_time === ts
        );
    }
}

class ChartWithTrades {
    constructor(rootEl, onHoverTrade) {
        this.rootEl = rootEl;
        this.onHoverTrade = onHoverTrade;
        this.chart = null;
        this.candleSeries = null;
        this.tradeLines = new Map();
        this.activeTradeId = null;
        this.markers = [];
        this._initChart();
    }

    _initChart() {
        if (!this.rootEl || !window.LightweightCharts) return;

        this.chart = LightweightCharts.createChart(this.rootEl, {
            width: this.rootEl.clientWidth,
            height: this.rootEl.clientHeight || 480,
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

        this.candleSeries = this.chart.addCandlestickSeries({
            upColor: "#2ecc71",
            downColor: "#ef5350",
            borderDownColor: "#ef5350",
            borderUpColor: "#2ecc71",
            wickDownColor: "#ef5350",
            wickUpColor: "#2ecc71",
        });

        window.addEventListener("resize", () => {
            if (!this.chart) return;
            this.chart.applyOptions({
                width: this.rootEl.clientWidth,
                height: this.rootEl.clientHeight || 480,
            });
        });

        this.chart.subscribeCrosshairMove((param) => {
            if (!param || !param.time) {
                this._setActiveTrade(null);
                return;
            }
            const hovered = window.__tradesStore?.findByTime(Number(param.time));
            if (hovered) {
                this._setActiveTrade(hovered.id);
            } else {
                this._setActiveTrade(null);
            }
        });
    }

    applyOptions(opts) {
        if (this.chart) {
            this.chart.applyOptions(opts);
        }
    }

    setCandles(candles) {
        if (!this.candleSeries) return;
        const data = (candles || []).map((c) => ({
            time: Number(c.time),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
        }));
        this.candleSeries.setData(data);
    }

    updateCandle(candle) {
        if (!this.candleSeries || !candle) return;
        this.candleSeries.update({
            time: Number(candle.time),
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
        });
    }

    _setActiveTrade(id) {
        if (this.activeTradeId === id) return;
        this.activeTradeId = id;
        this._refreshTradeStyles();
        if (typeof this.onHoverTrade === "function") {
            this.onHoverTrade(id);
        }
    }

    _refreshTradeStyles() {
        this.tradeLines.forEach((series, tradeId) => {
            const isActive = tradeId === this.activeTradeId;
            series.applyOptions({
                lineWidth: isActive ? 3 : 2,
                color: series._cbpSide === "long" ? "#22c55e" : "#ef4444",
            });
        });

        const markers = this.markers.map((m) => {
            const isActive = m.tradeId === this.activeTradeId;
            return {
                ...m,
                color: isActive ? "#facc15" : m.baseColor,
            };
        });
        if (this.candleSeries) {
            this.candleSeries.setMarkers(markers);
        }
    }

    setTrades(trades) {
        if (!this.chart) return;
        const nextMarkers = [];
        const seen = new Set();

        (trades || []).forEach((t) => {
            const side = t.side === "short" ? "short" : "long";
            seen.add(t.id);
            const line = this._ensureTradeLine(t.id, side);
            line.setData([
                { time: Number(t.entry_time), value: Number(t.entry_price) },
                { time: Number(t.exit_time), value: Number(t.exit_price) },
            ]);
            nextMarkers.push({
                time: Number(t.entry_time),
                position: "belowBar",
                shape: side === "long" ? "arrowUp" : "arrowDown",
                color: side === "long" ? "#22c55e" : "#ef4444",
                baseColor: side === "long" ? "#22c55e" : "#ef4444",
                tradeId: t.id,
                text: "entry",
            });
            nextMarkers.push({
                time: Number(t.exit_time),
                position: "aboveBar",
                shape: side === "long" ? "arrowDown" : "arrowUp",
                color: side === "long" ? "#22c55e" : "#ef4444",
                baseColor: side === "long" ? "#22c55e" : "#ef4444",
                tradeId: t.id,
                text: "exit",
            });
        });

        // cleanup stale series
        Array.from(this.tradeLines.keys()).forEach((id) => {
            if (!seen.has(id)) {
                const series = this.tradeLines.get(id);
                this.chart.removeSeries(series);
                this.tradeLines.delete(id);
            }
        });

        this.markers = nextMarkers;
        if (this.candleSeries) {
            this.candleSeries.setMarkers(nextMarkers);
        }
        this._refreshTradeStyles();
    }

    _ensureTradeLine(id, side) {
        if (this.tradeLines.has(id)) return this.tradeLines.get(id);
        const line = this.chart.addLineSeries({
            color: side === "long" ? "#22c55e" : "#ef4444",
            lineWidth: 2,
        });
        line._cbpSide = side;
        this.tradeLines.set(id, line);
        return line;
    }
}

function createChart(root) {
    if (!root) return null;
    root.innerHTML = "";

    const tradesStore = new TradesStore(TRADES_LIMIT);
    window.__tradesStore = tradesStore;
    dashboardState.tradesStore = tradesStore;

    const chart = new ChartWithTrades(root, (tradeId) => {
        window.dispatchEvent(
            new CustomEvent("trade-hover", { detail: { tradeId } })
        );
    });

    return { chart, candleSeries: chart.candleSeries };
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
    const url = `/api/candles?symbol=${encodeURIComponent(
        symbol
    )}&tf=${encodeURIComponent(timeframe)}&limit=${DEFAULT_LIMIT}`;
    const payload = await fetchJSON(url);
    const data = payload.data || payload.candles || [];
    return data.map(normalizeCandle).sort((a, b) => a.time - b.time);
}

async function fetchTrades(limit = TRADES_LIMIT) {
    const payload = await fetchJSON(`/api/trades?limit=${limit}`);
    return payload.trades || [];
}

function applyHistory(candles) {
    dashboardState.candles = candles;
    dashboardState.lastCandleTime = candles.length
        ? candles[candles.length - 1].time
        : null;

    if (
        dashboardState.chart &&
        typeof dashboardState.chart.setCandles === "function"
    ) {
        dashboardState.chart.setCandles(candles);
    } else if (dashboardState.candleSeries) {
        dashboardState.candleSeries.setData(candles);
    }
}

function handleLiveCandle(candle) {
    const item = normalizeCandle(candle);
    dashboardState.lastCandleTime = Math.max(
        dashboardState.lastCandleTime || 0,
        item.time
    );

    if (
        dashboardState.chart &&
        typeof dashboardState.chart.updateCandle === "function"
    ) {
        dashboardState.chart.updateCandle(item);
    } else if (dashboardState.candleSeries) {
        dashboardState.candleSeries.update(item);
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

    // Если стрим не даёт метаданные, принимаем только когда
    // мы на дефолтном выборе инструмента/таймфрейма.
    if (defaultSelection.symbol && defaultSelection.timeframe) {
        return (
            symbol === defaultSelection.symbol &&
            timeframe === defaultSelection.timeframe
        );
    }

    return true;
}

function connectSocket(symbol, timeframe) {
    closeSocket();
    const { wsDot, dealsValue } = dashboardState.elements;
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
    ws.onerror = () => setDotState(wsDot, "bad");

    ws.onclose = () => {
        setDotState(wsDot, "warn");
        const { symbol: sym, timeframe: tf } =
            dashboardState.activeSelection || {};
        dashboardState.wsReconnectTimer = setTimeout(
            () => connectSocket(sym, tf),
            WS_RECONNECT_DELAY
        );
    };

    ws.onmessage = (evt) => {
        try {
            const msg = JSON.parse(evt.data);

            if (msg.type === "candle" && msg.data && isMatchingLiveCandle(msg)) {
                handleLiveCandle(msg.data);
            }

            if (msg.type === "trade" && msg.data && isMatchingLiveCandle(msg)) {
                const store = dashboardState.tradesStore;
                if (store) {
                    store.add(msg.data);
                    if (
                        dashboardState.chart &&
                        typeof dashboardState.chart.setTrades === "function"
                    ) {
                        dashboardState.chart.setTrades(store.getAll());
                    }
                    if (dealsValue) {
                        dealsValue.textContent = store.getAll().length;
                    }
                }
            }
        } catch (err) {
            console.error("WS message parse error", err);
        }
    };
}

async function loadHistoryAndStream() {
    const { netDot, symbol, timeframe, dealsValue } = dashboardState.elements;
    if (!symbol || !timeframe) return;

    const symbolVal = symbol.value;
    const tfVal = timeframe.value;

    setDotState(netDot, "warn");
    try {
        const candles = await fetchCandles(symbolVal, tfVal);
        applyHistory(candles);
        dashboardState.activeSelection = {
            symbol: symbolVal,
            timeframe: tfVal,
        };
        setDotState(netDot, "ok");
    } catch (err) {
        console.error("Failed to load candles", err);
        setDotState(netDot, "bad");
        return;
    }

    // Исторические трейды (best-effort)
    try {
        if (dashboardState.tradesStore) {
            const trades = await fetchTrades(TRADES_LIMIT);
            dashboardState.tradesStore.replace(trades);
            if (
                dashboardState.chart &&
                typeof dashboardState.chart.setTrades === "function"
            ) {
                dashboardState.chart.setTrades(
                    dashboardState.tradesStore.getAll()
                );
            }
            if (dealsValue) {
                dealsValue.textContent =
                    dashboardState.tradesStore.getAll().length;
            }
        }
    } catch (err) {
        console.error("Failed to load trades", err);
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
