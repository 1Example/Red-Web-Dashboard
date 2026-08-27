/* Server switcher in the guild header.

   Two constraints shaped this, both learned the hard way:

   1. It lives in its own file, not inline in base.html. The deployment serves a
      Content-Security-Policy carrying a nonce, and per spec a nonce makes the
      browser ignore 'unsafe-inline' entirely - so every inline <script> is
      blocked. `script-src 'self'` allows a same-origin file.

   2. The menu is moved to <body> and positioned fixed while it is open. In
      place it sits inside the hero card and `.card-body`, both of which create
      stacking contexts, and the cards below it are translucent glass
      (`.card { background: rgba(24, 48, 105, .10) }`). A menu trapped behind
      one of those is visible *through* it with the card's own text drawn on
      top, which reads exactly like a transparent menu. Reparenting to <body>
      removes every ancestor that could trap it.
*/
(function () {
  var open = null; // the menu currently shown

  function place(menu) {
    var toggle = menu._cxToggle;
    if (!toggle) { return; }
    var r = toggle.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 8) + "px";
    menu.style.left = Math.round(r.left) + "px";
    // Keep it on screen if the toggle sits near the right edge.
    var overflow = r.left + menu.offsetWidth - document.documentElement.clientWidth + 12;
    if (overflow > 0) {
      menu.style.left = Math.max(8, Math.round(r.left - overflow)) + "px";
    }
  }

  function close() {
    if (!open) { return; }
    open.classList.remove("open");
    if (open._cxHome && open.parentNode !== open._cxHome) {
      open._cxHome.appendChild(open); // put it back where the template had it
    }
    if (open._cxToggle) { open._cxToggle.setAttribute("aria-expanded", "false"); }
    open = null;
  }

  function show(menu, toggle) {
    close();
    menu._cxToggle = toggle;
    if (!menu._cxHome) { menu._cxHome = menu.parentNode; }
    document.body.appendChild(menu);
    menu.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    open = menu;
    place(menu);
    var search = menu.querySelector(".cx-gs-search");
    if (search) { search.focus(); }
  }

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest && event.target.closest(".cx-guild-switch-toggle");
    if (toggle) {
      event.preventDefault();
      var gs = toggle.closest(".cx-gs");
      var menu = (gs && gs.querySelector(".cx-gs-menu"))
        || (open && open._cxToggle === toggle ? open : null);
      if (!menu) { return; }
      if (menu === open) { close(); } else { show(menu, toggle); }
      return;
    }
    // Inside the open menu: the search box keeps it open, a link navigates.
    if (open && event.target.closest && event.target.closest(".cx-gs-menu")) {
      if (event.target.classList.contains("cx-gs-search")) { return; }
      if (event.target.closest(".cx-gs-item")) { return; }
      return;
    }
    close();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { close(); }
  });

  // Reposition rather than drift away from the toggle.
  window.addEventListener("resize", function () { if (open) { place(open); } });
  window.addEventListener("scroll", function () { if (open) { place(open); } }, true);

  document.addEventListener("input", function (event) {
    var box = event.target;
    if (!box.classList || !box.classList.contains("cx-gs-search")) { return; }
    var menu = box.closest(".cx-gs-menu");
    if (!menu) { return; }
    var query = box.value.trim().toLowerCase();
    menu.querySelectorAll(".cx-gs-item[data-name]").forEach(function (item) {
      item.style.display =
        (item.getAttribute("data-name") || "").indexOf(query) > -1 ? "" : "none";
    });
  });
})();
