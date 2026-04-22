const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const https = require('https');

const outputDir = path.join(__dirname, '../public/audio/tutorial');

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const steps = [
    {
        filename: 'step0_coord.mp3',
        text: 'DIS-DEXへようこそ！DIS-DEXは5体のAIエージェントが24時間市場を分析し、最適なトレード戦略を提案する次世代DEXトレーディングプラットフォームです。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step1_coord.mp3',
        text: '右上のウォレット接続ボタンからメタマスクなどを接続すると、AIエージェントによる自動トレードが開始されます。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step2_tech.mp3',
        text: 'チャートパターンやテクニカル指標を分析し、エントリーとエグジットのタイミングを正確に判断します。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step3_sent.mp3',
        text: 'SNSやニュースの動向をリアルタイムで監視し、市場の感情を読み解きます。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step4_biz.mp3',
        text: 'プロジェクトの将来性や開発状況を評価し、長期的な価値を見極めます。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step5_sec.mp3',
        text: 'スマートコントラクトの安全性やラグプルリスクを徹底的にチェックします。',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    },
    {
        filename: 'step6_coord.mp3',
        text: '5体のAIが協力し、あなたの資産運用をサポートします。準備はいいですか？',
        lang: 'ja',
        slow: false,
        host: 'https://translate.google.com',
    }
];

// Helper to download file
const download = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(dest));
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
};

async function generateAudio() {
    console.log('Generating audio files...');

    for (const step of steps) {
        try {
            // Note: google-tts-api limit is 200 chars, our texts are short enough
            const url = googleTTS.getAudioUrl(step.text, {
                lang: step.lang,
                slow: step.slow,
                host: step.host,
            });

            const dest = path.join(outputDir, step.filename);
            await download(url, dest);
            console.log(`Generated: ${step.filename}`);

            // Wait a bit to be nice to the API
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`Failed to generate ${step.filename}:`, e);
        }
    }
    console.log('Done!');
}

generateAudio();
