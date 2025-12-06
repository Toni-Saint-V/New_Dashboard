import asyncio
import random
import time


async def ws_live_loop(ws):
    price = 50000
    trade_counter = 0
    while True:
        ts = int(time.time())
        candle = {
            "time": ts,
            "open": price,
            "high": price + 50,
            "low": price - 50,
            "close": price + 10,
        }
        await ws.send_json({"type": "candle", "data": candle})

        # Every 6 ticks emit a synthetic trade to drive the UI overlay
        if trade_counter % 6 == 0:
            direction = "long" if trade_counter % 12 == 0 else "short"
            entry_price = price + random.randint(-40, 40)
            exit_price = entry_price + random.randint(20, 80)
            if direction == "short":
                exit_price = entry_price - random.randint(20, 80)
            trade = {
                "id": f"ws-{ts}",
                "side": direction,
                "entry_time": ts - random.randint(30, 120),
                "exit_time": ts,
                "entry_price": entry_price,
                "exit_price": exit_price,
            }
            await ws.send_json({"type": "trade", "data": trade})

        price += random.randint(-30, 30)
        trade_counter += 1
        await asyncio.sleep(1)
