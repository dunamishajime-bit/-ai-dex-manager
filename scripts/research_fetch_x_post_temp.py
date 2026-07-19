from __future__ import annotations

import json
import math
import os
import urllib.parse
import urllib.request
from pathlib import Path

TWEET_ID = "2078071671962169402"


def get_token(tweet_id: str) -> str:
    # Match JavaScript Number(...).toString(36) closely enough for X syndication.
    value = (int(tweet_id) / 1e15) * math.pi
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    integer = int(value)
    fraction = value - integer
    out = ""
    if integer == 0:
        out = "0"
    while integer:
        integer, rem = divmod(integer, 36)
        out = chars[rem] + out
    if fraction:
        out += "."
        for _ in range(20):
            fraction *= 36
            digit = int(fraction)
            out += chars[digit]
            fraction -= digit
    # X's token helper strips dots and zero runs.
    import re
    return re.sub(r"(0+|\.)", "", out)


def main() -> None:
    token = get_token(TWEET_ID)
    params = urllib.parse.urlencode({"id": TWEET_ID, "lang": "en", "token": token})
    url = f"https://cdn.syndication.twimg.com/tweet-result?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    out_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"x-post-{TWEET_ID}.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    user = payload.get("user") or {}
    text = payload.get("text") or payload.get("full_text") or ""
    photos = payload.get("photos") or []
    video = payload.get("video") or {}
    media_lines = []
    for item in photos:
        if isinstance(item, dict):
            media_lines.append(f"- photo: {item.get('url')}")
    if isinstance(video, dict):
        media_lines.append(f"- video: {video.get('url')}")
        variants = video.get("variants") or []
        for item in variants:
            if isinstance(item, dict):
                media_lines.append(f"- variant: {item.get('bitrate')} {item.get('url')}")

    report = [
        f"# X post {TWEET_ID}",
        "",
        f"- Author: {user.get('name')} (@{user.get('screen_name')})",
        f"- Created: {payload.get('created_at')}",
        f"- Likes: {payload.get('favorite_count')}",
        "",
        "## Text",
        "",
        text,
        "",
        "## Media",
        "",
        *(media_lines or ["- none"]),
    ]
    md_path = out_dir / f"x-post-{TWEET_ID}.md"
    md_path.write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
