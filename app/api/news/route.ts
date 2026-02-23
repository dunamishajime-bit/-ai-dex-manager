import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NEWS_FEEDS = [
    { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "CryptoPanic", url: "https://cryptopanic.com/news/rss/" }
];

export async function GET() {
    try {
        const fetchFeed = async (feed: { name: string, url: string }) => {
            try {
                const baseUrl = `https://api.rss2json.com/v1/api.json`;
                const res = await fetch(`${baseUrl}?rss_url=${encodeURIComponent(feed.url)}`);
                const data = await res.json();

                if (data.status === "ok" && data.items) {
                    return data.items.map((item: any) => ({
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate,
                        source: feed.name,
                        content: item.description?.replace(/<[^>]*>?/gm, '').slice(0, 200) + "..."
                    }));
                }
                return [];
            } catch (e) {
                console.error(`Failed to fetch feed: ${feed.name}`, e);
                return [];
            }
        };

        const allFeeds = await Promise.all(NEWS_FEEDS.map(fetchFeed));
        const combined = allFeeds.flat().sort((a, b) =>
            new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
        ).slice(0, 20);

        return NextResponse.json({ ok: true, news: combined });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
