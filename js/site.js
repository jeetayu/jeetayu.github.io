/* site.js — shared utilities for Biswas Lab website */

// ── Copy to clipboard — works on HTTP, HTTPS, iOS, Android, desktop ─────────
function biswasLabCopy(text, btn) {
  function showDone() {
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(function () {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1800);
  }

  // 1. Modern API (requires HTTPS or localhost)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(showDone, tryFallback);
    return;
  }

  tryFallback();

  function tryFallback() {
    // 2. Hidden textarea + execCommand — works on HTTP, desktop + Android
    //    MUST be off-screen (not opacity:0) so browsers will let us select it.
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");          // no iOS keyboard pop-up
    ta.style.cssText = [
      "position:fixed",
      "top:-200px",
      "left:0",
      "width:300px",                          // big enough to be selectable
      "height:60px",
      "font-size:14px",                       // prevent iOS auto-zoom
      "z-index:-1",
      "opacity:0.01"                          // near-invisible but not hidden
    ].join(";");

    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // required for iOS Safari

    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);

    if (ok) {
      showDone();
    } else {
      // 3. Last resort: browser prompt so user can manually Ctrl+C
      window.prompt("Press Ctrl+C (or ⌘C) to copy:", text.slice(0, 500));
    }
  }
}

// ── Copy buttons for all <pre> and sequence span blocks ──────────────────────
(function () {
  function wrapWithCopyBtn(el, getText) {
    if (el.parentElement && el.parentElement.classList.contains("code-wrap")) return;

    var wrap = document.createElement("div");
    wrap.className = "code-wrap";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    var btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy to clipboard");
    wrap.appendChild(btn);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      biswasLabCopy(getText(el), btn);
    });
  }

  function initCopyButtons() {
    // All <pre> code blocks
    document.querySelectorAll("pre").forEach(function (pre) {
      wrapWithCopyBtn(pre, function (el) {
        return el.innerText || el.textContent;
      });
    });

    // Biological sequences in <code class="sequence"> or <span class="sequence">
    document.querySelectorAll("code.sequence, span.sequence").forEach(function (el) {
      wrapWithCopyBtn(el, function (el) {
        return (el.innerText || el.textContent).replace(/\s+/g, "");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCopyButtons);
  } else {
    initCopyButtons();
  }
})();
