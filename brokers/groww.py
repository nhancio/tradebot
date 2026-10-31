"""
brokers/groww.py
────────────────
Groww Trade API (https://groww.in/trade-api) via the official growwapi SDK.

Auth is an API key plus either a TOTP secret (no daily approval) or an
API secret (daily approval checksum). There is no OAuth redirect.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import pyotp

from .base import (
    BrokerAPI,
    Funds,
    Holding,
    OptionsContract,
    Order,
    OrderRequest,
    OrderResponse,
    Position,
    Quote,
    UserProfile,
)

TOKEN_FILE = Path.home() / ".trading_platform" / "groww.json"


def _num(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _rows(payload) -> list:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("holdings", "positions", "order_list", "orders", "data", "payload"):
        val = payload.get(key)
        if isinstance(val, list):
            return val
    return [payload] if payload.get("trading_symbol") or payload.get("symbol") else []


def map_holding(row: dict) -> Holding:
    qty = int(_num(row.get("quantity") or row.get("qty")))
    avg = _num(row.get("average_price") or row.get("avg_price"))
    ltp = _num(row.get("ltp") or row.get("last_price") or avg)
    pnl = row.get("pnl")
    if pnl is None:
        pnl = (ltp - avg) * qty
    pnl = _num(pnl)
    return Holding(
        symbol=str(row.get("trading_symbol") or row.get("symbol") or ""),
        exchange=str(row.get("exchange") or "NSE"),
        quantity=qty,
        avg_price=avg,
        last_price=ltp,
        pnl=pnl,
        pnl_pct=(pnl / (avg * qty) * 100) if avg and qty else 0.0,
    )


def map_position(row: dict) -> Position:
    qty = int(_num(row.get("quantity") or row.get("net_quantity") or row.get("qty")))
    credit = int(_num(row.get("credit_quantity")))
    debit = int(_num(row.get("debit_quantity")))
    if not qty and (credit or debit):
        qty = credit - debit
    avg = _num(row.get("net_price") or row.get("average_price") or row.get("avg_price"))
    ltp = _num(row.get("ltp") or row.get("last_price") or avg)
    return Position(
        symbol=str(row.get("trading_symbol") or row.get("symbol") or ""),
        exchange=str(row.get("exchange") or "NSE"),
        product=str(row.get("product") or "CNC"),
        quantity=qty,
        avg_price=avg,
        last_price=ltp,
        pnl=_num(row.get("pnl") or row.get("realised_pnl")),
        instrument_type="FUT" if str(row.get("segment", "")).upper() == "FNO" else "EQ",
    )


def map_order(row: dict) -> Order:
    return Order(
        order_id=str(row.get("groww_order_id") or row.get("order_id") or ""),
        symbol=str(row.get("trading_symbol") or row.get("symbol") or ""),
        exchange=str(row.get("exchange") or "NSE"),
        transaction_type=str(row.get("transaction_type") or ""),
        quantity=int(_num(row.get("quantity") or row.get("qty"))),
        order_type=str(row.get("order_type") or ""),
        product=str(row.get("product") or ""),
        status=str(row.get("order_status") or row.get("status") or ""),
        price=_num(row.get("price")) or None,
        average_price=_num(row.get("average_fill_price") or row.get("average_price")) or None,
        filled_quantity=int(_num(row.get("filled_quantity") or row.get("filledQty"))),
        placed_at=row.get("created_at"),
        tag=row.get("order_reference_id"),
    )


def map_quote(symbol: str, row: dict) -> Quote:
    ohlc = row.get("ohlc") or {}
    last = _num(row.get("last_price"))
    prev = _num(ohlc.get("close") or row.get("close"))
    change = row.get("day_change")
    change = _num(change) if change is not None else (last - prev)
    depth_buy = ((row.get("depth") or {}).get("buy") or [{}])[0]
    depth_sell = ((row.get("depth") or {}).get("sell") or [{}])[0]
    return Quote(
        symbol=symbol,
        last_price=last,
        open=_num(ohlc.get("open") or row.get("open")),
        high=_num(ohlc.get("high") or row.get("high")),
        low=_num(ohlc.get("low") or row.get("low")),
        close=prev,
        volume=int(_num(row.get("volume"))),
        oi=int(_num(row.get("open_interest"))) or None,
        bid=_num(row.get("bid_price") or depth_buy.get("price")) or None,
        ask=_num(row.get("offer_price") or depth_sell.get("price")) or None,
        change=change,
        change_pct=_num(row.get("day_change_perc")),
    )


def map_funds(row: dict) -> Funds:
    if not isinstance(row, dict):
        row = {}
    cash = row.get("clear_cash")
    if cash is None:
        cash = row.get("available_margin") or row.get("available_balance")
    if cash is None:
        equity = row.get("equity") or row.get("fno") or {}
        if isinstance(equity, dict):
            cash = equity.get("net_margin") or equity.get("available_margin")
    available = _num(cash)
    used = _num(row.get("used_margin") or row.get("utilised_margin"))
    total = _num(row.get("total_balance") or row.get("net_margin") or (available + used))
    return Funds(available_cash=available, used_margin=used, total_balance=total or available)


class GrowwAPI(BrokerAPI):
    """BrokerAPI backed by growwapi.GrowwAPI."""

    def __init__(
        self,
        api_key: str = "",
        totp_secret: str = "",
        api_secret: str = "",
        **kwargs,
    ) -> None:
        # Old call sites passed (client_id, client_secret).
        if not api_key:
            api_key = kwargs.get("client_id") or ""
        if not api_secret and not totp_secret:
            api_secret = kwargs.get("client_secret") or ""
        self.api_key = api_key
        self.totp_secret = totp_secret
        self.api_secret = api_secret
        self._token: dict = self._load_token() or {}
        self._sdk = None

    def _save_token(self, access_token: str) -> None:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {"access_token": access_token, "saved_on": datetime.now().date().isoformat()}
        TOKEN_FILE.write_text(json.dumps(data))
        self._token = data
        self._sdk = None

    def _load_token(self) -> dict | None:
        if TOKEN_FILE.exists():
            try:
                return json.loads(TOKEN_FILE.read_text())
            except json.JSONDecodeError:
                return None
        return None

    def _token_fresh(self) -> bool:
        return bool(
            self._token.get("access_token")
            and self._token.get("saved_on") == datetime.now().date().isoformat()
        )

    def _client(self):
        if self._sdk is not None:
            return self._sdk
        if not self._token_fresh():
            self.complete_login()
        from growwapi import GrowwAPI as Sdk

        self._sdk = Sdk(self._token["access_token"])
        return self._sdk

    def get_login_url(self) -> str:
        return "https://groww.in/trade-api/docs/python-sdk"

    def complete_login(self, **_) -> UserProfile:
        if not self.api_key:
            raise RuntimeError(
                "Groww API key missing. Set GROWW_API_KEY from https://groww.in/trade-api"
            )
        from growwapi import GrowwAPI as Sdk

        if self.totp_secret:
            totp = pyotp.TOTP(self.totp_secret).now()
            token = Sdk.get_access_token(api_key=self.api_key, totp=totp)
        elif self.api_secret:
            token = Sdk.get_access_token(api_key=self.api_key, secret=self.api_secret)
        else:
            raise RuntimeError(
                "Set GROWW_TOTP_SECRET (preferred) or GROWW_API_SECRET next to GROWW_API_KEY."
            )
        if isinstance(token, dict):
            token = token.get("access_token") or token.get("token") or ""
        if not token:
            raise RuntimeError("Groww did not return an access token.")
        self._save_token(str(token))
        return self.get_profile()

    def is_authenticated(self) -> bool:
        if not self._token_fresh():
            return False
        try:
            self._client().get_available_margin_details()
            return True
        except Exception:
            return False

    def logout(self) -> None:
        TOKEN_FILE.unlink(missing_ok=True)
        self._token = {}
        self._sdk = None

    def get_profile(self) -> UserProfile:
        raw = self._client().get_user_profile()
        row = raw.get("payload", raw) if isinstance(raw, dict) else {}
        if not isinstance(row, dict):
            row = {}
        return UserProfile(
            user_id=str(row.get("ucc") or row.get("user_id") or "groww"),
            name=str(row.get("name") or row.get("full_name") or "Groww"),
            email=str(row.get("email_id") or row.get("email") or ""),
            broker="GROWW",
        )

    def get_funds(self) -> Funds:
        return map_funds(self._client().get_available_margin_details())

    def get_holdings(self) -> list[Holding]:
        sdk = self._client()
        payload = sdk.get_holdings_for_user(timeout=10)
        return [map_holding(r) for r in _rows(payload) if isinstance(r, dict)]

    def get_positions(self) -> list[Position]:
        sdk = self._client()
        payload = sdk.get_positions_for_user()
        return [map_position(r) for r in _rows(payload) if isinstance(r, dict)]

    def get_quote(self, instruments: list[str]) -> dict[str, Quote]:
        sdk = self._client()
        out: dict[str, Quote] = {}
        for inst in instruments:
            exchange, symbol = (inst.split(":", 1) + [inst])[:2] if ":" in inst else ("NSE", inst)
            segment = sdk.SEGMENT_FNO if exchange.upper() in {"NFO", "BFO"} else sdk.SEGMENT_CASH
            exch = sdk.EXCHANGE_BSE if exchange.upper() == "BSE" else sdk.EXCHANGE_NSE
            row = sdk.get_quote(exchange=exch, segment=segment, trading_symbol=symbol)
            if isinstance(row, dict) and "payload" in row and isinstance(row["payload"], dict):
                row = row["payload"]
            out[inst] = map_quote(symbol, row if isinstance(row, dict) else {})
        return out

    def get_options_chain(
        self, underlying: str, expiry: Optional[str] = None
    ) -> list[OptionsContract]:
        sdk = self._client()
        if not expiry:
            raw_exp = sdk.get_expiries(exchange=sdk.EXCHANGE_NSE, underlying_symbol=underlying)
            dates = _rows(raw_exp)
            if not dates and isinstance(raw_exp, dict):
                dates = raw_exp.get("expiries") or raw_exp.get("expiry_dates") or []
            expiry = None
            for item in dates:
                if isinstance(item, str):
                    expiry = item
                    break
                if isinstance(item, dict):
                    expiry = item.get("expiry") or item.get("date") or item.get("expiry_date")
                    if expiry:
                        break
            if not expiry:
                return []
        raw = sdk.get_option_chain(
            exchange=sdk.EXCHANGE_NSE, underlying=underlying, expiry_date=expiry
        )
        contracts: list[OptionsContract] = []
        rows = _rows(raw)
        if not rows and isinstance(raw, dict):
            strikes = raw.get("strikes") or raw.get("option_chain") or raw.get("payload") or {}
            if isinstance(strikes, dict):
                for strike, legs in strikes.items():
                    if isinstance(legs, dict):
                        for side, leg in legs.items():
                            if isinstance(leg, dict):
                                leg = {**leg, "strike": strike, "option_type": side}
                                rows.append(leg)
                    elif isinstance(legs, list):
                        rows.extend(legs)
            elif isinstance(strikes, list):
                rows = strikes
        for row in rows:
            if not isinstance(row, dict):
                continue
            side = str(row.get("option_type") or row.get("type") or "").upper()
            if side in {"CALL", "C"}:
                side = "CE"
            elif side in {"PUT", "P"}:
                side = "PE"
            if side not in {"CE", "PE"}:
                continue
            contracts.append(
                OptionsContract(
                    symbol=str(row.get("trading_symbol") or row.get("symbol") or ""),
                    underlying=underlying,
                    expiry=str(expiry),
                    strike=_num(row.get("strike") or row.get("strike_price")),
                    option_type=side,
                    last_price=_num(row.get("ltp") or row.get("last_price")),
                    oi=int(_num(row.get("open_interest") or row.get("oi"))),
                    oi_change=int(_num(row.get("oi_day_change") or row.get("oi_change"))),
                    volume=int(_num(row.get("volume"))),
                    iv=_num(row.get("iv") or row.get("implied_volatility")) or None,
                )
            )
        return contracts

    def place_order(self, order: OrderRequest) -> OrderResponse:
        sdk = self._client()
        segment = sdk.SEGMENT_FNO if order.exchange.upper() in {"NFO", "BFO"} else sdk.SEGMENT_CASH
        exch = sdk.EXCHANGE_BSE if order.exchange.upper() == "BSE" else sdk.EXCHANGE_NSE
        product = {
            "CNC": sdk.PRODUCT_CNC,
            "MIS": sdk.PRODUCT_MIS,
            "NRML": sdk.PRODUCT_NRML,
        }.get(order.product.upper(), order.product)
        order_type = {
            "MARKET": sdk.ORDER_TYPE_MARKET,
            "LIMIT": sdk.ORDER_TYPE_LIMIT,
            "SL": sdk.ORDER_TYPE_STOP_LOSS,
            "SL-M": sdk.ORDER_TYPE_STOP_LOSS_MARKET,
        }.get(order.order_type.upper(), order.order_type)
        side = (
            sdk.TRANSACTION_TYPE_BUY
            if order.transaction_type.upper() == "BUY"
            else sdk.TRANSACTION_TYPE_SELL
        )
        validity = sdk.VALIDITY_IOC if order.validity.upper() == "IOC" else sdk.VALIDITY_DAY
        kwargs = dict(
            trading_symbol=order.symbol,
            quantity=order.quantity,
            validity=validity,
            exchange=exch,
            segment=segment,
            product=product,
            order_type=order_type,
            transaction_type=side,
        )
        if order.price is not None:
            kwargs["price"] = order.price
        if order.trigger_price is not None:
            kwargs["trigger_price"] = order.trigger_price
        if order.tag:
            kwargs["order_reference_id"] = order.tag[:20]
        raw = sdk.place_order(**kwargs)
        row = raw if isinstance(raw, dict) else {}
        if isinstance(row.get("payload"), dict):
            row = row["payload"]
        return OrderResponse(
            order_id=str(row.get("groww_order_id") or row.get("order_id") or ""),
            status=str(row.get("order_status") or row.get("status") or "OPEN"),
            message=str(row.get("remark") or "Order placed"),
            average_price=_num(row.get("average_fill_price")) or None,
            filled_quantity=int(_num(row.get("filled_quantity"))),
        )

    def get_orders(self) -> list[Order]:
        payload = self._client().get_order_list(page=0, page_size=100)
        return [map_order(r) for r in _rows(payload) if isinstance(r, dict)]

    def cancel_order(self, order_id: str) -> bool:
        sdk = self._client()
        sdk.cancel_order(groww_order_id=order_id, segment=sdk.SEGMENT_CASH)
        return True
