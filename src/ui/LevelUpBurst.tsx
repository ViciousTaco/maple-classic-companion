import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// P5-T8: a burst of maple leaves when the level goes up (reduced-motion: skipped).

const LEAVES = 14;

export function LevelUpBurst({ level }: { level: number }) {
  const prev = useRef(level);
  const reduced = useReducedMotion();
  const [burst, setBurst] = useState<number | null>(null);
  useEffect(() => {
    if (level > prev.current && !reduced) {
      const id = Date.now();
      // Deferred so the state change isn't synchronous within the effect.
      const t = setTimeout(() => setBurst(id), 0);
      const clear = setTimeout(() => setBurst((b) => (b === id ? null : b)), 1400);
      prev.current = level;
      return () => {
        clearTimeout(t);
        clearTimeout(clear);
      };
    }
    prev.current = level;
  }, [level, reduced]);

  return (
    <span className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <AnimatePresence>
        {burst !== null &&
          Array.from({ length: LEAVES }, (_, i) => {
            const angle = (i / LEAVES) * Math.PI * 2;
            const dist = 46 + (i % 3) * 14;
            return (
              <motion.svg
                key={`${burst}-${i}`}
                viewBox="0 0 24 24"
                width="14"
                height="14"
                className="absolute left-1/2 top-1/2"
                initial={{ x: -7, y: -7, opacity: 1, scale: 0.4, rotate: 0 }}
                animate={{ x: Math.cos(angle) * dist - 7, y: Math.sin(angle) * dist - 7 + 18, opacity: 0, scale: 1, rotate: (i % 2 ? 1 : -1) * 220 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: [0.2, 0.8, 0.3, 1] }}
              >
                <path d="M12 2c4 2 6 6 4 11-1 3-3 5-4 9-1-4-3-6-4-9C6 8 8 4 12 2z" fill={i % 3 === 0 ? "#ffb06a" : i % 3 === 1 ? "#ff6a2b" : "#2fb35a"} />
              </motion.svg>
            );
          })}
      </AnimatePresence>
    </span>
  );
}
