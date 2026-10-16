import { create } from 'zustand';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface DialogStore {
  confirmRequest: ConfirmRequest | null;
  modal: 'projects' | 'help' | 'pdfPage' | 'product' | 'model' | 'bugReport' | 'versions' | null;
  modalData: unknown;
  openModal: (m: DialogStore['modal'], data?: unknown) => void;
  closeModal: () => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  confirmRequest: null,
  modal: null,
  modalData: null,
  openModal: (modal, modalData = null) => set({ modal, modalData }),
  closeModal: () => set({ modal: null, modalData: null }),
}));

/** Promise-based confirmation dialog for destructive actions. */
export function confirmDialog(message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.setState({
      confirmRequest: {
        title: opts.title ?? 'Bitte bestätigen',
        message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: opts.danger ?? false,
        resolve: (ok) => {
          useDialogStore.setState({ confirmRequest: null });
          resolve(ok);
        },
      },
    });
  });
}
