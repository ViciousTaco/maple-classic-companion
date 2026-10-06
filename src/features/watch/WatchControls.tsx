import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, Pause } from "lucide-react";
import { navigate, usePlatform, useProfiles } from "../../app/context";
import { spring } from "../../ui/kit";
import { canWatch, useWatch } from "./useWatch";

// The always-visible top-bar control. One click turns watching on or off; red while it's on.

export function WatchPill() {
  const platform = usePlatform();
  const status = useWatch((s) => s.status);
  const kills = useWatch((s) => s.session?.kills ?? 0);
  const problem = useWatch((s) => s.problem);
  const toggle = useWatch((s) => s.toggle);
  const setUp = useProfiles((s) => s.file.settings.watch !== null);
  const hotkey = useProfiles((s) => s.file.settings.hotkey);
  if (!canWatch(platform)) return null;

  const onClick = () => {
    if (status === "off" && !setUp) navigate("/watch?setup=1");
    else void toggle();
  };
  const title =
    status === "off"
      ? setUp
        ? `Start analysing the game screen (${hotkey})`
        : "Set up Analyse"
      : status === "paused"
        ? `Paused: ${problem ?? ""} — click to switch off (${hotkey})`
        : `Analysing the game window — click to switch off (${hotkey})`;

  return (
    <motion.button
      type="button"
      layout
      transition={spring}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      title={title}
      aria-label={status === "off" ? "Start analysing" : "Stop analysing"}
      aria-pressed={status !== "off"}
      className={`flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold ${
        status === "on"
          ? "bg-danger text-white shadow-[0_6px_18px_-6px_var(--danger)]"
          : status === "paused"
            ? "bg-maple/90 text-white"
            : "glass text-ink"
      }`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {status === "on" ? (
          <motion.span key="on" className="flex items-center gap-2" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            Analysing{kills > 0 ? ` · ${kills.toLocaleString("en-AU")}` : ""}
          </motion.span>
        ) : status === "paused" ? (
          <motion.span key="paused" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Pause size={15} /> Paused
          </motion.span>
        ) : (
          <motion.span key="off" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Eye size={16} strokeWidth={2.2} /> Analyse
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** A big iOS-style switch for the watcher page. */
export function BigSwitch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[46px] w-[78px] shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-danger" : "bg-fill-strong"}`}
    >
      <motion.span
        layout
        transition={spring}
        className="absolute top-[3px] flex h-[40px] w-[40px] items-center justify-center rounded-full bg-white text-ink-3 shadow-[0_3px_8px_rgb(0_0_0/0.18),0_1px_1px_rgb(0_0_0/0.12)]"
        style={{ left: on ? 35 : 3 }}
      >
        {on ? <Eye size={18} className="text-danger" /> : <EyeOff size={18} />}
      </motion.span>
    </button>
  );
}

/** Minutes:seconds since `start`, ticking once a second. */
export function useElapsed(start: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start]);
  if (start === null) return "0:00";
  const s = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
