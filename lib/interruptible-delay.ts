export interface InterruptibleDelay {
    wait(milliseconds: number): Promise<void>;
    interrupt(): void;
    readonly interrupted: boolean;
}

export function createInterruptibleDelay(): InterruptibleDelay {
    let interrupted = false;
    let activeTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveActive: (() => void) | undefined;

    const finish = () => {
        if (activeTimer) clearTimeout(activeTimer);
        activeTimer = undefined;
        const resolveWait = resolveActive;
        resolveActive = undefined;
        resolveWait?.();
    };

    return {
        get interrupted() {
            return interrupted;
        },
        wait(milliseconds) {
            if (interrupted) return Promise.resolve();
            if (resolveActive) throw new Error("Interruptible delay already has an active wait.");
            return new Promise<void>((resolveWait) => {
                resolveActive = resolveWait;
                activeTimer = setTimeout(finish, Math.max(0, milliseconds));
            });
        },
        interrupt() {
            interrupted = true;
            finish();
        },
    };
}
