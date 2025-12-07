import os
USE_MOCK = os.getenv("CBP_USE_MOCK", "1") == "1"

import os
import random
import time
from typing import List

from web.bybit_client import fetch_ohlcv
from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.analytics.analytics_engine import AnalyticsEngine
from core.status.status_monitor import StatusMonitor
from core.services.fetch_bybit_klines import fetch_klines
from core.backtest.engine import BacktestEngine

from web.ws_live_patch import ws_live_loop

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static + templates
app.mount("/static", StaticFiles(directory="web/static"), name="static")
templates = Jinja2Templates(directory="web/templates")

# CORE instances (минимально нужные для UI)
analytics = AnalyticsEngine()
status_monitor = StatusMonitor()
backtest_engine = BacktestEngine()


# ------------------------
# MOCK HELPERS
# ------------------------
def _build_mock_trades(limit: int = 50) -> List[dict]:
    now = int(time.time())
    trades = []
    cursor = now - limit * 90
    last_price = 50000
    for i in range(limit):
        direction = "long" if i % 2 == 0 else "short"
        entry_time = cursor + i * 60
        exit_time = entry_time + random.randint(30, 240)
        if direction == "long":
            entry_price = last_price + random.randint(-50, 50)
            exit_price = entry_price + random.randint(-80, 120)
        else:
            entry_price = last_price + random.randint(-50, 50)
            exit_price = entry_price - random.randint(-120, 80)
        last_price = exit_price
        trades.append(
            {
                "id": f"mock-{i}",
                "side": direction,
                "entry_time": entry_time,
                "exit_time": exit_time,
                "entry_price": entry_price,
                "exit_price": exit_price,
            }
        )
    return trades


# ------------------------
# BASIC
# ------------------------
@app.get("/")
async def root():
    return {"status": "ok", "message": "CryptoBot Pro API"}


# ------------------------
# UI
# ------------------------
@app.get("/chart.html")
async def chart(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ------------------------
# API
# ------------------------
@app.get("/api/status")
async def api_status():
    return status_monitor.get_status()


@app.get("/api/candles")
async def api_candles():
    candles = fetch_klines()
    return {"candles": candles, "meta": {"source": "mock_bybit"}}


@app.post("/api/backtest/run")
async def api_backtest_run():
    return backtest_engine.run()


@app.get("/api/backtest/summary")
async def api_backtest_summary():
    return backtest_engine.summary()


@app.get("/api/equity")
async def api_equity():
    return analytics.get_equity_curve()


# ------------------------
# WebSocket live candles
# ------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    await ws_live_loop(ws)

@app.get("/api/candles")
async def api_candles(
    symbol: str = "BTCUSDT",
    tf: str = "1m",
    limit: int = 200,
    net: str = "testnet",
):
    # MOCK-режим: как было раньше — рисуем тестовые свечи
    if USE_MOCK:
        candles = []
        for i in range(limit):
            candles.append({
                "time": 1730000000 + i * 60,
                "open": 50000,
                "high": 50500,
                "low": 49500,
                "close": 50200,
            })
        return {"symbol": symbol, "tf": tf, "data": candles}

    # REAL TESTNET: тянем свечи с Bybit
    candles = await fetch_ohlcv(symbol=symbol, tf=tf, limit=limit)
    return {"symbol": symbol, "tf": tf, "data": candles}


@app.get("/api/trades")
async def api_trades(limit: int = 50):
    """Return recent trades for the chart overlay.

    In mock mode we emit synthetic trades that align with the candle timestamps.
    """

    trades = _build_mock_trades(limit=limit)
    return {"trades": trades, "meta": {"source": "mock_stream"}}
