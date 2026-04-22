"use client";

import { useCallback, useRef } from 'react';

export const useSoundFX = () => {
    const audioCtx = useRef<AudioContext | null>(null);

    const initContext = () => {
        if (!audioCtx.current) {
            audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtx.current.state === 'suspended') {
            audioCtx.current.resume();
        }
    };

    const playTone = useCallback((freq: number, type: OscillatorType, duration: number, volume: number = 0.1) => {
        initContext();
        if (!audioCtx.current) return;

        const osc = audioCtx.current.createOscillator();
        const gain = audioCtx.current.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);

        gain.gain.setValueAtTime(volume, audioCtx.current.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.current.currentTime + duration);

        osc.connect(gain);
        gain.connect(audioCtx.current.destination);

        osc.start();
        osc.stop(audioCtx.current.currentTime + duration);
    }, []);

    // Preset sounds
    const playSuccess = useCallback(() => {
        playTone(523.25, 'sine', 0.5, 0.1); // C5
        setTimeout(() => playTone(659.25, 'sine', 0.5, 0.08), 100); // E5
        setTimeout(() => playTone(783.99, 'sine', 0.8, 0.05), 200); // G5
    }, [playTone]);

    const playNotification = useCallback(() => {
        playTone(880, 'triangle', 0.1, 0.05); // A5
        setTimeout(() => playTone(440, 'triangle', 0.2, 0.03), 100); // A4
    }, [playTone]);

    const playAlert = useCallback(() => {
        playTone(220, 'sawtooth', 0.3, 0.05); // A3
        setTimeout(() => playTone(220, 'sawtooth', 0.3, 0.05), 400);
    }, [playTone]);

    const playTrade = useCallback(() => {
        playTone(1046.50, 'sine', 0.05, 0.05); // C6
        setTimeout(() => playTone(2093.00, 'sine', 0.05, 0.03), 50); // C7
    }, [playTone]);

    return { playSuccess, playNotification, playAlert, playTrade };
};
