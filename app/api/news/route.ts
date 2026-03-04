import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NEWS_FEEDS = [
    { name: "Cointelegraph Japan", url: "https://jp.cointelegraph.com/rss" },
    { name: "CoinPost", url: "https://coinpost.jp/?feed=rss2" },
    { name: "Crypto Times JP", url: "https://crypto-times.jp/feed/" },
];

export async function GET() {
    try {
        const fetchFeed = async (feed: { name: string; url: string }) => {
            try {
                const baseUrl = "https://api.rss2json.com/v1/api.json";
                const res = await fetch(`${baseUrl}?rss_url=${encodeURIComponent(feed.url)}`, {
                    next: { revalidate: 300 },
                });
                const data = await res.json();

                if (data.status === "ok" && Array.isArray(data.items)) {
                    return data.items.map((item: any) => ({
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate,
                        source: feed.name,
                        content: `${item.description?.replace(/<[^>]*>?/gm, "").slice(0, 200) || ""}...`,
                    }));
                }

                return [];
            } catch (error) {
                console.error(`Failed to fetch feed: ${feed.name}`, error);
                return [];
            }
        };

        const allFeeds = await Promise.all(NEWS_FEEDS.map(fetchFeed));
        const combined = allFeeds
            .flat()
            .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
            .slice(0, 20);

        return NextResponse.json({ ok: true, news: combined });
    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
