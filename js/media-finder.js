/* media-finder.js — searchable cell culture media reference.
   Data: /data/cell-media.json (ATCC + DSMZ product pages, plus lab-specific notes).
   All dynamic text is inserted with textContent (data originates from third-party sites). */
(function () {
  "use strict";
  var root = document.getElementById("media-finder");
  if (!root) return;

  var DATA = null, byId = {}, index = [];
  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  // ── UI skeleton ───────────────────────────────────────────────────────────
  var input = el("input", { type: "text", id: "mf-input", placeholder: "Type a cell line (e.g. HEK293T, K562, MCF7, MV-4-11, Jurkat)…",
    autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "mf-list", "aria-label": "Cell line" });
  var list = el("ul", { id: "mf-list", class: "mf-suggest", role: "listbox", hidden: "" });
  var select = el("select", { "aria-label": "Browse all cell lines" });
  var chips = el("div", { class: "mf-chips", role: "group", "aria-label": "Filter by base medium" });
  var out = el("div", { "aria-live": "polite" });
  var labBox = el("div", {});
  root.appendChild(el("div", { class: "mf-search" }, [input, select, list]));
  root.appendChild(el("div", { class: "mf-hint", text: "Search by name or common alias, pick from the dropdown, or filter by base medium below." }));
  root.appendChild(chips);
  root.appendChild(out);
  root.appendChild(labBox);

  // ── data load ─────────────────────────────────────────────────────────────
  fetch("/data/cell-media.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { DATA = d; init(); })
    .catch(function (e) { out.appendChild(el("p", { class: "mf-hint", text: "Could not load media data (" + e.message + "). Serve the site over http(s); file:// blocks fetch()." })); });

  function init() {
    DATA.cell_lines.forEach(function (c) {
      byId[c.id] = c;
      var keys = [c.name].concat(c.aliases || []).concat(c.sources.map(function (s) { return s.id; }));
      index.push({ c: c, keys: keys.map(norm) });
    });
    select.appendChild(el("option", { value: "", text: "Browse all (" + DATA.n + ")…" }));
    DATA.cell_lines.forEach(function (c) { select.appendChild(el("option", { value: c.id, text: c.name })); });
    select.addEventListener("change", function () { if (select.value) show(select.value); });

    var counts = {};
    DATA.cell_lines.forEach(function (c) { var seen = {}; c.sources.forEach(function (s) { if (!seen[s.base]) { seen[s.base] = 1; counts[s.base] = (counts[s.base] || 0) + 1; } }); });
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (b) {
      var chip = el("button", { type: "button", class: "mf-chip", "aria-pressed": "false", text: b + " (" + counts[b] + ")" });
      chip.addEventListener("click", function () { filterBase(b, chip); });
      chips.appendChild(chip);
    });
    renderLabTable();
    if (location.hash.length > 1) { var h = norm(decodeURIComponent(location.hash.slice(1))); var m = search(h)[0]; if (m) show(m.c.id); }
  }

  // ── search ────────────────────────────────────────────────────────────────
  function search(q) {
    q = norm(q); if (!q) return [];
    var scored = [];
    index.forEach(function (it) {
      var best = 99;
      it.keys.forEach(function (k) {
        if (k === q) best = Math.min(best, 0);
        else if (k.indexOf(q) === 0) best = Math.min(best, 1);
        else if (k.indexOf(q) > -1) best = Math.min(best, 2);
      });
      if (best < 99) scored.push({ c: it.c, s: best });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.c.name.localeCompare(b.c.name); });
    return scored;
  }

  var active = -1, shown = [];
  function openList(items) {
    shown = items.slice(0, 10); active = -1; list.textContent = "";
    shown.forEach(function (it, i) {
      var li = el("li", { role: "option", id: "mf-opt-" + i }, [el("span", { text: it.c.name }),
        el("small", { text: [it.c.species, it.c.disease].filter(Boolean).join(" · ").slice(0, 48) })]);
      li.addEventListener("mousedown", function (e) { e.preventDefault(); pick(it.c); });
      list.appendChild(li);
    });
    if (!shown.length && input.value.trim()) list.appendChild(el("li", { text: "No match — try another spelling or alias" }));
    var open = shown.length || input.value.trim();
    if (open) list.removeAttribute("hidden"); else list.setAttribute("hidden", "");
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeList() { list.setAttribute("hidden", ""); input.setAttribute("aria-expanded", "false"); }
  function pick(c) { input.value = c.name; closeList(); show(c.id); }
  input.addEventListener("input", function () { if (DATA) openList(search(input.value)); });
  input.addEventListener("blur", closeList);
  input.addEventListener("keydown", function (e) {
    var opts = list.querySelectorAll("li[role=option]");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!opts.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach(function (o, i) { o.setAttribute("aria-selected", i === active ? "true" : "false"); });
      input.setAttribute("aria-activedescendant", "mf-opt-" + active);
    } else if (e.key === "Enter") {
      e.preventDefault();
      var t = active >= 0 ? shown[active] : (shown[0] || search(input.value)[0]);
      if (t) pick(t.c);
    } else if (e.key === "Escape") closeList();
  });

  // ── results ───────────────────────────────────────────────────────────────
  function row(dl, k, v) { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: v })); } }

  function sourceBlock(c, s) {
    var b = el("section", { class: "mf-src" });
    b.appendChild(el("h4", { text: s.provider + " · " + s.id }));
    var top = el("div", {}, [el("span", { class: "mf-medium", text: s.base + (s.serum ? " + " + s.serum : "") })]);
    b.appendChild(top);
    var tags = el("div", { style: "margin-top:.3rem" });
    if (c.lab && c.lab.lab_base) {
      var same = c.lab.lab_base === s.base;
      tags.appendChild(el("span", { class: "mf-tag " + (same ? "ok" : "warn"),
        text: same ? "✓ same base medium as our protocol" : "⚠ differs from our protocol (" + c.lab.lab_base + ")" }));
    }
    if (s.growth) tags.appendChild(el("span", { class: "mf-tag", text: s.growth }));
    b.appendChild(tags);
    var dl = el("dl", { class: "mf-dl" });
    row(dl, "Full recipe", s.medium);
    row(dl, "Conditions", s.conditions);
    row(dl, "Subculture", s.subculture);
    row(dl, "Medium renewal", s.renewal);
    row(dl, "Freezing", s.freeze);
    b.appendChild(dl);
    var actions = el("div", { class: "mf-actions" });
    var copy = el("button", { type: "button", text: "Copy recipe" });
    copy.addEventListener("click", function () {
      var txt = c.name + " — " + s.provider + " " + s.id + ": " + s.medium;
      if (window.biswasLabCopy) window.biswasLabCopy(txt, copy); else if (navigator.clipboard) navigator.clipboard.writeText(txt);
    });
    var a = el("a", { href: s.url, target: "_blank", rel: "noopener", text: "View on " + s.provider + " ↗" });
    actions.appendChild(copy); actions.appendChild(a);
    b.appendChild(actions);
    return b;
  }

  function show(id) {
    var c = byId[id]; if (!c) return;
    out.textContent = ""; history.replaceState(null, "", "#" + encodeURIComponent(c.name));
    var card = el("article", { class: "mf-result" });
    var h = el("header", {}, [el("h3", { text: c.name }),
      el("div", { class: "mf-meta", text: [c.aliases && c.aliases.length ? "also: " + c.aliases.join(", ") : "", c.species, c.tissue, c.disease, c.morphology, c.growth].filter(Boolean).join(" · ") })]);
    card.appendChild(h);
    if (c.lab) {
      var lb = el("section", { class: "mf-src mf-lab" }, [el("h4", { text: "In our lab" }),
        el("div", { class: "mf-medium", text: c.lab.lab_medium || "No medium recorded yet" })]);
      if (c.lab.note) lb.appendChild(el("div", { class: "mf-hint", text: c.lab.note }));
      card.appendChild(lb);
    }
    if (c.sources.length > 1) {
      var bases = {}; c.sources.forEach(function (s) { bases[s.base] = 1; });
      if (Object.keys(bases).length > 1) card.appendChild(el("section", { class: "mf-src" }, [el("span", { class: "mf-tag warn", text: "Providers disagree" }),
        el("span", { class: "mf-hint", text: " " + c.sources.map(function (s) { return s.provider + ": " + s.base; }).join("  vs  ") + ". Both work in practice for many lines; follow the provider you purchased from." })]));
    }
    if (!c.sources.length) card.appendChild(el("section", { class: "mf-src" }, [el("span", { class: "mf-hint", text: "No public vendor datasheet — this is a lab-specific protocol." })]));
    c.sources.forEach(function (s) { card.appendChild(sourceBlock(c, s)); });
    out.appendChild(card);
    out.appendChild(el("p", { class: "mf-foot", text: "Recommendations come from the ATCC and DSMZ product pages (retrieved " + DATA.generated + "). Always check the datasheet for your specific lot; add antibiotics, supplements and passage limits per your lab protocol." }));
    window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
  }

  function filterBase(b, chip) {
    var was = chip.getAttribute("aria-pressed") === "true";
    chips.querySelectorAll(".mf-chip").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
    out.textContent = ""; if (was) return;
    chip.setAttribute("aria-pressed", "true");
    var hits = DATA.cell_lines.filter(function (c) { return c.sources.some(function (s) { return s.base === b; }); });
    var wrap = el("div", { class: "mf-result" }, [el("header", {}, [el("h3", { text: b + " — " + hits.length + " cell lines" })])]);
    var body = el("div", { class: "mf-src" });
    hits.forEach(function (c) {
      var a = el("a", { href: "#" + encodeURIComponent(c.name), class: "mf-tag", text: c.name });
      a.addEventListener("click", function (e) { e.preventDefault(); chip.setAttribute("aria-pressed", "false"); show(c.id); });
      body.appendChild(a);
    });
    wrap.appendChild(body); out.appendChild(wrap);
  }

  function renderLabTable() {
    var rows = DATA.cell_lines.filter(function (c) { return c.lab; });
    var d = el("details", { class: "mf-result", open: "" }, [el("summary", { class: "mf-src", style: "cursor:pointer;font-weight:600", text: "Our lab's cell lines vs. public recommendations (" + rows.length + ")" })]);
    var t = el("table", { class: "mf-labtable" }, [el("tr", {}, ["Cell line", "Our protocol", "ATCC / DSMZ recommendation", "Notes"].map(function (x) { return el("th", { text: x }); }))]);
    rows.forEach(function (c) {
      var rec = c.sources.length ? c.sources.map(function (s) { return s.provider + ": " + s.base + (s.serum ? " + " + s.serum : ""); }).join("; ") : "—";
      var diff = c.lab.lab_base && c.sources.length && c.sources.every(function (s) { return s.base !== c.lab.lab_base; });
      var a = el("a", { href: "#" + encodeURIComponent(c.name), text: c.name });
      a.addEventListener("click", function (e) { e.preventDefault(); show(c.id); });
      var tr = el("tr", {}, [el("td", {}, [a]), el("td", { text: c.lab.lab_medium || "— (not recorded)" }),
        el("td", {}, [diff ? el("span", { class: "mf-tag warn", text: "differs" }) : null, document.createTextNode(" " + rec)]),
        el("td", { text: c.lab.note })]);
      t.appendChild(tr);
    });
    d.appendChild(el("div", { class: "mf-src" }, [t]));
    labBox.appendChild(d);
  }
})();
