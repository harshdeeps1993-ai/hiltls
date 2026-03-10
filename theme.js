(function () {
  var root = document.documentElement;
  var btn = document.getElementById("theme-toggle");
  var stored = localStorage.getItem("theme");

  // Initialize: use stored preference, or system preference
  if (stored) {
    root.setAttribute("data-theme", stored);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    root.setAttribute("data-theme", "dark");
  }

  function updateLabel() {
    var isDark = root.getAttribute("data-theme") === "dark";
    btn.textContent = isDark ? "\u2600\ufe0f" : "\ud83c\udf19";
    btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  }

  updateLabel();

  btn.addEventListener("click", function () {
    var isDark = root.getAttribute("data-theme") === "dark";
    var next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateLabel();
  });
})();
