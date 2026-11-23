/* media-finder.js — searchable cell culture media reference (v2, large catalogue).
   Data: /data/index.json (search index), /data/shards/s_<x>.json (details, loaded on demand), /data/lab.json (lab protocols).
   Sources: ATCC, DSMZ, JCRB, ECACC, Coriell product pages + literature; identity data from Cellosaurus (CC BY 4.0).
   All dynamic text is inserted with textContent (data originates from third-party sites). */
(function () {
  "use strict";
  var root = document.getElementById("media-finder");
  if (!root) return;

  var INDEX = null, LAB = {}, byId = {}, entries = [], shardCache = {};
  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var PAGE = 150;

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
  var input = el("input", { type: "text", id: "mf-input", placeholder: "Type a cell line (e.g. HEK293T, K562, MCF7, HeLa, Jurkat, NIH/3T3)…",
    autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "mf-list", "aria-label": "Cell line" });
  var list = el("ul", { id: "mf-list", class: "mf-suggest", role: "listbox", hidden: "" });
  var speciesSel = el("select", { "aria-label": "Filter by species" });
  var growthSel = el("select", { "aria-label": "Filter by growth mode" });
  var chips = el("div", { class: "mf-chips", role: "group", "aria-label": "Filter by base medium" });
  var browse = el("div", {});
  var out = el("div", { "aria-live": "polite" });
  var labBox = el("div", {});
  var activeBase = "";
  root.appendChild(el("div", { class: "mf-search" }, [input, speciesSel, growthSel, list]));
  root.appendChild(el("div", { class: "mf-hint", id: "mf-count", text: "Loading cell line index…" }));
  root.appendChild(chips);
  root.appendChild(browse);
  root.appendChild(out);
  root.appendChild(labBox);

  // ── data load ─────────────────────────────────────────────────────────────
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); }
  Promise.all([getJSON("/data/index.json"), getJSON("/data/lab.json").catch(function () { return { lab: {} }; })])
    .then(function (res) { INDEX = res[0]; LAB = res[1].lab || {}; init(); })
    .catch(function (e) { out.appendChild(el("p", { class: "mf-hint", text: "Could not load media data (" + e.message + "). Serve the site over http(s); file:// blocks fetch()." })); });

  function init() {
    INDEX.cell_lines.forEach(function (c) {
      byId[c.i] = c;
      var keys = [c.n].concat(c.a || []).concat(c.k || []);
      entries.push({ c: c, keys: keys.map(norm).filter(Boolean) });
    });
    document.getElementById("mf-count").textContent = INDEX.n.toLocaleString() + " cell lines · ATCC, DSMZ, JCRB, ECACC, Coriell · data retrieved " + INDEX.generated +
      ". Search by name, alias or catalogue number, or filter below.";

    speciesSel.appendChild(el("option", { value: "", text: "All species" }));
    countBy(function (c) { return c.sp ? [c.sp] : []; }).slice(0, 25).forEach(function (kv) {
      speciesSel.appendChild(el("option", { value: kv[0], text: kv[0] + " (" + kv[1] + ")" }));
    });
    growthSel.appendChild(el("option", { value: "", text: "Any growth mode" }));
    ["Adherent", "Suspension", "Semi-adherent"].forEach(function (g) { growthSel.appendChild(el("option", { value: g, text: g })); });
    speciesSel.addEventListener("change", refresh);
    growthSel.addEventListener("change", refresh);

    countBy(function (c) { return c.b || []; }).slice(0, 16).forEach(function (kv) {
      var chip = el("button", { type: "button", class: "mf-chip", "aria-pressed": "false", text: kv[0] + " (" + kv[1] + ")" });
      chip.setAttribute("data-base", kv[0]);
      chip.addEventListener("click", function () {
        var was = chip.getAttribute("aria-pressed") === "true";
        chips.querySelectorAll(".mf-chip").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        activeBase = was ? "" : kv[0];
        if (!was) chip.setAttribute("aria-pressed", "true");
        refresh();
      });
      chips.appendChild(chip);
    });
    renderLabTable();
    if (location.hash.length > 1) {
      var h = norm(decodeURIComponent(location.hash.slice(1)));
      var m = search(h, true)[0]; if (m) show(m.c.i);
    }
  }

  function countBy(fn) {
    var cnt = {};
    INDEX.cell_lines.forEach(function (c) { fn(c).forEach(function (k) { if (k) cnt[k] = (cnt[k] || 0) + 1; }); });
    return Object.keys(cnt).map(function (k) { return [k, cnt[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }

  // ── filters / search ──────────────────────────────────────────────────────
  function passes(c) {
    if (speciesSel.value && c.sp !== speciesSel.value) return false;
    if (growthSel.value && c.g !== growthSel.value) return false;
    if (activeBase && (c.b || []).indexOf(activeBase) < 0) return false;
    return true;
  }
  function search(q, ignoreFilters) {
    q = norm(q); if (!q) return [];
    var scored = [];
    entries.forEach(function (it) {
      if (!ignoreFilters && !passes(it.c)) return;
      var best = 99;
      it.keys.forEach(function (k) {
        if (k === q) best = Math.min(best, 0);
        else if (k.indexOf(q) === 0) best = Math.min(best, 1);
        else if (k.indexOf(q) > -1) best = Math.min(best, 2);
      });
      if (best < 99) scored.push({ c: it.c, s: best });
    });
    scored.sort(function (a, b) { return a.s - b.s || (b.c.l ? 1 : 0) - (a.c.l ? 1 : 0) || a.c.n.localeCompare(b.c.n); });
    return scored;
  }
  var shownCount = PAGE;
  function refresh() {
    shownCount = PAGE;
    if (input.value.trim() && INDEX) openList(search(input.value));
    renderBrowse();
  }
  function renderBrowse() {
    browse.textContent = "";
    if (!speciesSel.value && !growthSel.value && !activeBase) return;
    var hits = INDEX.cell_lines.filter(passes);
    var label = [speciesSel.value, growthSel.value, activeBase].filter(Boolean).join(" · ");
    var body = el("div", { class: "mf-src" });
    hits.slice(0, shownCount).forEach(function (c) {
      var a = el("a", { href: "#" + encodeURIComponent(c.n), class: "mf-tag", text: c.n, title: [c.sp, c.d].filter(Boolean).join(" · ") });
      a.addEventListener("click", function (e) { e.preventDefault(); show(c.i); });
      body.appendChild(a);
    });
    if (hits.length > shownCount) {
      var more = el("button", { type: "button", class: "mf-chip", text: "Show more (" + (hits.length - shownCount) + " left)" });
      more.addEventListener("click", function () { shownCount += PAGE; renderBrowse(); });
      body.appendChild(more);
    }
    if (!hits.length) body.appendChild(el("span", { class: "mf-hint", text: "No cell lines match these filters." }));
    browse.appendChild(el("div", { class: "mf-result" }, [el("header", {}, [el("h3", { text: label + " — " + hits.length.toLocaleString() + " cell lines" })]), body]));
  }

  var active = -1, shown = [];
  function openList(items) {
    shown = items.slice(0, 12); active = -1; list.textContent = "";
    shown.forEach(function (it, i) {
      var li = el("li", { role: "option", id: "mf-opt-" + i }, [el("span", { text: it.c.n + (it.c.l ? "  ★" : "") }),
        el("small", { text: [it.c.sp, it.c.d].filter(Boolean).join(" · ").slice(0, 52) })]);
      li.addEventListener("mousedown", function (e) { e.preventDefault(); pick(it.c); });
      list.appendChild(li);
    });
    if (!shown.length && input.value.trim()) list.appendChild(el("li", { text: "No match — try another spelling, an alias, or a catalogue number" }));
    var open = shown.length || input.value.trim();
    if (open) list.removeAttribute("hidden"); else list.setAttribute("hidden", "");
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeList() { list.setAttribute("hidden", ""); input.setAttribute("aria-expanded", "false"); }
  function pick(c) { input.value = c.n; closeList(); show(c.i); }
  input.addEventListener("input", function () { if (INDEX) openList(search(input.value)); });
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

  // ── detail loading (sharded) ──────────────────────────────────────────────
  function loadDetail(idx) {
    var k = idx.s;
    if (!shardCache[k]) shardCache[k] = getJSON("/data/shards/s_" + k + ".json");
    return shardCache[k].then(function (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].i === idx.i) return rows[i];
      throw new Error("record not found");
    });
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function row(dl, k, v) { if (v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: v })); } }

  function sourceBlock(c, s, lab) {
    var b = el("section", { class: "mf-src" });
    b.appendChild(el("h4", { text: s.provider + " · " + s.id }));
    b.appendChild(el("div", {}, [el("span", { class: "mf-medium", text: (s.base || "See recipe") + (s.serum ? " + " + s.serum : "") })]));
    var tags = el("div", { style: "margin-top:.3rem" });
    if (lab && lab.lab_base && s.base) {
      var same = lab.lab_base === s.base;
      tags.appendChild(el("span", { class: "mf-tag " + (same ? "ok" : "warn"),
        text: same ? "✓ same base medium as our protocol" : "⚠ differs from our protocol (" + lab.lab_base + ")" }));
    }
    (s.tags || []).forEach(function (t) { tags.appendChild(el("span", { class: "mf-tag", text: t })); });
    b.appendChild(tags);
    var dl = el("dl", { class: "mf-dl" });
    row(dl, "Recipe", s.recipe);
    row(dl, "Conditions", s.conditions);
    row(dl, "Seeding", s.seed);
    row(dl, "Split ratio", s.split);
    row(dl, "Medium renewal", s.renewal);
    row(dl, "Doubling time", s.doubling);
    row(dl, "Freezing", s.freeze);
    row(dl, "Vendor note", s.note);
    b.appendChild(dl);
    var actions = el("div", { class: "mf-actions" });
    var copy = el("button", { type: "button", text: "Copy recipe" });
    copy.addEventListener("click", function () {
      var txt = c.name + " — " + s.provider + " " + s.id + ": " + s.recipe;
      if (window.biswasLabCopy) window.biswasLabCopy(txt, copy); else if (navigator.clipboard) navigator.clipboard.writeText(txt);
    });
    var a = el("a", { href: s.url, target: "_blank", rel: "noopener", text: (s.provider === "Literature" ? "Open paper" : "View on " + s.provider) + " ↗" });
    actions.appendChild(copy); actions.appendChild(a);
    b.appendChild(actions);
    return b;
  }

  function show(id) {
    var idx = byId[id]; if (!idx) return;
    out.textContent = ""; out.appendChild(el("p", { class: "mf-hint", text: "Loading " + idx.n + "…" }));
    history.replaceState(null, "", "#" + encodeURIComponent(idx.n));
    loadDetail(idx).then(function (c) { draw(c, idx); })
      .catch(function (e) { out.textContent = ""; out.appendChild(el("p", { class: "mf-hint", text: "Could not load details for " + idx.n + " (" + e.message + ")." })); });
  }

  function draw(c, idx) {
    out.textContent = "";
    var lab = LAB[c.i];
    var card = el("article", { class: "mf-result" });
    var meta = [c.aliases && c.aliases.length ? "also: " + c.aliases.slice(0, 8).join(", ") : "", c.species, c.tissue, c.disease, c.cell_type, c.growth].filter(Boolean).join(" · ");
    card.appendChild(el("header", {}, [el("h3", { text: c.name }), el("div", { class: "mf-meta", text: meta }),
      c.i.indexOf("CVCL_") === 0 ? el("div", { class: "mf-meta" }, [el("a", { href: "https://www.cellosaurus.org/" + encodeURIComponent(c.i), target: "_blank", rel: "noopener", text: "Cellosaurus " + c.i + " ↗" })]) : null]));
    if (c.problematic) {
      card.appendChild(el("section", { class: "mf-src" }, [el("span", { class: "mf-tag warn", text: "⚠ Problematic cell line" }),
        el("span", { class: "mf-hint", text: " " + c.problematic + " (per Cellosaurus) — verify identity (STR profile) before relying on this line." })]));
    }
    if (lab) {
      var lb = el("section", { class: "mf-src mf-lab" }, [el("h4", { text: "In our lab" }), el("div", { class: "mf-medium", text: lab.lab_medium || "No medium recorded yet" })]);
      if (lab.note) lb.appendChild(el("div", { class: "mf-hint", text: lab.note }));
      card.appendChild(lb);
    }
    var vend = c.sources.filter(function (s) { return s.provider !== "Literature"; });
    var bases = {}; vend.forEach(function (s) { if (s.base) bases[s.base] = 1; });
    if (Object.keys(bases).length > 1) {
      card.appendChild(el("section", { class: "mf-src" }, [el("span", { class: "mf-tag warn", text: "Providers differ" }),
        el("span", { class: "mf-hint", text: " " + vend.map(function (s) { return s.provider + ": " + s.base; }).join("  vs  ") + ". Both usually work; follow the provider you purchased from." })]));
    }
    if (!c.sources.length) card.appendChild(el("section", { class: "mf-src" }, [el("span", { class: "mf-hint", text: "No public vendor datasheet — this is a lab-specific protocol." })]));
    c.sources.forEach(function (s) { card.appendChild(sourceBlock(c, s, lab)); });
    out.appendChild(card);
    out.appendChild(el("p", { class: "mf-foot", text: "Media are taken from the ATCC, DSMZ, JCRB, ECACC and Coriell product pages (retrieved " + INDEX.generated + "); identity and flags from Cellosaurus (CC BY 4.0). Always check the current datasheet for your lot; add antibiotics and supplements per lab protocol." }));
    window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
  }

  function renderLabTable() {
    var rows = INDEX.cell_lines.filter(function (c) { return c.l && LAB[c.i]; });
    var d = el("details", { class: "mf-result", open: "" }, [el("summary", { class: "mf-src", style: "cursor:pointer;font-weight:600", text: "Our lab's cell lines vs. public recommendations (" + rows.length + ")" })]);
    var t = el("table", { class: "mf-labtable" }, [el("tr", {}, ["Cell line", "Our protocol", "Public recommendation", "Notes"].map(function (x) { return el("th", { text: x }); }))]);
    rows.forEach(function (c) {
      var lab = LAB[c.i];
      var rec = (c.b && c.b.length) ? c.b.join(" / ") : "—";
      var diff = lab.lab_base && c.b && c.b.length && c.b.indexOf(lab.lab_base) < 0;
      var a = el("a", { href: "#" + encodeURIComponent(c.n), text: c.n });
      a.addEventListener("click", function (e) { e.preventDefault(); show(c.i); });
      t.appendChild(el("tr", {}, [el("td", {}, [a]), el("td", { text: lab.lab_medium || "— (not recorded)" }),
        el("td", {}, [diff ? el("span", { class: "mf-tag warn", text: "differs" }) : null, document.createTextNode(" " + rec + " (" + (c.p || []).join(", ") + ")")]),
        el("td", { text: lab.note || "" })]));
    });
    d.appendChild(el("div", { class: "mf-src" }, [t]));
    labBox.appendChild(d);
  }
})();
