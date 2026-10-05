import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertDialog as AD, Dialog as D } from "radix-ui";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { create } from "zustand";
import { Button, spring } from "./kit";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="scrim fixed inset-0 z-40 bg-black/25 backdrop-blur-[3px]" />
        <D.Content
          className={`sheet glass-strong fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[30px] p-7 ${
            wide ? "max-w-3xl" : "max-w-lg"
          }`}
        >
          <D.Title className="pr-10 font-display text-[24px] font-bold tracking-[-0.02em]">{title}</D.Title>
          {description ? (
            <D.Description className="mt-1 text-sm text-ink-2">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          <div className="mt-5">{children}</div>
          <D.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-fill text-ink-2 transition hover:bg-fill-strong hover:text-ink"
            >
              <X size={16} strokeWidth={2.6} />
            </button>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** iOS-style alert: centred title + message, full-width buttons. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="scrim fixed inset-0 z-40 bg-black/25 backdrop-blur-[3px]" />
        <AD.Content className="sheet glass-strong fixed left-1/2 top-1/2 z-50 w-[88vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 text-center">
          <AD.Title className="font-display text-[19px] font-bold">{title}</AD.Title>
          <AD.Description asChild>
            <div className="mt-2 text-sm text-ink-2">{body}</div>
          </AD.Description>
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <AD.Cancel asChild>
              <Button size="lg" className="w-full">
                Cancel
              </Button>
            </AD.Cancel>
            <AD.Action asChild>
              <Button size="lg" variant={danger ? "danger" : "primary"} className="w-full" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

// ---- Toasts, shown as a "Dynamic Island" pill at the top ----

export type Toast = {
  id: number;
  message: string;
  tone?: "info" | "error";
  action?: { label: string; onClick: () => void };
  durationMs: number;
  onExpire?: () => void;
};

type ToastState = {
  toasts: Toast[];
  push(t: Omit<Toast, "id" | "durationMs"> & { durationMs?: number }): number;
  dismiss(id: number, expired?: boolean): void;
};

let nextToastId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(t) {
    const id = nextToastId++;
    set({ toasts: [...get().toasts, { durationMs: 5000, ...t, id }] });
    return id;
  },
  dismiss(id, expired = false) {
    const t = get().toasts.find((x) => x.id === id);
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
    if (expired) t?.onExpire?.();
  },
}));

export const toast = (t: Parameters<ToastState["push"]>[0]) => useToasts.getState().push(t);

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id, true), t.durationMs);
    return () => clearTimeout(timer);
  }, [t.id, t.durationMs, dismiss]);
  const Icon = t.tone === "error" ? CircleAlert : CircleCheck;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24, scaleX: 0.5, scaleY: 0.7 }}
      animate={{ opacity: 1, y: 0, scaleX: 1, scaleY: 1 }}
      exit={{ opacity: 0, y: -16, scaleX: 0.6, scaleY: 0.6 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      role={t.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex max-w-[640px] items-center gap-3 rounded-full bg-[#0b0b0d] py-2 pl-3 pr-2 text-[14px] text-white shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)]"
    >
      <Icon size={20} className={t.tone === "error" ? "shrink-0 text-[#ff6b61]" : "shrink-0 text-[#4cd964]"} />
      <span className="min-w-0 truncate font-medium">{t.message}</span>
      {t.action && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={spring}
          className="shrink-0 rounded-full bg-white/15 px-3 py-1 font-semibold text-[#ffb27a] hover:bg-white/25"
          onClick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </motion.button>
      )}
      <button type="button" aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-white/60 hover:text-white" onClick={() => dismiss(t.id, true)}>
        <X size={16} />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
