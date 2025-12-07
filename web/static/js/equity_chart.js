const DEFAULT_START_BALANCE = 10000;

class EquityChart {
    constructor(root, mainChart, startBalance = DEFAULT_START_BALANCE) {
        this.root = root;
        this.chart = null;
        this.series = null;
        this.mainChart = mainChart;
        this.startBalance = startBalance;
        this._syncLock = false;
        if (this.root) {
            this.initChart();
        }
    }

    initChart() {
        this.chart = LightweightCharts.createChart(this.root, {
            width: this.root.clientWidth,
            height: this.root.clientHeight,
            layout: { background: { color: "#050811" }, textColor: "#c9d1d9" },
            grid: {
                vertLines: { color: "#0f1626" },
                horzLines: { color: "#0f1626" },
            },
            timeScale: { borderColor: "#30363d" },
            rightPriceScale: { borderColor: "#30363d" },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        });

        this.series = this.chart.addAreaSeries({
            lineColor: "#22c55e",
            topColor: "rgba(34, 197, 94, 0.25)",
            bottomColor: "rgba(34, 197, 94, 0.05)",
            lineWidth: 2,
            priceLineVisible: false,
        });

        this.series.setData([]);
        this.bindSync();
    }

    bindSync() {
        if (!this.chart || !this.mainChart) return;
        const mainScale = this.mainChart.timeScale();
        const eqScale = this.chart.timeScale();

        mainScale.subscribeVisibleLogicalRangeChange((range) => {
            if (this._syncLock || !range) return;
            this._syncLock = true;
            eqScale.setVisibleLogicalRange(range);
            this._syncLock = false;
        });

        eqScale.subscribeVisibleLogicalRangeChange((range) => {
            if (this._syncLock || !range) return;
            this._syncLock = true;
            mainScale.setVisibleLogicalRange(range);
            this._syncLock = false;
        });
    }

    computeEquity(trades) {
        if (!Array.isArray(trades) || !trades.length) return [];
        const sorted = [...trades].sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0));
        let equity = this.startBalance;
        const points = [];
        const firstTime = sorted[0].sortTime || Math.floor(Date.now() / 1000);
        points.push({ time: firstTime, value: equity });

        for (const t of sorted) {
            equity += Number(t.pnl || 0);
            const ts = t.closed_ts || t.open_ts || t.sortTime || firstTime;
            points.push({ time: ts, value: Number(equity.toFixed(2)) });
        }

        return points;
    }

    applyDrawdownMarker(points) {
        if (!this.series) return;
        const markers = [];
        let peak = -Infinity;
        let worst = null;
        for (const p of points) {
            peak = Math.max(peak, p.value);
            const drawdown = p.value - peak;
            if (!worst || drawdown < worst.drawdown) {
                worst = { ...p, drawdown };
            }
        }
        if (worst && worst.drawdown < 0) {
            markers.push({
                time: worst.time,
                position: "belowBar",
                color: "#ef5350",
                shape: "circle",
                text: "DD",
            });
        }
        this.series.setMarkers(markers);
    }

    setTrades(trades) {
        if (!this.series) return;
        const points = this.computeEquity(trades);
        this.series.setData(points);
        this.applyDrawdownMarker(points);
    }

    resize() {
        if (!this.chart || !this.root) return;
        this.chart.applyOptions({ width: this.root.clientWidth, height: this.root.clientHeight });
    }
}

window.EquityChart = EquityChart;
window.DEFAULT_START_BALANCE = DEFAULT_START_BALANCE;
