class TradeTooltip {
    constructor(container) {
        this.container = container || document.body;
        this.tooltipEl = document.createElement("div");
        this.tooltipEl.className = "cbp-trade-tooltip";
        this.tooltipEl.innerHTML = "";
        this.isPinned = false;
        this.container.appendChild(this.tooltipEl);
    }

    formatDate(value) {
        if (!value) return "-";
        const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
        return date.toISOString().replace("T", " ").slice(0, 19);
    }

    formatMoney(num) {
        if (num === null || num === undefined || Number.isNaN(num)) return "-";
        const fixed = Number(num).toFixed(2);
        const sign = Number(num) > 0 ? "+" : "";
        return `${sign}${fixed}`;
    }

    formatPercent(num) {
        if (num === null || num === undefined || Number.isNaN(num)) return "-";
        const fixed = Number(num).toFixed(2);
        const sign = Number(num) > 0 ? "+" : "";
        return `${sign}${fixed}%`;
    }

    setContent(trade) {
        if (!trade) return;
        const sideClass = trade.side === "short" ? "cbp-badge-short" : "cbp-badge-long";
        const pnlClass = Number(trade.pnl || 0) >= 0 ? "cbp-text-green" : "cbp-text-red";
        const pnlPctClass = Number(trade.pnl_pct || 0) >= 0 ? "cbp-text-green" : "cbp-text-red";
        const rows = [
            `<div class="cbp-tt-header">` +
                `<span class="cbp-tt-side ${sideClass}">${trade.side || "-"}</span>` +
                `<span class="cbp-tt-strategy">${trade.strategy_id || "—"}</span>` +
            `</div>`,
            `<div class="cbp-tt-row"><span>Entry</span><span>${trade.entry_price ?? "-"}</span></div>`,
            `<div class="cbp-tt-row"><span>Exit</span><span>${trade.exit_price ?? "-"}</span></div>`,
            `<div class="cbp-tt-row"><span>PnL</span><span class="${pnlClass}">${this.formatMoney(trade.pnl)} $</span></div>`,
            `<div class="cbp-tt-row"><span>PnL%</span><span class="${pnlPctClass}">${this.formatPercent(trade.pnl_pct)}</span></div>`,
            `<div class="cbp-tt-row"><span>Max DD%</span><span>${trade.max_drawdown_pct !== undefined ? this.formatPercent(trade.max_drawdown_pct) : "-"}</span></div>`,
            `<div class="cbp-tt-row"><span>Opened</span><span>${this.formatDate(trade.opened_at)}</span></div>`,
            `<div class="cbp-tt-row"><span>Closed</span><span>${this.formatDate(trade.closed_at)}</span></div>`,
            `<div class="cbp-tt-row"><span>Notes</span><span>${trade.notes || "—"}</span></div>`,
        ];
        this.tooltipEl.innerHTML = rows.join("");
    }

    show(trade, position, containerRect) {
        if (!trade || !position) return;
        this.isPinned = !!position.pinned;
        this.setContent(trade);
        this.tooltipEl.classList.add("visible");
        const { x, y } = position;
        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        const boundaryWidth = containerRect?.width || window.innerWidth;
        const boundaryHeight = containerRect?.height || window.innerHeight;
        const rightOverflow = x + tooltipRect.width + 16 - boundaryWidth;
        const left = rightOverflow > 0 ? Math.max(x - rightOverflow, 0) : x;
        const top = Math.max(Math.min(y - tooltipRect.height - 8, boundaryHeight - tooltipRect.height - 8), 8);
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    }

    hide() {
        this.isPinned = false;
        this.tooltipEl.classList.remove("visible");
    }
}

window.TradeTooltip = TradeTooltip;
