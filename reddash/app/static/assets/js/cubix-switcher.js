/* Server switcher in the guild header.

   Lives in its own file rather than inline in base.html: the deployment serves
   a Content-Security-Policy carrying a nonce, and per spec a nonce makes the
   browser ignore 'unsafe-inline' entirely - so every inline <script> is
   blocked and this never ran. `script-src 'self'` allows a same-origin file.

   It also deliberately owns none of Bootstrap's dropdown classes: the theme
   puts `will-change` and `backface-visibility: hidden` on `.dropdown-menu`,
   which promotes it to its own GPU layer and rendered it see-through.
*/
// The server switcher runs its own toggle rather than Bootstrap's dropdown:
// the theme's `.dropdown-menu` rules promote the menu to a GPU layer that
// rendered see-through, and there is nothing to gain from inheriting them.
(function () {
  function close(gs) {
    gs.classList.remove("open");
    var t = gs.querySelector(".cx-guild-switch-toggle");
    if (t) { t.setAttribute("aria-expanded", "false"); }
  }
  document.addEventListener("click", function (event) {
    var toggle = event.target.closest && event.target.closest(".cx-guild-switch-toggle");
    if (toggle) {
      event.preventDefault();
      var gs = toggle.closest(".cx-gs");
      var wasOpen = gs.classList.contains("open");
      document.querySelectorAll(".cx-gs.open").forEach(close);
      if (!wasOpen) {
        gs.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
        var search = gs.querySelector(".cx-gs-search");
        if (search) { search.focus(); }
      }
      return;
    }
    // A click inside the menu is either a link (let it through) or the
    // search box (keep the menu open); anything else closes it.
    if (event.target.closest && event.target.closest(".cx-gs-menu")) {
      if (event.target.classList.contains("cx-gs-search")) { return; }
      if (!event.target.closest(".cx-gs-item")) { return; }
      return;
    }
    document.querySelectorAll(".cx-gs.open").forEach(close);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      document.querySelectorAll(".cx-gs.open").forEach(close);
    }
  });
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

