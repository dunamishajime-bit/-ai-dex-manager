"""Bounded retry for unsigned read-only data. No account/order transport."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import email.utils
import datetime
import threading

_LOCK=threading.Lock()
_COOLDOWN={}
def public_read_json(request,timeout=10.0,*,opener=None,sleep=time.sleep,clock=time.monotonic):
    if request.get_method()!="GET" or request.data is not None:
        raise ValueError("PUBLIC_READ_ONLY_REQUIRED")
    parsed=urllib.parse.urlsplit(request.full_url)
    if any(k.lower() in {"signature","nonce","user","signer","apikey","token"} for k,_ in urllib.parse.parse_qsl(parsed.query)):
        raise ValueError("SIGNED_READ_RETRY_FORBIDDEN")
    host=parsed.hostname or ""
    if host not in {"fapi.asterdex.com","fapi3.asterdex.com","query1.finance.yahoo.com","query2.finance.yahoo.com"} or parsed.scheme!="https":
        raise ValueError("PUBLIC_READ_HOST_UNAPPROVED")
    if opener is None:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):
                raise RuntimeError("PUBLIC_REDIRECT_FORBIDDEN")
        opener=urllib.request.build_opener(NoRedirect()).open
    deadline=clock()+min(30.0,max(3.0,timeout*3))
    for attempt in range(3):
        with _LOCK: wait=max(0.0,_COOLDOWN.get(host,0)-clock())
        if clock()+wait>=deadline: raise RuntimeError("PUBLIC_READ_COOLDOWN")
        if wait: sleep(wait)
        try:
            with opener(request,timeout=min(timeout,max(.1,deadline-clock()))) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            retryable=exc.code in {408,425,429,500,502,503,504}
            delay=0.0
            value=exc.headers.get("Retry-After") if exc.headers else None
            if value:
                try: delay=max(0.0,float(value))
                except ValueError:
                    try: delay=max(0.0,email.utils.parsedate_to_datetime(value).timestamp()-time.time())
                    except (ValueError,TypeError,OverflowError): pass
            if exc.code in {418,429}:
                with _LOCK: _COOLDOWN[host]=max(_COOLDOWN.get(host,0),clock()+max(delay,120 if exc.code==418 else 2))
            if not retryable or attempt==2: raise
            delay=max(delay,.5*2**attempt)
            if clock()+delay>=deadline: raise
            sleep(delay)
        except (urllib.error.URLError,TimeoutError,ConnectionError,json.JSONDecodeError,UnicodeDecodeError):
            if attempt==2 or clock()+.5*2**attempt>=deadline: raise
            sleep(.5*2**attempt)
    raise RuntimeError("PUBLIC_READ_RETRY_EXHAUSTED")
