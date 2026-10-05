/**
 * Web Speech API based Audio Service
 * Enables real-time AI voice synthesis in the browser.
 */

export async function playAIVoice(text: string, voiceId: string, isMuted: boolean = false): Promise<void> {
    if (isMuted || typeof window === 'undefined' || !window.speechSynthesis) return;

    // Clean text (remove markdown-like symbols for smoother speech)
    const cleanText = text.replace(/[*#_~]/g, '');

    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'ja-JP';

        // Voice characteristics based on voiceId (agent role)
        switch (voiceId) {
            case 'fable': // Tech
                utterance.pitch = 1.1;
                utterance.rate = 1.0;
                break;
            case 'coral': // Sent
                utterance.pitch = 1.2;
                utterance.rate = 1.1;
                break;
            case 'onyx': // Sec
                utterance.pitch = 0.8;
                utterance.rate = 0.9;
                break;
            case 'echo': // Biz
                utterance.pitch = 1.0;
                utterance.rate = 0.95;
                break;
            case 'nova': // Coord/Dis
                utterance.pitch = 1.0;
                utterance.rate = 1.0;
                break;
            default:
                utterance.pitch = 1.0;
                utterance.rate = 1.0;
        }

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        // Optional: Select a specific Japanese voice if available
        const voices = window.speechSynthesis.getVoices();
        const jaVoice = voices.find(v => v.lang.includes('ja'));
        if (jaVoice) utterance.voice = jaVoice;

        window.speechSynthesis.speak(utterance);
    });
}

export function stopAIVoice() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

export function playStaticAudio(url: string) {
    if (typeof window !== 'undefined') {
        const audio = new Audio(url);
        audio.volume = 0.4;
        audio.play().catch(e => console.warn("Static audio play failed:", e));
    }
}
