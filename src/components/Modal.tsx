"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";

const ModalContext = createContext<() => void>(() => {});
export const useCloseModal = () => useContext(ModalContext);

export default function Modal({
  trigger,
  title,
  children,
  triggerClassName = "btn-primary",
  wide = false,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  triggerClassName?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={close}>
          <div
            className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{title}</h2>
              <button type="button" onClick={close} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <ModalContext.Provider value={close}>{children}</ModalContext.Provider>
          </div>
        </div>
      )}
    </>
  );
}
