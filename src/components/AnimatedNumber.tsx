import { useEffect, useMemo, useState } from "react";

type Props = {
  value: number;
  decimals?: number;
  durationMs?: number;
};

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function AnimatedNumber({ value, decimals = 2, durationMs = 650 }: Props) {
  const target = Number.isFinite(value) ? value : 0;
  const reduce = useMemo(() => prefersReducedMotion(), []);
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (reduce) {
      setShown(target);
      return;
    }

    const from = shown;
    const to = target;
    const start = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, reduce]);

  return <>{shown.toFixed(decimals)}</>;
}
