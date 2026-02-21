require('dotenv').config({ path: '.env.local' });
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { exec } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

// 共有ログファイル
const SYNC_FILE = 'discord-sync.md';

function logToAntigravity(action, details) {
    const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const logEntry = `\n### [${timestamp}] ${action}\n${details}\n`;
    fs.appendFileSync(SYNC_FILE, logEntry, 'utf8');
}

// ----- Config -----
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
    console.error("ERROR: DISCORD_BOT_TOKEN or GEMINI_API_KEY is not set in .env.local");
    process.exit(1);
}

// ----- Initialize Gemini -----
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `あなたは「Antigravity」という名前のAIアシスタントであり、ローカル環境で稼働しているDiscord連携Botです。
ユーザーは現在「AI DEX Manager」というNext.jsアプリケーションをローカルで開発中です。
あなたの目的は、ユーザーからの質問に答えたり、開発の相談に乗ることです。
専門的で、かつフレンドリーに答えてください。
現状の機能としては、ユーザーが「デプロイして」と明確に指示した場合はコマンドを実行しますが、それ以外の通常のチャットには相槌やアドバイスを返してください。`
});

// チャット履歴を保持するオブジェクト (簡易メモリ)
const chatHistories = new Map();

// ----- Initialize Discord Client -----
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

client.once('ready', () => {
    console.log(`================================`);
    console.log(`[DIS-DEX-BOT] Logged in as ${client.user.tag}!`);
    console.log(`[DIS-DEX-BOT] Gemini AI is Connected.`);
    console.log(`[DIS-DEX-BOT] Ready to receive commands in Discord!`);
    console.log(`================================`);
});

client.on('messageCreate', async (message) => {
    // Bot自身のメッセージは無視
    if (message.author.bot) return;

    // TODO: 本番運用時は自分のIDのみに制限する
    // if (message.author.id !== 'あなたのDiscordID') return;

    const content = message.content.trim();

    // 1. 特殊コマンド処理: デプロイ
    if (content === '!deploy' || content === 'デプロイして') {
        logToAntigravity("デプロイ実行", `ユーザー ${message.author.username} がデプロイをリクエストしました。`);
        const reply = await message.reply('⏳ Vercelへのデプロイを開始します。少々お待ちください...');

        exec('npx vercel --prod --yes', (error, stdout, stderr) => {
            if (error) {
                console.error(`Deploy error: ${error}`);
                reply.edit(`❌ デプロイ中にエラーが発生しました。\n\`\`\`\n${error.message.substring(0, 1800)}\n\`\`\``);
                logToAntigravity("デプロイ失敗", `エラー内容:\n\`\`\`\n${error.message}\n\`\`\``);
                return;
            }

            const output = stdout || stderr;
            reply.edit(`✅ デプロイが完了しました！\n\`\`\`\n${output.substring(0, 1800)}\n\`\`\``);
            logToAntigravity("デプロイ成功", `Vercelへのデプロイが完了しました。`);
        });
        return;
    }

    // 2. 特殊コマンド処理: ステータス確認
    if (content === '!status' || content === 'ステータス') {
        logToAntigravity("ステータス確認", `ユーザー ${message.author.username} がステータスを確認しました。`);
        message.reply('🟢 DIS-DEX 開発用Bot(AI搭載版)は正常にローカルPCと接続され、待機中です。\n対応コマンド: `!deploy`, `デプロイして`\nそれ以外の言葉にはAIがお返事します。');
        return;
    }

    // 3. AIとの会話処理 (メンションされた時、またはDMの時)
    // チャンネル内ではメンション必須にする (全メッセージに反応させないため)
    const isDM = message.guild === null;
    const isMentioned = message.mentions.has(client.user.id);

    if (isDM || isMentioned) {
        // メンション部分のテキストを削除
        const cleanMessage = content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();

        if (!cleanMessage) return;

        logToAntigravity("AIとの会話", `**User (${message.author.username}):** ${cleanMessage}`);

        // "Typing..." を表示
        await message.channel.sendTyping();

        try {
            // ユーザーごとのチャットセッションを取得・新規作成
            const userId = message.author.id;
            if (!chatHistories.has(userId)) {
                const chatSession = model.startChat({
                    history: [],
                    generationConfig: {
                        maxOutputTokens: 1000,
                    },
                });
                chatHistories.set(userId, chatSession);
            }

            const chat = chatHistories.get(userId);
            const result = await chat.sendMessage(cleanMessage);
            const responseText = result.response.text();

            logToAntigravity("AIの返答", `**Bot:** ${responseText}`);

            // Discordの文字数制限(2000文字)対策
            if (responseText.length > 2000) {
                await message.reply("📝 " + responseText.substring(0, 1900) + "...\n(文章が長すぎるため省略されました)");
            } else {
                await message.reply(responseText);
            }

        } catch (error) {
            console.error("Gemini API Error:", error);
            message.reply("⚠️ AIの処理中にエラーが発生しました。");
            logToAntigravity("AIエラー", `エラーが発生しました: ${error.message}`);
        }
    }
});

// Botログイン
client.login(DISCORD_TOKEN);
