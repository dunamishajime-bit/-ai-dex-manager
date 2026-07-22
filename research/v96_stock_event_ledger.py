from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
COLLECTOR_ID = "V96_STOCK_EVENT_LEDGER_V1"
DEFAULT_START_UTC = "2026-07-22T23:00:00Z"
DEFAULT_END_UTC = "2026-07-29T01:00:00Z"

ASTER_API = "https://fapi.asterdex.com"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
NASDAQ_EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings"
NASDAQ_HALTS_RSS = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts"
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics"
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BEA_SCHEDULE_URL = "https://www.bea.gov/news/schedule/"

DEFAULT_HEADERS = {
    "Accept": "application/json,text/xml,application/xml,text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "Chrome/126.0 Safari/537.36 DisDex-Research/1.0"
    ),
}
SEC_HEADERS = {
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",
    "User-Agent": "DisDex-Research/1.0 github.com/dunamishajime-bit/-ai-dex-manager",
}

SYMBOLS: Dict[str, Dict[str, Any]] = {
    "ADBEUSDT": {"ticker": "ADBE", "company": "Adobe", "aliases": ["Adobe"]},
    "AMATUSDT": {"ticker": "AMAT", "company": "Applied Materials", "aliases": ["Applied Materials"]},
    "AMDUSDT": {"ticker": "AMD", "company": "Advanced Micro Devices", "aliases": ["AMD", "Advanced Micro Devices"]},
    "AMZNUSDT": {"ticker": "AMZN", "company": "Amazon", "aliases": ["Amazon"]},
    "ARMUSDT": {"ticker": "ARM", "company": "Arm Holdings", "aliases": ["Arm Holdings"]},
    "ASMLUSDT": {"ticker": "ASML", "company": "ASML Holding", "aliases": ["ASML"]},
    "AVGOUSDT": {"ticker": "AVGO", "company": "Broadcom", "aliases": ["Broadcom"]},
    "CRMUSDT": {"ticker": "CRM", "company": "Salesforce", "aliases": ["Salesforce"]},
    "DRAMUSDT": {"ticker": None, "company": "DRAM", "aliases": ["DRAM"], "secEnabled": False},
    "GOOGLUSDT": {"ticker": "GOOGL", "company": "Alphabet", "aliases": ["Alphabet", "Google"]},
    "INTCUSDT": {"ticker": "INTC", "company": "Intel", "aliases": ["Intel"]},
    "METAUSDT": {"ticker": "META", "company": "Meta Platforms", "aliases": ["Meta Platforms", "Meta"]},
    "MRVLUSDT": {"ticker": "MRVL", "company": "Marvell Technology", "aliases": ["Marvell"]},
    "MSFTUSDT": {"ticker": "MSFT", "company": "Microsoft", "aliases": ["Microsoft"]},
    "MUUSDT": {"ticker": "MU", "company": "Micron Technology", "aliases": ["Micron"]},
    "NVDAUSDT": {"ticker": "NVDA", "company": "NVIDIA", "aliases": ["NVIDIA"]},
    "ORCLUSDT": {"ticker": "ORCL", "company": "Oracle", "aliases": ["Oracle"]},
    "PLTRUSDT": {"ticker": "PLTR", "company": "Palantir Technologies", "aliases": ["Palantir"]},
    "QCOMUSDT": {"ticker": "QCOM", "company": "Qualcomm", "aliases": ["Qualcomm"]},
    "SNDKUSDT": {"ticker": "SNDK", "company": "Sandisk", "aliases": ["Sandisk", "SanDisk"]},
    "TSLAUSDT": {"ticker": "TSLA", "company": "Tesla", "aliases": ["Tesla"]},
    "TSMUSDT": {"ticker": "TSM", "company": "Taiwan Semiconductor Manufacturing", "aliases": ["TSMC", "Taiwan Semiconductor"]},
}

NEWS_GROUPS: Tuple[Tuple[str, ...], ...] = (
    ("ADBEUSDT", "AMZNUSDT", "CRMUSDT", "GOOGLUSDT", "METAUSDT", "MSFTUSDT", "ORCLUSDT", "PLTRUSDT", "TSLAUSDT"),
    ("AMDUSDT", "ARMUSDT", "AVGOUSDT", "INTCUSDT", "MRVLUSDT", "NVDAUSDT", "QCOMUSDT"),
    ("AMATUSDT", "ASMLUSDT", "MUUSDT", "SNDKUSDT", "TSMUSDT"),
    ("DRAMUSDT",),
)

RISK_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "EARNINGS": ("earnings", "results", "guidance", "outlook", "revenue", "profit warning"),
    "CAPITAL_ACTION": ("offering", "secondary", "convertible", "buyback", "repurchase", "stock split", "reverse split"),
    "M_AND_A": ("acquisition", "acquire", "merger", "takeover", "divest"),
    "LEGAL_REGULATORY": ("lawsuit", "investigation", "subpoena", "antitrust", "regulator", "export restriction", "sanction"),
    "MANAGEMENT": ("ceo resign", "chief executive resign", "cfo resign", "appoints ceo", "leadership change"),
    "OPERATIONS": ("recall", "cybersecurity", "data breach", "outage", "bankruptcy", "restructuring"),
    "TRADING_STATUS": ("trading halt", "halted", "suspended", "delisting"),
}

SEC_FORMS = {
    "8-K", "8-K/A", "6-K", "6-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A",
    "20-F", "20-F/A", "40-F", "40-F/A", "S-3", "S-3ASR", "F-3", "F-3ASR",
    "424B2", "424B3", "424B4", "424B5", "DEF 14A", "SC 13D", "SC 13D/A",
    "SC 13G", "SC 13G/A", "25", "25-NSE",
}

HIGH_IMPACT_BLS = (
    "Consumer Price Index",
    "Producer Price Index",
    "Employment Situation",
    "Job Openings and Labor Turnover",
    "Employment Cost Index",
    "U.S. Import and Export Price Indexes",
    "Productivity and Costs",
    "Real Earnings",
)

MONTHS = {
    name: number
    for number, name in enumerate(
        ("January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"),
        1,
    )
}


def utc_now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(value: Optional[dt.datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def stable_id(*parts: Any) -> str:
    payload = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def fetch_bytes(
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 20,
    retries: int = 2,
) -> Tuple[bytes, Dict[str, Any]]:
    request = urllib.request.Request(url, headers=headers or DEFAULT_HEADERS)
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                return payload, {
                    "ok": True,
                    "status": getattr(response, "status", 200),
                    "latencyMs": round((time.monotonic() - started) * 1000.0, 3),
                    "bytes": len(payload),
                    "contentType": response.headers.get("Content-Type"),
                }
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
    return b"", {
        "ok": False,
        "latencyMs": None,
        "bytes": 0,
        "error": f"{type(last_error).__name__}: {last_error}",
    }


def fetch_json(url: str, *, headers: Optional[Dict[str, str]] = None) -> Tuple[Any, Dict[str, Any]]:
    payload, meta = fetch_bytes(url, headers=headers)
    if not meta.get("ok"):
        return None, meta
    try:
        return json.loads(payload.decode("utf-8-sig")), meta
    except Exception as exc:
        meta = dict(meta)
        meta.update({"ok": False, "error": f"JSONDecodeError: {exc}"})
        return None, meta


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: List[str] = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return " ".join(self.parts)


class TableExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._row: Optional[List[str]] = None
        self._cell: Optional[List[str]] = None

    def handle_starttag(self, tag: str, attrs: Sequence[Tuple[str, Optional[str]]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            value = " ".join(data.split())
            if value:
                self._cell.append(value)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._row is not None and self._cell is not None:
            self._row.append(" ".join(self._cell))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def classify_risk(text: str) -> List[str]:
    lowered = text.lower()
    return [label for label, words in RISK_KEYWORDS.items() if any(word in lowered for word in words)]


def symbols_from_text(text: str) -> List[str]:
    lowered = text.lower()
    matched: List[str] = []
    for symbol, cfg in SYMBOLS.items():
        ticker = cfg.get("ticker")
        aliases = cfg.get("aliases", [])
        ticker_match = bool(ticker and re.search(rf"(?<![A-Z0-9]){re.escape(ticker)}(?![A-Z0-9])", text))
        alias_match = any(alias.lower() in lowered for alias in aliases if len(alias) >= 4)
        if ticker_match or alias_match:
            matched.append(symbol)
    return matched


def make_event(
    *,
    source: str,
    event_type: str,
    headline: str,
    symbol: Optional[str] = None,
    published_at: Optional[dt.datetime] = None,
    effective_at: Optional[dt.datetime] = None,
    scheduled: bool = False,
    url: Optional[str] = None,
    source_record_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    risk_hints: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "eventId": stable_id(source, source_record_id or url or headline, symbol, iso(published_at), iso(effective_at)),
        "source": source,
        "sourceRecordId": source_record_id,
        "symbol": symbol,
        "eventType": event_type,
        "headline": html.unescape(headline).strip()[:500],
        "publishedAt": iso(published_at),
        "effectiveAt": iso(effective_at),
        "scheduled": bool(scheduled),
        "url": url,
        "riskHints": sorted(set(risk_hints or classify_risk(headline))),
        "details": details or {},
    }


def parse_rss(payload: bytes) -> List[Dict[str, str]]:
    root = ET.fromstring(payload)
    rows: List[Dict[str, str]] = []
    for item in root.findall(".//item"):
        row: Dict[str, str] = {}
        for child in list(item):
            key = child.tag.split("}")[-1]
            value = "".join(child.itertext()).strip()
            if value:
                row[key] = value
        rows.append(row)
    return rows


def parse_rfc822(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except Exception:
        return None


def collect_google_news() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    group_results: List[Dict[str, Any]] = []
    for group in NEWS_GROUPS:
        terms: List[str] = []
        for symbol in group:
            cfg = SYMBOLS[symbol]
            company = cfg["company"]
            ticker = cfg.get("ticker")
            terms.append(f'"{company}"')
            if ticker:
                terms.append(f'"{ticker}"')
        query = "(" + " OR ".join(terms) + ") (earnings OR guidance OR merger OR acquisition OR lawsuit OR investigation OR offering OR cybersecurity OR CEO OR recall) when:1d"
        url = GOOGLE_NEWS_RSS + "?" + urllib.parse.urlencode({
            "q": query,
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        })
        payload, meta = fetch_bytes(url, headers=DEFAULT_HEADERS)
        meta["symbols"] = list(group)
        group_results.append(meta)
        if not meta.get("ok"):
            continue
        try:
            rows = parse_rss(payload)
        except Exception as exc:
            meta.update({"ok": False, "error": f"RSSParseError: {exc}"})
            continue
        for row in rows:
            title = row.get("title", "")
            mapped = symbols_from_text(title)
            if not mapped:
                continue
            published = parse_rfc822(row.get("pubDate"))
            for symbol in mapped:
                events.append(make_event(
                    source="GOOGLE_NEWS_RSS",
                    source_record_id=row.get("guid") or row.get("link"),
                    symbol=symbol,
                    event_type="COMPANY_NEWS_HEADLINE",
                    headline=title,
                    published_at=published,
                    url=row.get("link"),
                    details={"publisher": row.get("source")},
                ))
    return events, {
        "ok": any(item.get("ok") for item in group_results),
        "groups": group_results,
        "records": len(events),
    }


def collect_trade_halts() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = fetch_bytes(NASDAQ_HALTS_RSS, headers=DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    if not meta.get("ok"):
        return events, meta
    try:
        rows = parse_rss(payload)
    except Exception as exc:
        meta.update({"ok": False, "error": f"RSSParseError: {exc}"})
        return events, meta
    for row in rows:
        text = " ".join([row.get("title", ""), row.get("description", "")])
        mapped = symbols_from_text(text)
        for symbol in mapped:
            events.append(make_event(
                source="NASDAQ_TRADER_HALT_RSS",
                source_record_id=row.get("guid") or row.get("link"),
                symbol=symbol,
                event_type="TRADING_HALT_OR_RESUMPTION",
                headline=row.get("title", text),
                published_at=parse_rfc822(row.get("pubDate")),
                url=row.get("link"),
                risk_hints=["TRADING_STATUS"],
                details={"description": row.get("description", "")[:1000]},
            ))
    meta["records"] = len(events)
    return events, meta


def collect_aster_status() -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    payload, meta = fetch_json(f"{ASTER_API}/fapi/v1/exchangeInfo", headers=DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    observations: Dict[str, Any] = {}
    if not meta.get("ok") or not isinstance(payload, dict):
        return events, meta, observations
    by_symbol = {
        str(row.get("symbol", "")).upper(): row
        for row in payload.get("symbols", [])
        if isinstance(row, dict)
    }
    for symbol in SYMBOLS:
        row = by_symbol.get(symbol)
        if not row:
            observations[symbol] = {"status": "MISSING"}
            events.append(make_event(
                source="ASTER_EXCHANGE_INFO",
                symbol=symbol,
                event_type="ASTER_CONTRACT_MISSING",
                headline=f"{symbol} missing from Aster exchangeInfo",
                risk_hints=["TRADING_STATUS"],
            ))
            continue
        filters = {
            str(item.get("filterType")): item
            for item in row.get("filters", [])
            if isinstance(item, dict) and item.get("filterType")
        }
        observations[symbol] = {
            "status": row.get("status"),
            "contractType": row.get("contractType"),
            "pricePrecision": row.get("pricePrecision"),
            "quantityPrecision": row.get("quantityPrecision"),
            "filters": filters,
        }
        if row.get("status") != "TRADING":
            events.append(make_event(
                source="ASTER_EXCHANGE_INFO",
                symbol=symbol,
                event_type="ASTER_CONTRACT_STATUS",
                headline=f"{symbol} Aster status is {row.get('status')}",
                risk_hints=["TRADING_STATUS"],
                details=observations[symbol],
            ))
    meta["records"] = len(events)
    meta["observedSymbols"] = len(observations)
    return events, meta, observations


def sec_event_type(form: str) -> Tuple[str, List[str]]:
    if form in {"10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}:
        return "SEC_PERIODIC_OR_EARNINGS_FILING", ["EARNINGS"]
    if form in {"S-3", "S-3ASR", "F-3", "F-3ASR", "424B2", "424B3", "424B4", "424B5"}:
        return "SEC_CAPITAL_MARKETS_FILING", ["CAPITAL_ACTION"]
    if form in {"25", "25-NSE"}:
        return "SEC_DELISTING_FILING", ["TRADING_STATUS"]
    if form.startswith("SC 13"):
        return "SEC_OWNERSHIP_FILING", []
    if form == "DEF 14A":
        return "SEC_GOVERNANCE_FILING", ["MANAGEMENT"]
    return "SEC_MATERIAL_FILING", []


def collect_sec_filings(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    ticker_payload, ticker_meta = fetch_json(SEC_TICKERS_URL, headers=SEC_HEADERS)
    result: Dict[str, Any] = {"tickerMap": ticker_meta, "companies": [], "records": 0}
    if not ticker_meta.get("ok") or not isinstance(ticker_payload, dict):
        result["ok"] = False
        return events, result
    ticker_to_cik: Dict[str, int] = {}
    for row in ticker_payload.values():
        if isinstance(row, dict) and row.get("ticker") and row.get("cik_str") is not None:
            ticker_to_cik[str(row["ticker"]).upper()] = int(row["cik_str"])
    cutoff = (now - dt.timedelta(days=4)).date()
    successes = 0
    eligible = [cfg for cfg in SYMBOLS.values() if cfg.get("ticker") and cfg.get("secEnabled") is not False]
    for symbol, cfg in SYMBOLS.items():
        ticker = cfg.get("ticker")
        if not ticker or cfg.get("secEnabled") is False:
            continue
        cik = ticker_to_cik.get(ticker)
        if cik is None:
            result["companies"].append({"symbol": symbol, "ticker": ticker, "ok": False, "error": "CIK_NOT_FOUND"})
            continue
        payload, meta = fetch_json(SEC_SUBMISSIONS_URL.format(cik=cik), headers=SEC_HEADERS)
        meta.update({"symbol": symbol, "ticker": ticker, "cik": cik})
        result["companies"].append(meta)
        if not meta.get("ok") or not isinstance(payload, dict):
            continue
        successes += 1
        recent = payload.get("filings", {}).get("recent", {})
        forms = recent.get("form", []) if isinstance(recent, dict) else []
        accessions = recent.get("accessionNumber", [])
        filed = recent.get("filingDate", [])
        accepted = recent.get("acceptanceDateTime", [])
        documents = recent.get("primaryDocument", [])
        descriptions = recent.get("primaryDocDescription", [])
        count = min(len(forms), len(accessions), len(filed))
        for index in range(count):
            form = str(forms[index])
            if form not in SEC_FORMS:
                continue
            try:
                filing_date = dt.date.fromisoformat(str(filed[index]))
            except Exception:
                continue
            if filing_date < cutoff:
                continue
            accepted_at: Optional[dt.datetime] = None
            if index < len(accepted) and accepted[index]:
                raw = str(accepted[index])
                try:
                    accepted_at = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    if accepted_at.tzinfo is None:
                        accepted_at = accepted_at.replace(tzinfo=NY)
                    accepted_at = accepted_at.astimezone(UTC)
                except Exception:
                    accepted_at = None
            if accepted_at is None:
                accepted_at = dt.datetime.combine(filing_date, dt.time(0, 0), tzinfo=NY).astimezone(UTC)
            accession = str(accessions[index])
            document = str(documents[index]) if index < len(documents) else ""
            description = str(descriptions[index]) if index < len(descriptions) else ""
            accession_compact = accession.replace("-", "")
            url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_compact}/{document}"
                if document else
                f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_compact}/"
            )
            event_type, hints = sec_event_type(form)
            events.append(make_event(
                source="SEC_EDGAR_SUBMISSIONS",
                source_record_id=accession,
                symbol=symbol,
                event_type=event_type,
                headline=f"{ticker} filed {form}" + (f": {description}" if description else ""),
                published_at=accepted_at,
                url=url,
                risk_hints=hints,
                details={"form": form, "cik": cik, "filingDate": str(filing_date), "primaryDocument": document},
            ))
        time.sleep(0.12)
    result["ok"] = successes >= max(1, len(eligible) - 3)
    result["records"] = len(events)
    result["successfulCompanies"] = successes
    return events, result


def parse_earnings_effective(date_value: dt.date, time_label: str) -> Tuple[dt.datetime, str]:
    lowered = (time_label or "").lower()
    if "after" in lowered:
        local = dt.datetime.combine(date_value, dt.time(16, 0), tzinfo=NY)
        confidence = "label_after_hours"
    elif "pre" in lowered or "before" in lowered:
        local = dt.datetime.combine(date_value, dt.time(8, 0), tzinfo=NY)
        confidence = "label_pre_market"
    else:
        local = dt.datetime.combine(date_value, dt.time(12, 0), tzinfo=NY)
        confidence = "date_only_midday_placeholder"
    return local.astimezone(UTC), confidence


def collect_nasdaq_earnings(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    tracked = {
        cfg["ticker"]: symbol
        for symbol, cfg in SYMBOLS.items()
        if cfg.get("ticker")
    }
    local_today = now.astimezone(NY).date()
    events: List[Dict[str, Any]] = []
    days: List[Dict[str, Any]] = []
    for offset in range(-1, 9):
        date_value = local_today + dt.timedelta(days=offset)
        url = NASDAQ_EARNINGS_URL + "?" + urllib.parse.urlencode({"date": date_value.isoformat()})
        payload, meta = fetch_json(url, headers=DEFAULT_HEADERS)
        meta["date"] = date_value.isoformat()
        days.append(meta)
        if not meta.get("ok") or not isinstance(payload, dict):
            continue
        rows = payload.get("data", {}).get("rows", [])
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            ticker = str(row.get("symbol", "")).upper().strip()
            symbol = tracked.get(ticker)
            if not symbol:
                continue
            time_label = str(row.get("time", "") or "")
            effective, confidence = parse_earnings_effective(date_value, time_label)
            events.append(make_event(
                source="NASDAQ_EARNINGS_CALENDAR",
                source_record_id=f"{ticker}:{date_value.isoformat()}:{time_label}",
                symbol=symbol,
                event_type="EARNINGS_SCHEDULED",
                headline=f"{ticker} scheduled earnings on {date_value.isoformat()} {time_label}".strip(),
                effective_at=effective,
                scheduled=True,
                risk_hints=["EARNINGS"],
                details={
                    "date": date_value.isoformat(),
                    "timeLabel": time_label,
                    "timeConfidence": confidence,
                    "epsForecast": row.get("epsForecast"),
                    "fiscalQuarterEnding": row.get("fiscalQuarterEnding"),
                    "lastYearEPS": row.get("lastYearEPS"),
                    "lastYearRptDt": row.get("lastYearRptDt"),
                },
            ))
    return events, {
        "ok": any(item.get("ok") for item in days),
        "days": days,
        "records": len(events),
    }


def unfold_ics(payload: str) -> List[str]:
    lines: List[str] = []
    for raw in payload.replace("\r\n", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def parse_ics_datetime(key: str, value: str) -> Optional[dt.datetime]:
    params = key.split(";")[1:]
    timezone = NY
    for param in params:
        if param.startswith("TZID="):
            try:
                timezone = ZoneInfo(param.split("=", 1)[1])
            except Exception:
                timezone = NY
    value = value.strip()
    formats = ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M", "%Y%m%d")
    for fmt in formats:
        try:
            parsed = dt.datetime.strptime(value.rstrip("Z"), fmt)
            if value.endswith("Z"):
                return parsed.replace(tzinfo=UTC)
            return parsed.replace(tzinfo=timezone).astimezone(UTC)
        except ValueError:
            continue
    return None


def collect_bls_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = fetch_bytes(BLS_ICS_URL, headers=DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    if not meta.get("ok"):
        return events, meta
    lines = unfold_ics(payload.decode("utf-8-sig", errors="replace"))
    current: Dict[str, str] = {}
    in_event = False
    parsed_rows: List[Dict[str, str]] = []
    for line in lines:
        if line == "BEGIN:VEVENT":
            in_event = True
            current = {}
        elif line == "END:VEVENT":
            if in_event:
                parsed_rows.append(current)
            in_event = False
        elif in_event and ":" in line:
            key, value = line.split(":", 1)
            current[key] = value
    lower = now - dt.timedelta(days=1)
    upper = now + dt.timedelta(days=21)
    for row in parsed_rows:
        summary = row.get("SUMMARY", "")
        if not any(keyword.lower() in summary.lower() for keyword in HIGH_IMPACT_BLS):
            continue
        dt_key = next((key for key in row if key.startswith("DTSTART")), "")
        effective = parse_ics_datetime(dt_key, row.get(dt_key, "")) if dt_key else None
        if effective is None or not (lower <= effective <= upper):
            continue
        events.append(make_event(
            source="BLS_OFFICIAL_ICS",
            source_record_id=row.get("UID") or f"{summary}:{iso(effective)}",
            event_type="MACRO_RELEASE_SCHEDULED",
            headline=summary,
            effective_at=effective,
            scheduled=True,
            url=row.get("URL") or BLS_ICS_URL,
            risk_hints=["MACRO_EVENT"],
            details={"description": row.get("DESCRIPTION", "")[:500]},
        ))
    meta["records"] = len(events)
    return events, meta


def collect_fomc_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = fetch_bytes(FOMC_URL, headers=DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    if not meta.get("ok"):
        return events, meta
    parser = TextExtractor()
    parser.feed(payload.decode("utf-8", errors="replace"))
    text = parser.text()
    section_match = re.search(r"2026 FOMC Meetings(.*?)(?:2027 FOMC Meetings|Note:)", text, flags=re.I)
    section = section_match.group(1) if section_match else text
    pattern = re.compile(
        r"\b(" + "|".join(MONTHS) + r")\b\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?",
        flags=re.I,
    )
    seen: set[Tuple[int, int]] = set()
    for match in pattern.finditer(section):
        month_name = match.group(1).title()
        month = MONTHS[month_name]
        day = int(match.group(3) or match.group(2))
        key = (month, day)
        if key in seen:
            continue
        seen.add(key)
        try:
            local = dt.datetime(2026, month, day, 14, 0, tzinfo=NY)
        except ValueError:
            continue
        effective = local.astimezone(UTC)
        if now - dt.timedelta(days=2) <= effective <= now + dt.timedelta(days=60):
            events.append(make_event(
                source="FEDERAL_RESERVE_FOMC_CALENDAR",
                source_record_id=f"FOMC-2026-{month:02d}-{day:02d}",
                event_type="FOMC_MEETING_DECISION_WINDOW",
                headline=f"FOMC meeting decision window {month_name} {match.group(2)}"
                         + (f"-{match.group(3)}" if match.group(3) else ""),
                effective_at=effective,
                scheduled=True,
                url=FOMC_URL,
                risk_hints=["MACRO_EVENT"],
                details={
                    "meetingStartDay": int(match.group(2)),
                    "meetingEndDay": day,
                    "decisionTimeAssumedET": "14:00",
                    "sourceSha256": hashlib.sha256(payload).hexdigest(),
                },
            ))
    meta["records"] = len(events)
    meta["sourceSha256"] = hashlib.sha256(payload).hexdigest()
    return events, meta


def collect_bea_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = fetch_bytes(BEA_SCHEDULE_URL, headers=DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    if not meta.get("ok"):
        return events, meta
    parser = TableExtractor()
    parser.feed(payload.decode("utf-8", errors="replace"))
    high_impact = ("GDP", "Personal Income and Outlays", "International Trade in Goods and Services")
    for cells in parser.rows:
        joined = " | ".join(cells)
        if not any(keyword.lower() in joined.lower() for keyword in high_impact):
            continue
        match = re.search(
            r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*[AP]M)\b",
            joined,
            flags=re.I,
        )
        if not match:
            continue
        month_name = match.group(1).title()
        month = MONTHS[month_name]
        day = int(match.group(2))
        time_value = dt.datetime.strptime(match.group(3).upper().replace(" ", ""), "%I:%M%p").time()
        try:
            effective = dt.datetime(2026, month, day, time_value.hour, time_value.minute, tzinfo=NY).astimezone(UTC)
        except ValueError:
            continue
        if not (now - dt.timedelta(days=1) <= effective <= now + dt.timedelta(days=30)):
            continue
        headline = next((cell for cell in cells if any(keyword.lower() in cell.lower() for keyword in high_impact)), joined)
        events.append(make_event(
            source="BEA_OFFICIAL_RELEASE_SCHEDULE",
            source_record_id=f"BEA:{effective.date()}:{headline}",
            event_type="MACRO_RELEASE_SCHEDULED",
            headline=headline,
            effective_at=effective,
            scheduled=True,
            url=BEA_SCHEDULE_URL,
            risk_hints=["MACRO_EVENT"],
            details={"row": cells[:6]},
        ))
    meta["records"] = len(events)
    meta["sourceSha256"] = hashlib.sha256(payload).hexdigest()
    return events, meta


def dedupe_events(events: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    chosen: Dict[str, Dict[str, Any]] = {}
    for event in events:
        chosen[event["eventId"]] = event
    return sorted(
        chosen.values(),
        key=lambda event: (
            event.get("publishedAt") or event.get("effectiveAt") or "",
            event.get("source") or "",
            event.get("symbol") or "",
            event.get("eventId") or "",
        ),
    )


def collect_snapshot(mode: str, now: dt.datetime) -> Dict[str, Any]:
    all_events: List[Dict[str, Any]] = []
    source_results: Dict[str, Any] = {}

    news_events, news_meta = collect_google_news()
    all_events.extend(news_events)
    source_results["googleNewsRss"] = news_meta

    halt_events, halt_meta = collect_trade_halts()
    all_events.extend(halt_events)
    source_results["nasdaqTradeHalts"] = halt_meta

    aster_events, aster_meta, contracts = collect_aster_status()
    all_events.extend(aster_events)
    source_results["asterExchangeInfo"] = aster_meta

    if mode == "full":
        sec_events, sec_meta = collect_sec_filings(now)
        all_events.extend(sec_events)
        source_results["secEdgar"] = sec_meta

        earnings_events, earnings_meta = collect_nasdaq_earnings(now)
        all_events.extend(earnings_events)
        source_results["nasdaqEarnings"] = earnings_meta

        bls_events, bls_meta = collect_bls_calendar(now)
        all_events.extend(bls_events)
        source_results["blsCalendar"] = bls_meta

        fomc_events, fomc_meta = collect_fomc_calendar(now)
        all_events.extend(fomc_events)
        source_results["fomcCalendar"] = fomc_meta

        bea_events, bea_meta = collect_bea_calendar(now)
        all_events.extend(bea_events)
        source_results["beaCalendar"] = bea_meta

    events = dedupe_events(all_events)
    return {
        "schemaVersion": 1,
        "collectorId": COLLECTOR_ID,
        "mode": mode,
        "fetchedAt": iso(now),
        "symbolUniverse": list(SYMBOLS),
        "underlyingTickers": {
            symbol: cfg.get("ticker")
            for symbol, cfg in SYMBOLS.items()
        },
        "sourceResults": source_results,
        "events": events,
        "observations": {
            "asterContracts": contracts,
        },
        "summary": {
            "eventCount": len(events),
            "eventsBySource": dict(Counter(event["source"] for event in events)),
            "eventsByType": dict(Counter(event["eventType"] for event in events)),
            "eventsBySymbol": dict(Counter(event["symbol"] for event in events if event.get("symbol"))),
            "sourceFailures": [
                name for name, result in source_results.items()
                if not bool(result.get("ok"))
            ],
        },
        "safety": {
            "mode": "SHADOW_OBSERVATION_ONLY",
            "orderSubmissionAllowed": False,
            "entryDecisionChanged": False,
            "productionStrategyChanged": False,
            "currentV96WeightsMutable": False,
            "articleBodiesStored": False,
            "sentimentUsedForDirection": False,
        },
    }


def write_snapshot(snapshot: Dict[str, Any], output_dir: Path) -> Dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    now = parse_utc(snapshot["fetchedAt"])
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    prefix = f"{stamp}-{run_id}"
    event_path = output_dir / f"event-ledger-{prefix}.json.gz"
    summary_path = output_dir / f"summary-{prefix}.json"
    with gzip.open(event_path, "wt", encoding="utf-8") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, separators=(",", ":"))
    summary = {
        "schemaVersion": snapshot["schemaVersion"],
        "collectorId": snapshot["collectorId"],
        "mode": snapshot["mode"],
        "fetchedAt": snapshot["fetchedAt"],
        "summary": snapshot["summary"],
        "sourceResults": snapshot["sourceResults"],
        "safety": snapshot["safety"],
        "files": {"eventLedger": event_path.name},
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "run-status.txt").write_text("collected\n", encoding="utf-8")
    return {"eventLedger": str(event_path), "summary": str(summary_path)}


def self_test() -> None:
    title = "NVIDIA earnings guidance and acquisition update"
    assert symbols_from_text(title) == ["NVDAUSDT"]
    assert {"EARNINGS", "M_AND_A"} <= set(classify_risk(title))
    sample_rss = b"""<?xml version="1.0"?><rss><channel><item><title>AMD earnings</title><link>https://example.test/a</link><pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>"""
    rows = parse_rss(sample_rss)
    assert rows[0]["title"] == "AMD earnings"
    sample_ics = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test
DTSTART;TZID=America/New_York:20260731T083000
SUMMARY:Employment Cost Index
END:VEVENT
END:VCALENDAR
"""
    lines = unfold_ics(sample_ics)
    assert "SUMMARY:Employment Cost Index" in lines
    parsed = parse_ics_datetime("DTSTART;TZID=America/New_York", "20260731T083000")
    assert parsed is not None and parsed.tzinfo is not None
    assert make_event(source="x", event_type="y", headline="z")["eventId"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect immutable stock event-risk evidence for Shadow analysis.")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-event-ledger")
    parser.add_argument("--start-utc", default=os.environ.get("EVENT_LEDGER_START_UTC", DEFAULT_START_UTC))
    parser.add_argument("--end-utc", default=os.environ.get("EVENT_LEDGER_END_UTC", DEFAULT_END_UTC))
    parser.add_argument("--mode", choices=("fast", "full"), default="full")
    parser.add_argument("--ignore-window", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    self_test()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.self_test:
        (output_dir / "run-status.txt").write_text("self_test\n", encoding="utf-8")
        print("V96 stock event ledger self-test: PASS")
        return 0

    now = utc_now()
    start = parse_utc(args.start_utc)
    end = parse_utc(args.end_utc)
    if not args.ignore_window and now < start:
        (output_dir / "run-status.txt").write_text("not_started\n", encoding="utf-8")
        (output_dir / "window.json").write_text(json.dumps({
            "status": "not_started", "now": iso(now), "startUtc": iso(start), "endUtc": iso(end)
        }, indent=2), encoding="utf-8")
        return 0
    if not args.ignore_window and now >= end:
        (output_dir / "run-status.txt").write_text("expired\n", encoding="utf-8")
        (output_dir / "window.json").write_text(json.dumps({
            "status": "expired", "now": iso(now), "startUtc": iso(start), "endUtc": iso(end)
        }, indent=2), encoding="utf-8")
        return 0

    snapshot = collect_snapshot(args.mode, now)
    files = write_snapshot(snapshot, output_dir)
    print(json.dumps({
        "status": "collected",
        "mode": args.mode,
        "events": snapshot["summary"]["eventCount"],
        "sourceFailures": snapshot["summary"]["sourceFailures"],
        "files": files,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
