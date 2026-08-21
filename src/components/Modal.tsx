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
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{title}</h2>
              <button type="button" onClick={close} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
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
