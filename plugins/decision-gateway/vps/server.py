#!/usr/bin/env python3
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from decision_gateway import judge, reduce_text  # noqa: E402

VERSION = "0.2.0"
STARTED_AT = time.time()
BIND = os.environ.get("DG_BIND", "127.0.0.1")
PORT = int(os.environ.get("DG_PORT", "8765"))
MAX_BODY = int(os.environ.get("DG_MAX_BODY_BYTES", str(1024 * 1024)))
TOKEN_FILE = Path(os.environ.get("DG_TOKEN_FILE", "/etc/disdex/decision-gateway.token"))
def _read_token():
    token = os.environ.get("DG_TOKEN", "").strip()
    if not token:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise RuntimeError("decision gateway token is missing or too short")
    return token

TOKEN = _read_token()

def _result(req_id, value):
    return {"jsonrpc": "2.0", "id": req_id, "result": value}

def _error(req_id, code, message):
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}

def _tool_defs():
    return [
        {
            "name": "decision_reduce",
            "description": "Compress large text locally while preserving errors, warnings, SHAs, health and risk metadata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "max_lines": {"type": "integer", "minimum": 1, "maximum": 500},
                    "context": {"type": "integer", "minimum": 0, "maximum": 5}
                },
                "required": ["text"]
            }
        },
        {
            "name": "decision_judge",
            "description": "Return PASS, FAIL, UNKNOWN or NEED_SOL from explicit deterministic checks.",
            "inputSchema": {
                "type": "object",
                "properties": {"payload": {"type": "object"}},
                "required": ["payload"]
            }
        },
        {
            "name": "decision_pipeline",
            "description": "Compress evidence then judge checks in one call, returning only compact evidence for deeper reasoning.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "payload": {"type": "object"},
                    "evidence": {"type": "string"},
                    "max_lines": {"type": "integer", "minimum": 1, "maximum": 500},
                    "context": {"type": "integer", "minimum": 0, "maximum": 5}
                },
                "required": ["payload", "evidence"]
            }
        }
    ]
def run_tool(name, args):
    if name == "decision_reduce":
        return reduce_text(
            str(args.get("text", "")),
            int(args.get("max_lines", 80)),
            int(args.get("context", 1)),
        )
    if name == "decision_judge":
        payload = args.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        return judge(payload)
    if name == "decision_pipeline":
        payload = args.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        reduced = reduce_text(
            str(args.get("evidence", "")),
            int(args.get("max_lines", 80)),
            int(args.get("context", 1)),
        )
        payload = dict(payload)
        payload["compact_context"] = reduced["compact_text"]
        result = judge(payload)
        result["reduction"] = {k: v for k, v in reduced.items() if k != "compact_text"}
        return result
    raise ValueError(f"unknown tool: {name}")
def handle_rpc(message):
    if not isinstance(message, dict):
        return _error(None, -32600, "Invalid Request")
    method = message.get("method")
    req_id = message.get("id")
    if method == "initialize":
        params = message.get("params") or {}
        requested = params.get("protocolVersion") or "2025-03-26"
        return _result(req_id, {
            "protocolVersion": requested,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "disdex-decision-gateway", "version": VERSION},
            "instructions": "Read-only advisory decision gateway. It cannot place trades or change production state."
        })
    if method in {"notifications/initialized", "notifications/cancelled"}:
        return None
    if method == "ping":
        return _result(req_id, {})
    if method == "tools/list":
        return _result(req_id, {"tools": _tool_defs()})
    if method == "tools/call":
        params = message.get("params") or {}
        try:
            value = run_tool(params.get("name"), params.get("arguments") or {})
        except Exception as exc:
            return _result(req_id, {
                "content": [{"type": "text", "text": str(exc)}],
                "isError": True
            })
        return _result(req_id, {
            "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}],
            "structuredContent": value,
            "isError": False
        })
    return _error(req_id, -32601, "Method not found")
class Handler(BaseHTTPRequestHandler):
    server_version = "DecisionGateway/" + VERSION

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code, value, extra_headers=None):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix):], TOKEN)
    def _read_json(self):
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            raise ValueError("Content-Length required")
        length = int(raw_len)
        if length < 0 or length > MAX_BODY:
            raise OverflowError("request body too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {
                "status": "ok",
                "service": "disdex-decision-gateway",
                "version": VERSION,
                "uptimeSeconds": int(time.time() - STARTED_AT),
                "externalAiApi": False
            })
            return
        if path == "/mcp":
            self.send_response(405)
            self.send_header("Allow", "POST")
            self.end_headers()
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in {"/reduce", "/judge", "/pipeline", "/mcp"}:
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"}, {"WWW-Authenticate": "Bearer"})
            return
        try:
            payload = self._read_json()
        except OverflowError as exc:
            self._json(413, {"error": str(exc)})
            return
        except Exception as exc:
            self._json(400, {"error": f"invalid json: {exc}"})
            return

        if path == "/mcp":
            response = handle_rpc(payload)
            if response is None:
                self.send_response(202)
                self.end_headers()
            else:
                self._json(200, response, {"MCP-Protocol-Version": "2025-03-26"})
            return
        try:
            if path == "/reduce":
                result = reduce_text(
                    str(payload.get("text", "")),
                    int(payload.get("max_lines", 80)),
                    int(payload.get("context", 1)),
                )
            elif path == "/judge":
                result = judge(payload)
            else:
                checks = payload.get("payload")
                if not isinstance(checks, dict):
                    raise ValueError("payload must be an object")
                reduced = reduce_text(
                    str(payload.get("evidence", "")),
                    int(payload.get("max_lines", 80)),
                    int(payload.get("context", 1)),
                )
                checks = dict(checks)
                checks["compact_context"] = reduced["compact_text"]
                result = judge(checks)
                result["reduction"] = {k: v for k, v in reduced.items() if k != "compact_text"}
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"error": str(exc)})
def main():
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(json.dumps({
        "event": "decision_gateway_started",
        "bind": BIND,
        "port": PORT,
        "version": VERSION,
        "externalAiApi": False
    }), flush=True)
    server.serve_forever()

if __name__ == "__main__":
    main()
