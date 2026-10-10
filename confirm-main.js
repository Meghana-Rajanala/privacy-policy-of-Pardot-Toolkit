// Runs in the page's own world so native confirm() popups can be auto-accepted
// while the extension is removing a field (flag is set by content.js).
(() => {
  const original = window.confirm.bind(window);
  window.confirm = function (message) {
    if (document.documentElement.dataset.ptAutoConfirm === '1') return true;
    return original(message);
  };
})();
