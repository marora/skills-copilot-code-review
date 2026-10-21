document.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("announcements-banner");
  const manageButton = document.getElementById("manage-announcements");
  const dialog = document.getElementById("announcements-dialog");
  const list = document.getElementById("announcements-list");
  const count = document.getElementById("announcements-count");
  const feedback = document.getElementById("announcements-feedback");
  const retryButton = document.getElementById("retry-announcements");
  const form = document.getElementById("announcement-form");
  const fields = document.getElementById("announcement-fields");
  const editorTitle = document.getElementById("announcement-editor-title");
  const message = document.getElementById("announcement-message");
  const start = document.getElementById("announcement-start");
  const expiration = document.getElementById("announcement-expiration");
  const preview = document.getElementById("announcement-preview");
  const saveButton = document.getElementById("save-announcement");
  let signedIn = false;
  let editingId = null;
  let busy = false;
  let announcements = [];
  let publicAnnouncements = [];
  let publicRequest = 0;
  let managementRequest = 0;

  const today = () => new Date().toISOString().slice(0, 10);
  const statusOf = (item) => {
    if (item.expires_on < today()) return "Expired";
    if (item.starts_on && item.starts_on > today()) return "Scheduled";
    return "Active";
  };
  const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(text, type = "info") {
    feedback.textContent = text;
    feedback.className = `message ${type}`;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (response.status === 401) {
      document.dispatchEvent(new Event("session-expired"));
      throw new Error("Please sign in again to manage announcements.");
    }
    if (!response.ok) {
      if (response.status === 422) {
        throw new Error("Check the message and dates. Expiration is required and cannot be before the start.");
      }
      if (response.status === 404) {
        throw new Error("This announcement no longer exists. Reload the list to continue.");
      }
      throw new Error("Announcements are unavailable right now. Please try again.");
    }
    return response.status === 204 ? null : response.json();
  }

  function renderBanner() {
    banner.replaceChildren();
    const active = publicAnnouncements.filter((item) => statusOf(item) === "Active");
    banner.classList.toggle("hidden", active.length === 0);
    active.forEach((item) => {
      const notice = element("div", "announcement-banner");
      notice.append(element("span", "announcement-banner-label", "School announcement"));
      notice.append(element("p", "", item.message));
      banner.append(notice);
    });
  }

  async function loadPublicAnnouncements() {
    const version = ++publicRequest;
    // Remove expired messages even if a refresh cannot reach the server.
    renderBanner();
    try {
      const items = await request("/announcements");
      if (version !== publicRequest) return;
      publicAnnouncements = items;
      renderBanner();
    } catch (error) {
      if (version !== publicRequest) return;
      console.error("Could not load school announcements:", error);
      banner.classList.remove("hidden");
      const notice = element("div", "announcement-load-error");
      notice.append(element("span", "", "School announcements could not be refreshed. "));
      const retry = element("button", "quiet-button", "Retry");
      retry.type = "button";
      retry.addEventListener("click", loadPublicAnnouncements);
      notice.append(retry);
      banner.append(notice);
    }
  }

  function updatePreview() {
    const invalidOrder = start.value && expiration.value && start.value > expiration.value;
    expiration.setCustomValidity(invalidOrder ? "Expiration must be on or after the start date." : "");
    message.setCustomValidity(message.value && !message.value.trim() ? "Enter a message, not only spaces." : "");
    const status = expiration.value ? statusOf({
      starts_on: start.value, expires_on: expiration.value,
    }) : null;
    preview.textContent = !status
      ? "Choose an expiration date to set your publishing schedule."
      : invalidOrder
        ? "Expiration must be on or after the start date."
        : status === "Expired"
          ? "This announcement is expired and will not appear on the noticeboard."
          : status === "Scheduled"
            ? `Scheduled to appear on ${formatDate(start.value)}.`
            : "This announcement will be visible immediately.";
    if (!editingId) saveButton.textContent = status === "Scheduled" ? "Schedule announcement" : "Publish announcement";
  }

  function resetEditor(focus = false) {
    editingId = null;
    form.reset();
    editorTitle.textContent = "New announcement";
    saveButton.textContent = "Publish announcement";
    updatePreview();
    if (focus) message.focus();
  }

  function setBusy(value) {
    busy = value;
    fields.disabled = value;
    dialog.setAttribute("aria-busy", String(value));
    dialog.querySelectorAll(".announcements-library button, #close-announcements").forEach((button) => {
      button.disabled = value;
    });
  }

  function renderList() {
    list.replaceChildren();
    count.textContent = `(${announcements.length})`;
    if (!announcements.length) {
      const empty = element("div", "announcements-empty");
      empty.append(element("h4", "", "A fresh noticeboard"));
      empty.append(element("p", "", "No announcements yet. Write your first message using the form."));
      list.append(empty);
      return;
    }
    announcements.forEach((item) => {
      const card = element("article", "announcement-card");
      const status = statusOf(item);
      card.append(element("span", `announcement-status status-${status.toLowerCase()}`, status));
      card.append(element("p", "announcement-card-message", item.message));
      card.append(element("p", "announcement-dates",
        `${item.starts_on ? `Starts ${formatDate(item.starts_on)}` : "Starts immediately"} | Expires ${formatDate(item.expires_on)}`));
      const actions = element("div", "announcement-card-actions");
      const edit = element("button", "quiet-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editingId = item.id;
        message.value = item.message;
        start.value = item.starts_on || "";
        expiration.value = item.expires_on;
        editorTitle.textContent = "Edit announcement";
        saveButton.textContent = "Save changes";
        updatePreview();
        message.focus();
      });
      const remove = element("button", "danger-button", "Delete");
      remove.type = "button";
      const confirmation = element("div", "announcement-delete-confirmation hidden");
      confirmation.setAttribute("role", "group");
      confirmation.setAttribute("aria-label", "Confirm announcement deletion");
      confirmation.append(element("p", "", "Delete this announcement? This cannot be undone."));
      const confirm = element("button", "danger-button", "Yes, delete");
      confirm.type = "button";
      const cancel = element("button", "quiet-button", "Keep it");
      cancel.type = "button";
      remove.addEventListener("click", () => {
        confirmation.classList.remove("hidden");
        remove.classList.add("hidden");
        cancel.focus();
      });
      cancel.addEventListener("click", () => {
        confirmation.classList.add("hidden");
        remove.classList.remove("hidden");
        remove.focus();
      });
      confirm.addEventListener("click", async () => {
        setBusy(true);
        let deleted = false;
        try {
          await request(`/announcements/${encodeURIComponent(item.id)}`, { method: "DELETE" });
          deleted = true;
          if (editingId === item.id) resetEditor();
          notify("Announcement deleted.", "success");
          await Promise.all([loadList(), loadPublicAnnouncements()]);
        } catch (error) {
          console.error("Could not delete announcement:", error);
          notify(error.message, "error");
          retryButton.classList.remove("hidden");
        } finally {
          setBusy(false);
          if (deleted && dialog.open) document.getElementById("new-announcement").focus();
        }
      });
      confirmation.append(confirm, cancel);
      actions.append(edit, remove);
      card.append(actions, confirmation);
      list.append(card);
    });
    setBusy(busy);
  }

  async function loadList() {
    const version = ++managementRequest;
    retryButton.classList.add("hidden");
    list.setAttribute("aria-busy", "true");
    try {
      const items = await request("/announcements/manage");
      if (!signedIn || !dialog.open || version !== managementRequest) return;
      announcements = items;
      renderList();
    } catch (error) {
      if (!signedIn || !dialog.open || version !== managementRequest) return;
      console.error("Could not load announcement management:", error);
      notify(error.message, "error");
      retryButton.classList.remove("hidden");
    } finally {
      if (version === managementRequest) list.setAttribute("aria-busy", "false");
    }
  }

  form.addEventListener("input", updatePreview);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    updatePreview();
    if (busy || !form.reportValidity()) return;
    setBusy(true);
    saveButton.textContent = "Saving...";
    const wasEditing = Boolean(editingId);
    try {
      await request(editingId ? `/announcements/${encodeURIComponent(editingId)}` : "/announcements", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.value.trim(),
          starts_on: start.value || null,
          expires_on: expiration.value,
        }),
      });
      resetEditor();
      notify(wasEditing ? "Changes saved." : "Announcement created.", "success");
      await Promise.all([loadList(), loadPublicAnnouncements()]);
    } catch (error) {
      console.error("Could not save announcement:", error);
      notify(error.message, "error");
      retryButton.classList.remove("hidden");
    } finally {
      setBusy(false);
      saveButton.textContent = editingId ? "Save changes" : "Publish announcement";
      updatePreview();
    }
  });

  document.addEventListener("auth-changed", (event) => {
    signedIn = event.detail.signedIn;
    manageButton.classList.toggle("hidden", !signedIn);
    if (!signedIn) {
      dialog.close();
      announcements = [];
      list.replaceChildren();
      resetEditor();
      ++managementRequest;
    }
  });
  manageButton.addEventListener("click", () => {
    if (!signedIn) return;
    feedback.className = "hidden message";
    list.textContent = "Loading announcements...";
    count.textContent = "";
    resetEditor();
    dialog.showModal();
    loadList();
  });
  document.getElementById("close-announcements").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    ++managementRequest;
    resetEditor();
    if (signedIn) manageButton.focus();
  });
  document.getElementById("new-announcement").addEventListener("click", () => resetEditor(true));
  document.getElementById("reset-announcement").addEventListener("click", () => resetEditor(true));
  retryButton.addEventListener("click", () => {
    feedback.className = "hidden message";
    loadList();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadPublicAnnouncements();
  });
  setInterval(loadPublicAnnouncements, 60000);
  loadPublicAnnouncements();
});
