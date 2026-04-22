"use client";

import React, { useEffect, useRef, useCallback } from 'react';

interface ParticleConfig {
    count: number;
    speedMultiplier: number;
    colorScheme: 'gold' | 'gold-teal' | 'gold-red';
}

const DEFAULT_CONFIG: ParticleConfig = {
    count: 80,
    speedMultiplier: 1,
    colorScheme: 'gold',
};

const ACTIVE_CONFIG: ParticleConfig = {
    count: 160,
    speedMultiplier: 2.5,
    colorScheme: 'gold-teal',
};

const ParticleBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const configRef = useRef<ParticleConfig>(DEFAULT_CONFIG);
    const particlesRef = useRef<any[]>([]);
    const frameRef = useRef<number>(0);

    const getColors = (scheme: ParticleConfig['colorScheme']) => {
        switch (scheme) {
            case 'gold-teal':
                return [
                    `rgba(255, 215, 0, `,
                    `rgba(20, 255, 200, `,
                    `rgba(255, 165, 0, `,
                ];
            case 'gold-red':
                return [
                    `rgba(255, 215, 0, `,
                    `rgba(255, 80, 80, `,
                    `rgba(255, 140, 0, `,
                ];
            default:
                return [
                    `rgba(255, 215, 0, `,
                    `rgba(255, 180, 0, `,
                    `rgba(255, 200, 50, `,
                ];
        }
    };

    const createParticle = useCallback((cw: number, ch: number) => {
        const colors = getColors(configRef.current.colorScheme);
        const colorBase = colors[Math.floor(Math.random() * colors.length)];
        const opacity = Math.random() * 0.5 + 0.05;
        const sp = configRef.current.speedMultiplier;
        return {
            x: Math.random() * cw,
            y: Math.random() * ch + ch * 0.1,
            size: Math.random() * 1.8 + 0.3,
            speedY: -(Math.random() * 0.6 + 0.08) * sp,
            speedX: (Math.random() * 0.3 - 0.15) * sp,
            opacity,
            opacityStep: (Math.random() * 0.003 + 0.001),
            opacityDir: 1,
            color: `${colorBase}${opacity})`,
            colorBase,
            pulsePhase: Math.random() * Math.PI * 2,
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let cw = window.innerWidth;
        let ch = window.innerHeight;

        const resize = () => {
            cw = window.innerWidth;
            ch = window.innerHeight;
            canvas.width = cw;
            canvas.height = ch;
        };

        const init = (targetCount: number) => {
            particlesRef.current = [];
            for (let i = 0; i < targetCount; i++) {
                particlesRef.current.push(createParticle(cw, ch));
            }
        };

        // Listen for AI activity events
        const handleAIActive = (e: CustomEvent) => {
            const isActive = e.detail?.active;
            configRef.current = isActive ? ACTIVE_CONFIG : DEFAULT_CONFIG;
        };

        window.addEventListener('ai-activity', handleAIActive as EventListener);
        window.addEventListener('resize', resize);

        resize();
        init(DEFAULT_CONFIG.count);

        let targetCount = DEFAULT_CONFIG.count;
        let tick = 0;

        const animate = () => {
            ctx.clearRect(0, 0, cw, ch);
            tick++;

            // Gradually adjust particle count
            const desired = configRef.current.count;
            if (tick % 20 === 0) {
                if (particlesRef.current.length < desired) {
                    particlesRef.current.push(createParticle(cw, ch));
                } else if (particlesRef.current.length > desired) {
                    particlesRef.current.splice(0, 1);
                }
            }

            particlesRef.current.forEach(p => {
                // Update position
                p.y += p.speedY;
                p.x += p.speedX;
                p.pulsePhase += 0.02;

                // Pulse opacity subtly
                p.opacity += p.opacityStep * p.opacityDir;
                if (p.opacity > 0.6 || p.opacity < 0.02) p.opacityDir *= -1;

                // Wrap / reset
                if (p.y < -10) {
                    Object.assign(p, createParticle(cw, ch));
                    p.y = ch + 5;
                }
                if (p.x < -10) p.x = cw + 5;
                if (p.x > cw + 10) p.x = -5;

                // Draw with radial glow
                const pulsSize = p.size * (1 + Math.sin(p.pulsePhase) * 0.2);
                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pulsSize * 3);
                grad.addColorStop(0, `${p.colorBase}${p.opacity})`);
                grad.addColorStop(0.5, `${p.colorBase}${p.opacity * 0.4})`);
                grad.addColorStop(1, `${p.colorBase}0)`);

                ctx.beginPath();
                ctx.arc(p.x, p.y, pulsSize * 3, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();

                // Inner bright core
                ctx.beginPath();
                ctx.arc(p.x, p.y, pulsSize * 0.6, 0, Math.PI * 2);
                ctx.fillStyle = `${p.colorBase}${Math.min(p.opacity * 2, 0.9)})`;
                ctx.fill();
            });

            frameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('resize', resize);
            window.removeEventListener('ai-activity', handleAIActive as EventListener);
            cancelAnimationFrame(frameRef.current);
        };
    }, [createParticle]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none z-0"
            style={{ opacity: 0.65 }}
        />
    );
};

export default ParticleBackground;
