(function () {
  try {
    var stored = localStorage.getItem('qs-theme');
    document.documentElement.dataset.theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch (_) { document.documentElement.dataset.theme = 'dark'; }
})();
