const path = require('path');

const replacementScript = path.join(__dirname, 'generate-audio-ttsmp3.js');

console.error('[generate-audio] The legacy Google TTS generator has been retired.');
console.error(`[generate-audio] Use ${replacementScript} instead.`);
process.exitCode = 1;
