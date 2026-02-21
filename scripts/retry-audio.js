const fs = require('fs');
const https = require('https');
const path = require('path');

const outputDir = path.join(__dirname, '../public/audio/tutorial');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// ... (rest of the script is the same as above, just changing IsArtifact to false)
// Just copying the content again to be safe
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
    }
];

// Mapping roles to specific voices
const voiceMap = {
    'coordinator': 'Takumi',
    'tech': 'Takumi',
    'sent': 'Mizuki',
    'biz': 'Mizuki',
    'sec': 'Takumi'
};

function fetchTTS(text, role) {
    return new Promise((resolve, reject) => {
        // Simple mock of previous logic but specialized for retry
        const voice = voiceMap[role] || 'Takumi';
        const postData = querystring.stringify({
            msg: text,
            lang: voice,
            source: 'ttsmp3'
        });

        const options = {
            hostname: 'ttsmp3.com',
            port: 443,
            path: '/makemp3_new.php',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.URL) {
                        resolve(json.URL);
                    } else {
                        // If json.Text exists, it's an error message
                        reject(new Error(`API Error: ${json.Text || 'Unknown error'} - Response: ${body}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}
// Wait, I used 'querystring' but didn't require it. I should fix that.
const querystring = require('querystring');

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateAll() {
    console.log('Starting RETRY TTS generation...');
    for (const step of steps) {
        try {
            console.log(`Generating ${step.filename}...`);
            const mp3Url = await fetchTTS(step.text, step.role);
            console.log(`  -> URL: ${mp3Url}`);

            const destPath = path.join(outputDir, step.filename);
            await downloadFile(mp3Url, destPath);
            console.log(`  -> Saved to ${step.filename}`);

            await sleep(3000); // 3 seconds delay

        } catch (error) {
            console.error(`Failed to generate ${step.filename}:`, error.message);
        }
    }
    console.log('Retry completed.');
}

generateAll();
