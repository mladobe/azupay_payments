let sequence = 0;

export function openHostedCheckout({
  checkoutUrl,
  checkPayment,
  location = window.location,
  host = window,
  doc = document,
  focusTarget,
}) {
  const fullPage = new URL(checkoutUrl);
  if (fullPage.protocol !== "https:" || fullPage.username || fullPage.password)
    throw new Error("The saved bank checkout URL is invalid.");
  fullPage.searchParams.delete("type");
  const embedded = new URL(fullPage);
  embedded.searchParams.set("type", "iframe");
  // Keep the host checkout out of the iframe, including after payment.
  embedded.searchParams.delete("redirectURL");
  embedded.searchParams.delete("cancelRedirectURL");
  const dialog = doc.createElement("dialog");
  const canEmbed = typeof dialog.showModal === "function";
  const heading = doc.createElement("h2");
  heading.id = `azupay-modal-${++sequence}`;
  heading.textContent = "Pay securely with Azupay";
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.className = "azupay-checkout-modal";
  Object.assign(dialog.style, {
    width: "min(900px, calc(100vw - 32px))",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100dvh - 32px)",
    boxSizing: "border-box",
    padding: "16px",
    border: "1px solid #777",
    borderRadius: "8px",
    overflow: "auto",
  });
  const message = doc.createElement("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.textContent =
    "Complete your bank payment below. Closing this window does not cancel it. If you've already paid, do not pay again.";
  const frame = doc.createElement("iframe");
  frame.title = "Azupay secure bank payment";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute(
    "allow",
    "publickey-credentials-get 'src'; publickey-credentials-create 'src'; clipboard-write 'src'",
  );
  Object.assign(frame.style, {
    width: "100%",
    height: "min(65dvh, 700px)",
    border: "0",
  });
  const controls = doc.createElement("div");
  Object.assign(controls.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "12px",
  });
  const close = doc.createElement("button");
  close.type = "button";
  close.autofocus = true;
  close.textContent = "Close payment window";
  const check = doc.createElement("button");
  check.type = "button";
  check.textContent = "Check payment";
  const redirect = doc.createElement("button");
  redirect.type = "button";
  redirect.textContent = "Continue in full page";
  controls.append(close, check, redirect);
  dialog.append(heading, message, controls, frame);
  const previousFocus = focusTarget ?? doc.activeElement;
  const previousOverflow = doc.body.style.overflow;

  return new Promise((resolve, reject) => {
    let finished = false;
    let checking = false;
    let timer;
    let checks = 0;
    let lastCheck = 0;
    function finish(result, error) {
      if (finished) return;
      finished = true;
      host.clearTimeout(timer);
      host.removeEventListener("message", onMessage);
      doc.removeEventListener("securitypolicyviolation", onPolicyViolation);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      dialog.remove();
      doc.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        // Native checkout re-enables its submit button after this promise resolves.
        if (previousFocus.disabled)
          host.setTimeout(() => {
            if (previousFocus.isConnected && doc.activeElement === doc.body)
              previousFocus.focus();
          }, 0);
        else previousFocus.focus();
      }
      if (error) reject(error);
      else resolve(result);
    }
    function unavailable() {
      console.error("[azupay] CHECKOUT_FRAME_UNAVAILABLE");
      message.setAttribute("role", "alert");
      message.textContent =
        "If bank checkout is blocked or not working, select Continue in full page to open this same payment. Do not start another payment.";
    }
    function onPolicyViolation(event) {
      if (
        ["frame-src", "child-src"].includes(event.effectiveDirective) &&
        event.blockedURI?.startsWith(embedded.origin)
      )
        unavailable();
    }
    function schedule() {
      if (!finished && checks < 60)
        timer = host.setTimeout(() => void verify(), 5000);
    }
    async function verify() {
      if (finished || checking) return;
      checking = true;
      check.disabled = true;
      lastCheck = Date.now();
      host.clearTimeout(timer);
      checks += 1;
      try {
        const paid = await checkPayment();
        if (finished) return;
        if (paid) {
          finish({ paid: true, redirected: false });
          return;
        }
        message.setAttribute("role", "status");
        message.textContent =
          "Your bank payment has not been confirmed yet. If you've paid, wait and check again; do not pay again.";
        if (checks >= 60)
          message.textContent +=
            " Automatic checks have paused. Select Check payment when ready.";
        schedule();
      } catch {
        if (finished) return;
        console.error("[azupay] CHECKOUT_PAYMENT_CHECK_FAILED");
        message.setAttribute("role", "alert");
        message.textContent =
          "Payment verification is unavailable. Select Check payment to retry, or close this window and check from checkout. If you've paid, do not pay again.";
      } finally {
        checking = false;
        check.disabled = false;
      }
    }
    function onMessage(event) {
      if (
        event.origin === embedded.origin &&
        event.source === frame.contentWindow &&
        event.data?.EventType === "PaymentRequest" &&
        Date.now() - lastCheck >= 2000
      )
        // Provider messages only request an authenticated server status check.
        void verify();
    }
    function onClose() {
      finish({ paid: false, redirected: false });
    }
    close.addEventListener("click", onClose);
    check.addEventListener("click", () => void verify());
    redirect.addEventListener("click", () => {
      try {
        location.assign(fullPage.href);
        finish({ paid: false, redirected: true });
      } catch (error) {
        finish(null, error);
      }
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      onClose();
    });
    dialog.addEventListener("close", onClose);
    frame.addEventListener("error", unavailable);
    try {
      doc.body.append(dialog);
      if (canEmbed) {
        dialog.showModal();
        doc.body.style.overflow = "hidden";
        host.addEventListener("message", onMessage);
        frame.src = embedded.href;
      } else {
        dialog.setAttribute("open", "");
        dialog.setAttribute("role", "dialog");
        dialog.style.display = "block";
        frame.hidden = true;
        message.setAttribute("role", "alert");
        message.textContent =
          "Your browser cannot open an embedded payment window. Select Continue in full page to open the same saved payment.";
        redirect.focus();
      }
      doc.addEventListener("securitypolicyviolation", onPolicyViolation);
      schedule();
    } catch (error) {
      finish(null, error);
    }
  });
}
