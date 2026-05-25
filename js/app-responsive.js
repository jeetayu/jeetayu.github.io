/* app-responsive.js — sidebar drawer + mobile helpers for all lab apps */
(function () {
  'use strict';

  function init() {
    var sidebar = document.querySelector('.sidebar');
    var topbar  = document.querySelector('.topbar');
    var shell   = document.querySelector('.shell');

    // Only activate the drawer if there is a persistent sidebar in the layout.
    // Sidebars with an explicit inline display:none manage their own visibility
    // (e.g. the TCR app which shows the sidebar only after data is uploaded).
    if (!sidebar || !topbar || !shell || sidebar.style.display === 'none') return;

    // ── Overlay ──────────────────────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    shell.appendChild(overlay);
    overlay.addEventListener('click', close);

    // ── Hamburger button ─────────────────────────────────────────────────────
    var btn = document.createElement('button');
    btn.className = 'app-hamburger';
    btn.setAttribute('aria-label', 'Toggle sidebar');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '&#9776;&nbsp;Filters';

    // Always append after everything so status pills stay visible
    topbar.appendChild(btn);

    btn.addEventListener('click', toggle);

    // ── Keyboard: Escape closes drawer ───────────────────────────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // ── Swipe-left to close ───────────────────────────────────────────────────
    var touchStartX = null;
    sidebar.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    sidebar.addEventListener('touchend', function (e) {
      if (touchStartX === null) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      if (dx < -40) close();           // swipe left 40 px → close
      touchStartX = null;
    }, { passive: true });

    function toggle() {
      if (sidebar.classList.contains('sidebar-open')) {
        close();
      } else {
        open();
      }
    }

    function open() {
      sidebar.classList.add('sidebar-open');
      overlay.classList.add('sidebar-open');
      btn.setAttribute('aria-expanded', 'true');
      btn.innerHTML = '&#10005;&nbsp;Close';
      // Prevent body scroll while drawer is open
      document.body.style.overflow = 'hidden';
    }

    function close() {
      sidebar.classList.remove('sidebar-open');
      overlay.classList.remove('sidebar-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '&#9776;&nbsp;Filters';
      document.body.style.overflow = '';
    }

    // Expose globally so individual apps can call closeSidebar() if needed
    window.closeSidebar = close;
    window.openSidebar  = open;
  }

  // ── Horizontal-scroll wrapper for bare <table> elements ───────────────────
  // Wraps any table not already inside an overflow:auto container so it
  // scrolls horizontally on narrow screens without reflowing the page.
  function wrapTables() {
    document.querySelectorAll('table').forEach(function (tbl) {
      var p = tbl.parentElement;
      if (!p) return;
      // Skip if already wrapped or inside a .card (style.css handles those)
      if (p.classList.contains('tbl-scroll-wrap')) return;
      if (p.closest('.card')) return;
      var wrap = document.createElement('div');
      wrap.className = 'tbl-scroll-wrap';
      wrap.style.cssText = 'overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%';
      p.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); wrapTables(); });
  } else {
    init();
    wrapTables();
  }
})();
