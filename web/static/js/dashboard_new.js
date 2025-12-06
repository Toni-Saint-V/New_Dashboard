const WS_URL = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/ws";

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
            layout: { background: { color: "#0f172a" }, textColor: "#cbd5e1" },
            grid: {
                vertLines: { color: "#111827" },
                horzLines: { color: "#111827" },
            },
            timeScale: { timeVisible: true, secondsVisible: true },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        });
        this.candleSeries = this.chart.addCandlestickSeries({
            upColor: "#22c55e",
            downColor: "#ef4444",
            wickUpColor: "#22c55e",
            wickDownColor: "#ef4444",
            borderVisible: false,
        });

        window.addEventListener("resize", () => {
            if (!this.chart) return;
            this.chart.applyOptions({ width: this.rootEl.clientWidth });
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

async function bootstrap() {
    const root = document.getElementById("chart-root");
    if (!root) return;

    const tradesStore = new TradesStore(5000);
    window.__tradesStore = tradesStore;

    const chart = new ChartWithTrades(root, (tradeId) => {
        window.dispatchEvent(
            new CustomEvent("trade-hover", { detail: { tradeId } })
        );
    });

    const symbolEl = document.getElementById("symbol");
    const tfEl = document.getElementById("tf");
    const dealsValue = document.getElementById("deals-value");
    const wsDot = document.getElementById("st-inline-ws");

    const updateDeals = () => {
        if (dealsValue) dealsValue.textContent = tradesStore.getAll().length;
    };

    async function loadCandles() {
        const symbol = symbolEl ? symbolEl.value : "BTCUSDT";
        const tf = tfEl ? tfEl.value : "1m";
        const data = await fetchJSON(
            `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`
        );
        const candles = data.data || data.candles || [];
        chart.setCandles(candles);
    }

    async function loadTrades() {
        const data = await fetchJSON("/api/trades?limit=5000");
        const trades = data.trades || [];
        tradesStore.replace(trades);
        chart.setTrades(tradesStore.getAll());
        updateDeals();
    }

    function connectWs() {
        const ws = new WebSocket(WS_URL);
        if (wsDot) wsDot.className = "cbp-dot cbp-dot-warn";

        ws.onopen = () => {
            if (wsDot) wsDot.className = "cbp-dot cbp-dot-ok";
        };
        ws.onclose = () => {
            if (wsDot) wsDot.className = "cbp-dot cbp-dot-bad";
            setTimeout(connectWs, 2000);
        };
        ws.onerror = () => {
            if (wsDot) wsDot.className = "cbp-dot cbp-dot-bad";
        };
        ws.onmessage = (msg) => {
            try {
                const payload = JSON.parse(msg.data);
                if (payload.type === "candle") {
                    chart.updateCandle(payload.data);
                }
                if (payload.type === "trade") {
                    tradesStore.add(payload.data);
                    chart.setTrades(tradesStore.getAll());
                    updateDeals();
                }
            } catch (e) {
                console.error("WS parse error", e);
            }
        };
    }

    async function loadAll() {
        await loadCandles();
        await loadTrades();
    }

    if (symbolEl) symbolEl.addEventListener("change", loadAll);
    if (tfEl) tfEl.addEventListener("change", loadAll);

    await loadAll();
    connectWs();
}

window.addEventListener("DOMContentLoaded", bootstrap);
