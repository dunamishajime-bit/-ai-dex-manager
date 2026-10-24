export type LatestRequestToken = {
  signal: AbortSignal;
  isLatest: () => boolean;
};

export class LatestRequestGate {
  private sequence = 0;
  private controller: AbortController | null = null;

  begin(): LatestRequestToken {
    this.controller?.abort();
    const controller = new AbortController();
    const sequence = ++this.sequence;
    this.controller = controller;
    return {
      signal: controller.signal,
      isLatest: () => sequence === this.sequence && !controller.signal.aborted,
    };
  }

  finish(token: LatestRequestToken) {
    if (token.isLatest()) this.controller = null;
  }

  cancel() {
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
