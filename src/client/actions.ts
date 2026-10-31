import { api } from "./api";
import { handleDeleted } from "./cards";
import { openDetail } from "./detail";
import { els, state, toast } from "./dom";

export async function performAction(action: string, id: string): Promise<void> {
  const job = state.jobs.get(id);
  if (!job) return;

  try {
    switch (action) {
      case "pause":
        await api(`/api/downloads/${encodeURIComponent(id)}/pause`, {
          method: "POST",
        });
        toast("Paused", job.fileName, "info");
        break;
      case "resume":
        await api(`/api/downloads/${encodeURIComponent(id)}/resume`, {
          method: "POST",
        });
        toast("Resuming", job.fileName, "success");
        break;
      case "retry":
        await api(`/api/downloads/${encodeURIComponent(id)}/retry`, {
          method: "POST",
        });
        toast("Queued for retry", job.fileName, "success");
        break;
      case "cancel": {
        const ok = await askConfirm({
          title: "Cancel this download?",
          message:
            "The partial file will be discarded. You can still retry from the same URL later.",
          confirmLabel: "Cancel download",
          danger: true,
        });
        if (!ok) return;
        await api(`/api/downloads/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
        });
        toast("Download canceled", job.fileName, "info");
        break;
      }
      case "reveal": {
        await api(`/api/downloads/${encodeURIComponent(id)}/reveal`, {
          method: "POST",
        });
        toast("Opened in your file manager", "", "success");
        break;
      }
      case "copy": {
        await navigator.clipboard.writeText(job.finalUrl ?? job.url);
        toast("Source URL copied", "", "success");
        break;
      }
      case "delete": {
        const ok = await askConfirm({
          title: "Delete this download?",
          message: `“${job.fileName}” and its partial or finished file will be removed from disk and from the library.`,
          confirmLabel: "Delete file",
          danger: true,
        });
        if (!ok) return;
        await api(`/api/downloads/${encodeURIComponent(id)}?files=true`, {
          method: "DELETE",
        });
        handleDeleted(id);
        toast("Deleted", job.fileName, "info");
        break;
      }
    }
  } catch (error) {
    toast(
      "Action failed",
      error instanceof Error ? error.message : "The engine could not complete that action.",
      "error",
    );
  }
}

export function askConfirm(options: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  if (state.confirmResolve) {
    state.confirmResolve(false);
    state.confirmResolve = null;
  }
  els.confirmTitle.textContent = options.title;
  els.confirmText.textContent = options.message;
  els.confirmYes.textContent = options.confirmLabel;
  els.confirmYes.className = options.danger ? "button danger" : "button primary";
  els.confirmDialog.returnValue = "";
  els.confirmDialog.showModal();
  return new Promise<boolean>((resolve) => {
    state.confirmResolve = resolve;
  });
}

export function handleActionClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const actionElement = target.closest<HTMLElement>("[data-action]");
  if (actionElement) {
    const action = actionElement.dataset.action;
    const id = actionElement.dataset.id;
    if (action && id) {
      event.preventDefault();
      void performAction(action, id);
    }
    return;
  }

  const card = target.closest<HTMLElement>(".download-card");
  if (card && !target.closest("a")) {
    const id = card.dataset.id;
    if (id) openDetail(id);
  }
}
