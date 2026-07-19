from __future__ import annotations

import json
import math
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

TWEET_ID = "2078071671962169402"


def get_token(tweet_id: str) -> str:
    value = (int(tweet_id) / 1e15) * math.pi
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    integer = int(value)
    fraction = value - integer
    out = "0" if integer == 0 else ""
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
    return re.sub(r"(0+|\.)", "", out)


def best_mp4(payload: dict) -> str | None:
    candidates: list[tuple[int, str]] = []
    for media in payload.get("mediaDetails") or []:
        for item in (media.get("video_info") or {}).get("variants") or []:
            if item.get("content_type") == "video/mp4" and item.get("url"):
                candidates.append((int(item.get("bitrate") or 0), str(item["url"])))
    if not candidates:
        for item in (payload.get("video") or {}).get("variants") or []:
            if item.get("type") == "video/mp4" and item.get("src"):
                candidates.append((0, str(item["src"])))
    return max(candidates, default=(0, ""))[1] or None


def main() -> None:
    token = get_token(TWEET_ID)
    params = urllib.parse.urlencode({"id": TWEET_ID, "lang": "en", "token": token})
    url = f"https://cdn.syndication.twimg.com/tweet-result?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    out_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"x-post-{TWEET_ID}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    video_url = best_mp4(payload)
    video_path = out_dir / f"x-post-{TWEET_ID}.mp4"
    if video_url:
        video_req = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(video_req, timeout=120) as response:
            video_path.write_bytes(response.read())

    user = payload.get("user") or {}
    text = payload.get("text") or payload.get("full_text") or ""
    report = [
        f"# X post {TWEET_ID}",
        "",
        f"- Author: {user.get('name')} (@{user.get('screen_name')})",
        f"- Created: {payload.get('created_at')}",
        f"- Likes: {payload.get('favorite_count')}",
        f"- Video downloaded: {video_path.exists()}",
        f"- Video bytes: {video_path.stat().st_size if video_path.exists() else 0}",
        "",
        "## Text",
        "",
        text,
    ]
    (out_dir / f"x-post-{TWEET_ID}.md").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
