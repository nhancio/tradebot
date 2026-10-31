"""Mapping checks for Groww payloads and Screener ratio HTML."""

from analysis.fundamental import parse_screener_ratios
from brokers.groww import map_funds, map_holding, map_order, map_quote


def test_screener_ratio_html():
    html = """
    <li class="flex" data-source="default">
      <span class="name">Stock P/E</span>
      <span class="nowrap value"><span class="number">22.1</span></span>
    </li>
    <li><span class="name">ROE</span><span class="number">9.2</span>%</li>
    """
    ratios = parse_screener_ratios(html)
    assert ratios["Stock P/E"] == "22.1"
    assert ratios["ROE"] == "9.2"


def test_groww_maps():
    holding = map_holding(
        {"trading_symbol": "RELIANCE", "quantity": 2, "average_price": 100, "ltp": 110}
    )
    assert holding.symbol == "RELIANCE"
    assert holding.pnl == 20

    order = map_order(
        {"groww_order_id": "G1", "trading_symbol": "WIPRO", "quantity": 1, "order_status": "OPEN"}
    )
    assert order.order_id == "G1"
    assert order.status == "OPEN"

    quote = map_quote("WIPRO", {"last_price": 250, "ohlc": {"open": 248, "high": 252, "low": 247, "close": 249}, "volume": 10})
    assert quote.last_price == 250
    assert quote.close == 249

    funds = map_funds({"clear_cash": 1500.5, "used_margin": 10})
    assert funds.available_cash == 1500.5
