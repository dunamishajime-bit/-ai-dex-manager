'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRankingMotionBatches, createRankingMovementPhases, playRankingSequence } from '@/lib/ranking-motion-groups';
import {
  canReuseRankingAudioContext,
  chooseRankingSound,
  playRankingSound,
  preloadRankingSound,
  loadRankingSoundSelections,
  rankingSoundsForRole,
  DEFAULT_RANKING_SOUND_SELECTIONS,
  type RankingSoundRole,
  type RankingSoundSelections,
} from '@/lib/ranking-sounds';
import type { RankRow } from '@/lib/realtime-ranking';

type Frame = {
  rows: RankRow[];
  rects: Map<string, DOMRect>;
  scrollX: number;
  scrollY: number;
};

type MotionItem = {
  clone: HTMLElement;
  frames: Keyframe[];
  color: string;
};

type MotionGroup = {
  id: string;
  role: 'rise' | 'fall';
  items: MotionItem[];
};

const CURRENCY_FOREGROUND_MOTION_MS = 3600;
const CURRENCY_FRAME_PALETTE = ['#67e8f9', '#c4b5fd', '#fbbf24', '#6ee7b7', '#fda4af'];

/**
 * Ranking feedback deliberately animates each currency, not the whole board.
 * The foreground clone is the historical UI behavior: a rising currency is
 * lifted above its neighbors, travels across the board, and lands in its new
 * authoritative position. Multiple visible nodes for one currency (the full
 * row and a Top-3 card) share one color and move together. All rising
 * currencies move in one batch, followed by one falling batch.
 */
export function useRealtimeRankingFeedback(rows: RankRow[], version: number, viewKey: string, error: string) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [soundIds, setSoundIds] = useState<RankingSoundSelections>(DEFAULT_RANKING_SOUND_SELECTIONS);
  const [audioNotice, setAudioNotice] = useState('');

  const current = useRef(rows);
  const nodes = useRef(new Map<string, HTMLElement>());
  const captured = useRef<Frame | null>(null);
  const previous = useRef<Frame | null>(null);
  const seen = useRef(-1);
  const currentView = useRef(viewKey);
  const animations = useRef<Animation[]>([]);
  const clones = useRef<HTMLElement[]>([]);
  const hiddenNodes = useRef<HTMLElement[]>([]);
  const generation = useRef(0);
  const running = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const prefs = useRef({ sound: true, motion: true, soundIds: DEFAULT_RANKING_SOUND_SELECTIONS });

  current.current = rows;
  prefs.current = { sound: soundEnabled, motion: motionEnabled, soundIds };

  const measure = useCallback((): Frame => ({
    rows: current.current,
    rects: new Map([...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect()])),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }), []);

  const prepare = useCallback(() => {
    captured.current = measure();
  }, [measure]);

  const stopVisuals = useCallback(() => {
    generation.current += 1;
    running.current = false;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    clones.current.forEach((clone) => clone.remove());
    clones.current = [];
    hiddenNodes.current.forEach((node) => {
      node.style.opacity = '';
    });
    hiddenNodes.current = [];
  }, []);

  const ensureAudio = useCallback(async () => {
    const Audio = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) throw Error('AUDIO_CONTEXT_UNAVAILABLE');
    if (!canReuseRankingAudioContext(audio.current)) audio.current = new Audio();
    if (audio.current!.state !== 'running') await audio.current!.resume();
    return audio.current!;
  }, []);

  const playEffect = useCallback(async (role: RankingSoundRole, force = false) => {
    if (!force && (!prefs.current.sound || document.hidden)) return;
    try {
      const startedAt = Date.now();
      const ctx = await ensureAudio();
      const sound = chooseRankingSound(prefs.current.soundIds[role], role);
      await playRankingSound(ctx, sound, { preview: force, startTimestamp: startedAt });
      if (force) setAudioNotice('試聴中：' + sound.label);
    } catch {
      setAudioNotice('効果音を再生できません。効果音ONまたは試聴を押し、ブラウザの音声許可を確認してください。');
    }
  }, [ensureAudio]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('disdex-ranking-show') || '{}') as Record<string, unknown>;
      const sounds = loadRankingSoundSelections(saved.soundIds, saved.soundId);
      setMotionEnabled(saved.motion !== false);
      setSoundEnabled(saved.sound !== false);
      setSoundIds(sounds);
      prefs.current = { sound: saved.sound !== false, motion: saved.motion !== false, soundIds: sounds };
    } catch {
      // Keep the safe in-memory defaults when local preferences are malformed.
    }
    return () => {
      stopVisuals();
      try {
        audio.current?.close().catch(() => {});
      } catch {
        // Audio cleanup is best effort during unmount.
      }
    };
  }, [stopVisuals]);

  const persist = useCallback((next: { sound: boolean; motion: boolean; soundIds: RankingSoundSelections }) => {
    prefs.current = next;
    try {
      localStorage.setItem('disdex-ranking-show', JSON.stringify(next));
    } catch {
      // Browser storage can be unavailable in private/restricted contexts.
    }
  }, []);

  const toggleSound = useCallback(() => {
    const value = !prefs.current.sound;
    setSoundEnabled(value);
    persist({ ...prefs.current, sound: value });
    if (value) {
      void ensureAudio()
        .then(() => setAudioNotice('効果音を有効にしました。'))
        .catch(() => setAudioNotice('このブラウザは効果音に対応していません。'));
    }
  }, [ensureAudio, persist]);

  const toggleMotion = useCallback(() => {
    const value = !prefs.current.motion;
    setMotionEnabled(value);
    persist({ ...prefs.current, motion: value });
    if (!value) stopVisuals();
  }, [persist, stopVisuals]);

  const selectSound = useCallback((role: RankingSoundRole, id: string) => {
    const selected = chooseRankingSound(id, role);
    const next = { ...prefs.current.soundIds, [role]: selected.id };
    setSoundIds(next);
    persist({ ...prefs.current, soundIds: next });
    setAudioNotice('音色を変更しました：' + selected.label);
  }, [persist]);

  const testSound = useCallback((role: RankingSoundRole) => {
    void playEffect(role, true);
  }, [playEffect]);

  useEffect(() => {
    if (!soundEnabled) return;
    const Audio = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    if (!canReuseRankingAudioContext(audio.current)) audio.current = new Audio();
    (['rise', 'fall', 'top3'] as const).forEach((role) => {
      void preloadRankingSound(audio.current!, chooseRankingSound(soundIds[role], role)).catch(() => {});
    });
  }, [soundEnabled, soundIds]);

  useLayoutEffect(() => {
    if (currentView.current !== viewKey) {
      stopVisuals();
      currentView.current = viewKey;
      captured.current = null;
      previous.current = measure();
      seen.current = version;
      return;
    }
    if (version === seen.current) return;
    seen.current = version;
    if (version < 0 || error) {
      stopVisuals();
      captured.current = null;
      previous.current = measure();
      return;
    }

    const before = captured.current || previous.current;
    const after = measure();
    captured.current = null;
    previous.current = after;
    if (!before || !version) return;

    stopVisuals();
    const phases = createRankingMovementPhases(before.rows, after.rows);
    if (!phases.length) return;
    if (!prefs.current.motion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const oldRows = new Map(before.rows.map((row) => [row.id, row]));
    const newRows = new Map(after.rows.map((row) => [row.id, row]));
    const groups: MotionGroup[] = [];
    const colorByCurrency = new Map<string, string>();
    const batches = createRankingMotionBatches(phases);

    for (const batch of batches) {
      const items: MotionItem[] = [];
      for (const change of batch.changes) {
        const oldRow = oldRows.get(change.id);
        const newRow = newRows.get(change.id);
        if (!oldRow?.fresh || !newRow?.fresh || oldRow.score === null || newRow.score === null) continue;

        const color = colorByCurrency.get(change.id) || CURRENCY_FRAME_PALETTE[colorByCurrency.size % CURRENCY_FRAME_PALETTE.length];
        colorByCurrency.set(change.id, color);
        for (const key of ['row:' + change.id, 'leader:' + change.id]) {
          const node = nodes.current.get(key);
          const old = before.rects.get(key);
          const end = node?.getBoundingClientRect();
          if (!node || !old || !end?.width || !end.height) continue;
          if (old.bottom < 0 || old.top > innerHeight || end.bottom < 0 || end.top > innerHeight) continue;
          if (Math.abs(old.left + before.scrollX - window.scrollX - end.left) < 0.5
            && Math.abs(old.top + before.scrollY - window.scrollY - end.top) < 0.5) continue;

          const startX = old.left + before.scrollX - window.scrollX;
          const startY = old.top + before.scrollY - window.scrollY;
          const clone = node.cloneNode(true) as HTMLElement;
          clone.removeAttribute('id');
          clone.removeAttribute('data-ranking-row');
          clone.removeAttribute('data-ranking-leader');
          clone.setAttribute('aria-hidden', 'true');
          clone.setAttribute('inert', '');
          clone.classList.add('ranking-flyer');
          Object.assign(clone.style, {
            position: 'fixed',
            left: end.left + 'px',
            top: end.top + 'px',
            width: end.width + 'px',
            height: end.height + 'px',
            zIndex: '90',
            pointerEvents: 'none',
            background: '#20291c',
            border: '1px solid #efd58c',
            borderRadius: '6px',
            margin: '0',
            willChange: 'transform, box-shadow',
          });
          clone.dataset.rankingCurrency = change.id;
          clone.dataset.rankingRole = batch.direction;
          document.body.appendChild(clone);
          clones.current.push(clone);
          node.style.opacity = '0';
          hiddenNodes.current.push(node);

          const dx = startX - end.left;
          const dy = startY - end.top;
          const isRising = batch.direction === 'rise';
          const scale = Math.max(1, Math.min(1.8, (innerWidth - 32) / end.width));
          const marginX = (scale - 1) * end.width / 2;
          const marginY = (scale - 1) * end.height / 2;
          const lift = Math.min(90, Math.max(64, end.height * 0.7));
          const foregroundX = (x: number) => Math.max(16 + marginX, Math.min(innerWidth - end.width - marginX - 16, end.left + x)) - end.left;
          const foregroundY = (y: number) => Math.max(16 + marginY, Math.min(innerHeight - end.height - marginY - 16, end.top + y - lift)) - end.top;
          const shadow = '0 36px 64px #000d, 0 0 36px #f4d77f99';
          const frames: Keyframe[] = isRising ? [
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, boxShadow: '0 0 0 transparent', offset: 0 },
            { transform: `translate(${foregroundX(dx)}px, ${foregroundY(dy)}px) scale(${scale})`, boxShadow: shadow, offset: 0.2 },
            { transform: `translate(${foregroundX(dx)}px, ${foregroundY(dy)}px) scale(${scale})`, boxShadow: shadow, offset: 0.34 },
            { transform: `translate(${foregroundX(0)}px, ${foregroundY(0)}px) scale(${scale})`, boxShadow: shadow, offset: 0.74 },
            { transform: 'translate(0, -8px) scale(1.12)', boxShadow: '0 12px 24px #0009, 0 0 24px #f4d77f66', offset: 0.9 },
            { transform: 'translate(0, 0) scale(1)', boxShadow: '0 0 24px #e8ce7e55', offset: 1 },
          ] : [
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, offset: 0 },
            { transform: 'translate(0, 0) scale(1)', offset: 1 },
          ];
          clone.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
          items.push({ clone, frames, color });
        }
      }
      if (items.length) groups.push({ id: batch.direction, role: batch.direction, items });
    }

    if (!groups.length) return;
    const run = generation.current;
    running.current = true;
    void playRankingSequence(
      groups,
      async (group) => {
        if (generation.current !== run) return;
        void playEffect(group.role);
        await Promise.all(group.items.map(({ clone, frames, color }) => {
          clone.style.zIndex = '150';
          clone.style.borderColor = color;
          clone.style.outline = '2px solid ' + color;
          clone.style.outlineOffset = '-2px';
          clone.dataset.rankingMoving = 'true';
          const animation = clone.animate(frames, {
            duration: CURRENCY_FOREGROUND_MOTION_MS,
            easing: 'cubic-bezier(.22, .7, .25, 1)',
            fill: 'forwards',
          });
          animations.current.push(animation);
          return animation.finished.then(() => {
            if (generation.current !== run) return;
            clone.dataset.rankingMoving = 'false';
            clone.dataset.rankingCompleted = 'true';
            clone.style.zIndex = '120';
          }).catch(() => {});
        }));
      },
      () => generation.current === run,
      () => stopVisuals(),
    );
  }, [version, viewKey, error, measure, playEffect, stopVisuals]);

  useEffect(() => {
    const reset = () => {
      if (!running.current) return;
      stopVisuals();
      previous.current = measure();
      captured.current = null;
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('scroll', reset, true);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', reset);
    media.addEventListener('change', reset);
    return () => {
      window.removeEventListener('scroll', reset, true);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', reset);
      media.removeEventListener('change', reset);
    };
  }, [measure, stopVisuals]);

  const register = useCallback((key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  return {
    soundEnabled,
    motionEnabled,
    soundIds,
    audioNotice,
    toggleSound,
    toggleMotion,
    selectSound,
    testSound,
    register,
    prepare,
    isShowing: () => running.current,
    rankingSoundsForRole,
  };
}
