export interface Achievement {
    id: string;
    title: string;
    description: string;
    icon: any;
    unlocked: boolean;
    rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
    progress?: number;
    target?: number;
}
