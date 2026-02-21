const fs = require('fs');
const path = require('path');
const https = require('https');

// Output directory
const outputDir = path.join(__dirname, '../public/audio/tutorial');

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Data from users implementation plan
// Coordinator: Mizuki or Takumi (Ash equivalent? User said Ash for Coord, but ttsmp3 only has Takumi/Mizuki. I'll use Takumi for male/Ash-like and Mizuki for female)
// Actually user asked for "Ash" earlier, but now says "ttsmp3.com". 
// ttsmp3.com Japanese voices: Takumi (Male), Mizuki (Female).
// I will map:
// Coord (was Ash/Male): Takumi
// Tech (Male): Takumi (pitch adjusted later in frontend? No, ttsmp3 doesn't allow pitch control in free API. I have to generate separate files if I can, but free API doesn't support pitch. I will use Takumi for all males and Miki/Mizuki for females?
// Wait, ttsmp3 only has Takumi and Mizuki for Japanese.
// This is a limitation. All males will sound like Takumi and all females like Mizuki.
// User said "Ash is good for Coordinator". Ash is male. So Coord = Takumi.
// Tech = Takumi.
// Sent = Mizuki.
// Biz = Takumi.
// Sec = Takumi.
// This might be monotonous.
// But the user specifically asked for ttsmp3.com.
// I will generate them and maybe the user will be happy with just high quality voices even if duplicates.
// Or I can use "Takumi" for Coord and "Mizuki" for others? No, gender mismatch.
// I will stick to Gender mapping.

const steps = [
    {
        filename: 'mp3-step0_dis.mp3',
        text: 'ようこそ、ディス・デックス・マネージャーへ。私はコーディレーターのディスです。全エージェントを統括し、あなたの資産形成をサポートします。これから、頼れる4人の仲間たちを紹介させてください。',
        role: 'coordinator'
    },
    {
        filename: 'mp3-step1_tech.mp3',
        text: 'よお、俺はテックだ。チャートの向こう側にある『真実』を見抜くのが仕事さ。RSI、MACD、あらゆるインジケーターを解析し、完璧なエントリーポイントを叩き出してやる。俺に任せな。',
        role: 'tech'
    },
    {
        filename: 'mp3-step2_sent.mp3',
        text: 'やっほー！あたしはセントだよ！市場の『空気』を読むのが超トクイなの。流行り廃りや、みんなが何を恐れているか、ぜーんぶお見通しだよ！一緒に波に乗ろうね！',
        role: 'sent'
    },
    {
        filename: 'mp3-step3_biz.mp3',
        text: 'お初にお目にかかります、ビズと申します。私の役割は、ファンダメンタルズ分析と、徹底した資金管理です。リスクを最小限に抑え、持続可能な資産拡大を実現します。',
        role: 'biz'
    },
    {
        filename: 'mp3-step4_sec.mp3',
        text: '俺はセック。セキュリティ担当だ。常にスマートコントラクトの脆弱性や不審な動きを監視している。お前の資産を狙うハイエナどもは、俺が全て排除する。安心しろ。',
        role: 'sec'
    },
    {
        filename: 'mp3-step5_coord.mp3',
        text: '個性豊かなメンバーですが、彼らの能力は本物です。私たちが議論を戦わせ、導き出した結論は、あなたのポートフォリオを確実に成長させるでしょう。',
        role: 'coordinator'
    },
    {
        filename: 'mp3-step6_dis.mp3',
        text: 'さあ、右上のボタンからウォレットを接続して、未来のトレーディングを始めましょう。',
        role: 'coordinator'
    }
];

// Voice Mapping (AI Voices from ttsmp3.com / OpenAI)
const VOICE_MAP = {
    "coordinator": "onyx",
    "tech": "alloy",
    "biz": "echo",
    "sec": "onyx",
    "sent": "nova",
    "alpha": "alloy",
    "beta": "nova",
    "delta": "onyx",
    "gamma": "echo",
    "epsilon": "fable",
    "zeta": "shimmer",
    "default": "alloy"
};

function fetchTTS(text, role) {
    return new Promise((resolve, reject) => {
        const voice = VOICE_MAP[role] || "alloy";

        // Using makemp3_ai.php for AI voices
        // Payload: msg, lang (voice), source=ttsmp3, instruction, speed
        const data = new URLSearchParams({
            msg: text,
            lang: voice,
            source: "ttsmp3",
            instruction: "", // Optional instruction
            speed: "1.00"
        });

        const options = {
            hostname: "ttsmp3.com",
            path: "/makemp3_ai.php",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Content-Length": Buffer.byteLength(data.toString())
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.Error === 0 && json.URL) {
                        resolve(json.URL);
                    } else {
                        reject(new Error(`API Error: ${json.Text || 'Unknown error'}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data.toString());
        req.end();
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function generateAll() {
    console.log('Starting TTS generation...');
    for (const step of steps) {
        try {
            // Pronunciation fix
            const fixedText = step.text.replace(/DIS-DEX/g, 'ディスデックス');

            console.log(`Generating ${step.filename} (${step.role})...`);
            const mp3Url = await fetchTTS(fixedText, step.role);
            console.log(`  -> URL: ${mp3Url}`);

            const destPath = path.join(outputDir, step.filename);
            await downloadFile(mp3Url, destPath);
            console.log(`  -> Saved to ${step.filename}`);

            // Respect rate limits if any
            await new Promise(r => setTimeout(r, 1000));
        } catch (error) {
            console.error(`Failed to generate ${step.filename}:`, error);
        }
    }
    console.log('Use of ttsmp3.com completed.');
}

generateAll();
