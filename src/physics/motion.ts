// Display motion: short tweens that carry a card's drawn pose to its model
// position. Animations never block input (spec 15.5); a new tween simply
// starts from wherever the card is drawn right now.

import type { CardLayer, Pose } from '../render/cards';

export type Ease = (t: number) => number;
export const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Tween {
  from: Pose;
  to: Pose;
  start: number;
  duration: number;
  ease: Ease;
  /** Extra height at the middle of the tween, for flips and tosses. */
  arc: number;
  /** A small hop at the end, in millimetres: the soft bounce of a landing. */
  bounce: number;
  done?: () => void;
}

export class Motion {
  private readonly tweens = new Map<string, Tween>();
  /** Cards whose pose is driven by something else (a drag or physics); tweens skip them. */
  readonly held = new Set<string>();
  now = 0;

  constructor(private readonly layer: CardLayer) {}

  get busy(): boolean {
    return this.tweens.size > 0;
  }

  isAnimating(uid: string): boolean {
    return this.tweens.has(uid);
  }

  /** Animate a card's pose to `to`. A delay is expressed as a later start time. */
  animate(uid: string, to: Partial<Pose>, opts: { duration?: number; delay?: number; ease?: Ease; arc?: number; bounce?: number; done?: () => void } = {}): void {
    const cur = this.layer.pose(uid);
    if (!cur) return;
    const target: Pose = { ...cur, tiltX: 0, tiltY: 0, ...to };
    this.tweens.set(uid, {
      from: { ...cur },
      to: target,
      start: this.now + (opts.delay ?? 0),
      duration: Math.max(1, opts.duration ?? 160),
      ease: opts.ease ?? easeOut,
      arc: opts.arc ?? 0,
      bounce: opts.bounce ?? 0,
      done: opts.done,
    });
  }

  /** Jump straight to a pose, cancelling any tween. */
  snap(uid: string, to: Partial<Pose>): void {
    this.tweens.delete(uid);
    this.layer.setPose(uid, to);
  }

  cancel(uid: string): void {
    this.tweens.delete(uid);
  }

  /** Where the card will end up (the tween target), or where it is now. */
  targetOf(uid: string): Pose | undefined {
    return this.tweens.get(uid)?.to ?? this.layer.pose(uid);
  }

  update(now: number): void {
    this.now = now;
    const finished: [string, Tween][] = [];
    for (const [uid, tw] of this.tweens) {
      if (this.held.has(uid)) continue;
      if (now < tw.start) continue;
      const pose = this.layer.pose(uid);
      if (!pose) {
        this.tweens.delete(uid);
        continue;
      }
      const t = Math.min(1, (now - tw.start) / tw.duration);
      const k = tw.ease(t);
      const a = tw.from;
      const b = tw.to;
      pose.x = a.x + (b.x - a.x) * k;
      pose.y = a.y + (b.y - a.y) * k;
      pose.z = a.z + (b.z - a.z) * k + tw.arc * Math.sin(Math.PI * t);
      if (tw.bounce && t > 0.7) pose.z += tw.bounce * Math.sin((Math.PI * (t - 0.7)) / 0.3);
      pose.yaw = a.yaw + shortAngle(b.yaw - a.yaw) * k;
      pose.roll = a.roll + (b.roll - a.roll) * k;
      pose.tiltX = a.tiltX + (b.tiltX - a.tiltX) * k;
      pose.tiltY = a.tiltY + (b.tiltY - a.tiltY) * k;
      this.layer.touch(uid);
      if (t >= 1) finished.push([uid, tw]);
    }
    for (const [uid, tw] of finished) {
      if (this.tweens.get(uid) === tw) this.tweens.delete(uid);
      tw.done?.();
    }
  }
}

export function shortAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
