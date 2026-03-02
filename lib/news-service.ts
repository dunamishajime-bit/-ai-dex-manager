/**
 * Market News Simulator Utility
 */

export interface MarketNews {
    id: string;
    title: string;
    impact: "BULLISH" | "BEARISH" | "NEUTRAL";
    category: "PROTOCOL" | "MACRO" | "WHALE" | "SECURITY" | "REAL";
    timestamp: number;
    source?: string;
    url?: string;
    content?: string;
}

const NEWS_TEMPLATES = [
    { title: "大手機関投資家がポートフォリオの3%を{symbol}に配分したとの噂", impact: "BULLISH", category: "WHALE" },
    { title: "{symbol} ネットワークのアップグレードがメインネットで成功裏に完了", impact: "BULLISH", category: "PROTOCOL" },
    { title: "米雇用統計が予想を下回り、仮想通貨市場に資金が流入", impact: "BULLISH", category: "MACRO" },
    { title: "著名インフルエンサーが {symbol} の将来性についてポジティブな投稿", impact: "BULLISH", category: "WHALE" },
    { title: "{symbol} 関連プロトコルで一時的な同期遅延が発生", impact: "NEUTRAL", category: "PROTOCOL" },
    { title: "新たな規制案が提出されたが、市場への影響は限定的との見方", impact: "NEUTRAL", category: "MACRO" },
    { title: "クジラが取引所から {symbol} を外部ウォレットへ大量移動", impact: "BULLISH", category: "WHALE" },
    { title: "{symbol} の競合プロジェクトが脆弱性を発表。相対的に価値上昇の期待", impact: "BULLISH", category: "SECURITY" },
    { title: "中央銀行が金利据え置きを発表。市場は様子見ムード", impact: "NEUTRAL", category: "MACRO" },
    { title: "{symbol} コミュニティでガバナンス投票が開始。高い関心を集める", impact: "NEUTRAL", category: "PROTOCOL" },
    { title: "一部の取引所で {symbol} の入出金メンテナンスを実施中", impact: "NEUTRAL", category: "PROTOCOL" },
    { title: "秘密鍵の管理に関する新たなガイドラインが発表", impact: "NEUTRAL", category: "SECURITY" },
    { title: "{symbol} ネットワークで小規模なDDoS攻撃を検知。現在は沈静化", impact: "BEARISH", category: "SECURITY" },
    { title: "主要国の規制当局が仮想通貨取引のリスクを再警告", impact: "BEARISH", category: "MACRO" },
    { title: "大量の {symbol} が取引所に送金された模様。売り圧力を警戒", impact: "BEARISH", category: "WHALE" },
    { title: "{symbol} 基盤の最大手DEXでスマートコントラクトのバグが発見されたとの誤報", impact: "BEARISH", category: "SECURITY" },
];

export function generateRandomNews(symbol: string): MarketNews {
    const template = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)];
    return {
        id: Math.random().toString(36).substring(7),
        title: template.title.replace("{symbol}", symbol),
        impact: template.impact as MarketNews["impact"],
        category: template.category as MarketNews["category"],
        timestamp: Date.now(),
        source: "Internal Market Intelligence",
        url: "https://dis-dex-manager.vercel.app/news",
    };
}

/**
 * Converts real CryptoNews from dex-service into MarketNews format for the simulation.
 */
export function convertRealToMarketNews(realNews: any): MarketNews {
    // Simple sentiment heuristic based on keywords
    const title = realNews.title.toLowerCase();
    const bullishKeywords = ["上昇", "高騰", "承認", "成功", "提携", "買収", "突破", "bullish", "ath", "surge", "up"];
    const bearishKeywords = ["下落", "暴落", "脆弱性", "懸念", "規制", "警告", "不正", "bearish", "crash", "hack", "hack", "dump"];

    let impact: MarketNews["impact"] = "NEUTRAL";
    if (bullishKeywords.some(k => title.includes(k))) impact = "BULLISH";
    else if (bearishKeywords.some(k => title.includes(k))) impact = "BEARISH";

    return {
        id: realNews.id,
        title: realNews.title,
        impact,
        category: "REAL",
        timestamp: new Date(realNews.published_at).getTime() || Date.now(),
        source: realNews.source,
        url: realNews.url,
        content: realNews.description || realNews.content || "",
    };
}
