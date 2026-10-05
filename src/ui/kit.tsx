import { useId, useState, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { Accordion as A } from "radix-ui";
import { ChevronDown, Minus, Plus } from "lucide-react";

// "Maple Glass" kit: iOS-style controls with springy, tactile feedback.

export const spring = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 } as const;

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "tinted";
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
};

const LOOK = {
  primary:
    "text-white bg-[linear-gradient(180deg,var(--maple-hi),var(--maple)_55%,var(--maple-deep))] shadow-[0_10px_24px_-10px_rgb(255_90_30/0.75),inset_0_1px_0_rgb(255_255_255/0.5),inset_0_-1px_0_rgb(0_0_0/0.12)] hover:brightness-[1.06]",
  secondary:
    "glass text-ink hover:bg-white/75 dark:hover:bg-white/15",
  tinted: "bg-maple/14 text-maple-deep dark:text-maple-hi hover:bg-maple/20",
  ghost: "text-maple-deep dark:text-maple-hi hover:bg-fill",
  danger:
    "text-white bg-[linear-gradient(180deg,#ff6259,var(--danger))] shadow-[0_10px_24px_-10px_rgb(255_59_48/0.7),inset_0_1px_0_rgb(255_255_255/0.4)]",
} as const;

const SIZE = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-5 text-[15px]", lg: "h-12 px-7 text-base" } as const;

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.94, y: 0 }}
      transition={spring}
      className={`inline-flex select-none items-center justify-center gap-1.5 rounded-full font-semibold tracking-[-0.01em] transition-[filter,background-color] disabled:pointer-events-none disabled:opacity-45 ${LOOK[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
}

export function IconButton({ label, className = "", ...rest }: Omit<ButtonProps, "variant" | "size"> & { label: string }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.88 }}
      transition={spring}
      className={`glass inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:text-ink ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-[26px] p-5 ${className}`}>{children}</div>;
}

export function LargeTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-1">
      <h1 className="font-display text-[34px] font-bold leading-tight tracking-[-0.025em]">{children}</h1>
      {sub && <p className="mt-0.5 text-[15px] text-ink-2">{sub}</p>}
    </div>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "maple" | "leaf" | "sky" }) {
  const t = {
    neutral: "bg-fill text-ink-2",
    maple: "bg-maple/14 text-maple-deep dark:text-maple-hi",
    leaf: "bg-leaf/14 text-leaf",
    sky: "bg-sky/14 text-sky",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Field({
  label,
  hint,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  warning?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block pl-1 text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="pl-1 text-xs text-ink-3">{hint}</p>}
      {warning && (
        <p role="status" className="pl-1 text-xs font-medium text-maple-deep dark:text-maple-hi">
          {warning}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-hairline bg-field px-3.5 py-2.5 text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] outline-none transition placeholder:text-ink-3 focus:border-maple/60 focus:ring-4 focus:ring-maple/15";

/** Integer input where empty means "not set" (`undefined`). */
export function NumberInput({
  id,
  value,
  onChange,
  min = 0,
  max,
  placeholder,
}: {
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max: number;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      className={`${inputClass} tabular-nums`}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        if (raw === "") return onChange(undefined);
        const n = Math.round(Number(raw));
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
    />
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.82 }}
      transition={spring}
      className="flex h-9 w-10 items-center justify-center text-ink hover:bg-fill disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}

/** iOS-style stepper with an editable value in the middle. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="glass inline-flex items-center overflow-hidden rounded-full" role="group" aria-label={label}>
      <StepButton label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={16} strokeWidth={2.6} />
      </StepButton>
      <input
        type="number"
        aria-label={label}
        className="h-9 w-12 border-x border-hairline bg-transparent text-center font-semibold tabular-nums outline-none"
        value={draft ?? String(value)}
        min={min}
        max={max}
        onChange={(e) => {
          // Keep what's typed (even empty) until blur, so clearing and retyping works.
          const raw = e.currentTarget.value;
          setDraft(raw);
          const n = Math.round(Number(raw));
          if (raw !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => setDraft(null)}
      />
      <StepButton label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={16} strokeWidth={2.6} />
      </StepButton>
    </div>
  );
}

/** iOS switch. */
export function Toggle({ label, checked, onChange, detail }: { label: string; checked: boolean; onChange: (v: boolean) => void; detail?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span>
        <span className="block text-[15px]">{label}</span>
        {detail && <span className="block text-xs text-ink-3">{detail}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-leaf" : "bg-fill-strong"}`}
      >
        <motion.span
          layout
          transition={spring}
          className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.18),0_1px_1px_rgb(0_0_0/0.12)]"
          style={{ left: checked ? 22 : 2 }}
        />
      </button>
    </label>
  );
}

/** Collapsed-by-default sections (plan D-9). */
export function Sections({ children, defaultOpen = [] }: { children: ReactNode; defaultOpen?: string[] }) {
  return (
    <A.Root type="multiple" defaultValue={defaultOpen} className="space-y-3">
      {children}
    </A.Root>
  );
}

export function Section({ value, title, summary, children }: { value: string; title: string; summary?: string; children: ReactNode }) {
  return (
    <A.Item value={value} className="glass overflow-hidden rounded-[24px]">
      <A.Header>
        <A.Trigger className="group flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-white/25 dark:hover:bg-white/5">
          <span className="min-w-0">
            <span className="font-display text-[17px] font-semibold tracking-[-0.01em]">{title}</span>
            {summary && <span className="ml-2 text-[13px] text-ink-3">{summary}</span>}
          </span>
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-fill text-ink-2 transition-transform duration-300 group-data-[state=open]:rotate-180">
            <ChevronDown size={16} strokeWidth={2.5} />
          </span>
        </A.Trigger>
      </A.Header>
      <A.Content className="acc-content">
        <div className="border-t border-hairline px-5 py-5">{children}</div>
      </A.Content>
    </A.Item>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-hairline bg-white/20 p-8 text-center dark:bg-white/[0.03]">
      {icon && <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-fill text-ink-2">{icon}</div>}
      <p className="font-semibold text-ink-2">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

/** iOS segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; ariaLabel?: string }[];
  onChange: (v: T) => void;
  size?: "md" | "lg";
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-full bg-fill p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel ?? (typeof o.label === "string" ? o.label : undefined)}
            onClick={() => onChange(o.value)}
            className={`relative rounded-full font-semibold transition-colors ${size === "lg" ? "px-5 py-2 text-[15px]" : "px-3.5 py-1.5 text-[13px]"} ${
              on ? "text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${group}`}
                transition={spring}
                className="absolute inset-0 rounded-full bg-[var(--thumb)] shadow-[0_3px_10px_-2px_rgb(0_0_0/0.14),0_0_0_0.5px_rgb(0_0_0/0.04)]"
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
