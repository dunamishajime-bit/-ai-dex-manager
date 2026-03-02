import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEWS_FEEDS = [
  { name: "CoinPost JP", url: "https://coinpost.jp/?feed=rss2" },
  { name: "Cointelegraph Japan", url: "https://jp.cointelegraph.com/rss" },
  { name: "Crypto Times JP", url: "https://crypto-times.jp/feed/" },
];

function stripHtml(input: string | undefined): string {
  return String(input || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFeed(feed: { name: string; url: string }) {
  try {
    const baseUrl = "https://api.rss2json.com/v1/api.json";
    const response = await fetch(`${baseUrl}?rss_url=${encodeURIComponent(feed.url)}`, {
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 300 },
    });

    const text = await response.text();
    if (!response.ok) {
      console.warn(`[NewsAPI] Feed request failed: ${feed.name} (${response.status})`);
      return [];
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn(`[NewsAPI] Non-JSON feed response ignored: ${feed.name}`);
      return [];
    }

    if (data.status !== "ok" || !Array.isArray(data.items)) {
      return [];
    }

    return data.items.map((item: any) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      source: feed.name,
      content: `${stripHtml(item.description).slice(0, 200)}...`,
    }));
  } catch (error) {
    console.error(`[NewsAPI] Failed to fetch feed: ${feed.name}`, error);
    return [];
  }
}

export async function GET() {
  try {
    const allFeeds = await Promise.all(NEWS_FEEDS.map(fetchFeed));
    const deduped = allFeeds
      .flat()
      .filter((item) => item?.title && item?.link)
      .filter((item, index, list) => list.findIndex((other) => other.link === item.link) === index)
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 20);

    return NextResponse.json({ ok: true, news: deduped });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}