// copy.js — the copy button. A button with `data-copy-target="<id>"` copies the text of that element; the optional
// `data-copy-status="<id>"` names the element where «copied» is announced (it should be `role="status"`). The
// clipboard API needs a secure context, which a page opened from file:// may not be, so there is a fallback to a
// hidden textarea and `execCommand`. Texts are keys of assets/shared.i18n.js.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const timers = new WeakMap();

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      const area = document.createElement('textarea');
      area.value = text;
      area.className = 'visually-hidden';
      area.setAttribute('readonly', '');
      document.body.appendChild(area);
      area.select();
      let done = false;
      try {
        done = document.execCommand('copy');
      } catch (error) {
        done = false;
      }
      area.remove();
      if (done) resolve();
      else reject(new Error('copy refused'));
    });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function announce(status, key) {
    if (!status) return;
    status.textContent = site.i18n.t(key);
    window.clearTimeout(timers.get(status));
    timers.set(
      status,
      window.setTimeout(function () {
        status.textContent = '';
      }, 2500),
    );
  }

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-copy-target]');
    if (!button) return;
    const source = document.getElementById(button.getAttribute('data-copy-target'));
    const status = document.getElementById(button.getAttribute('data-copy-status') || '');
    if (!source) return;
    copy(source.textContent.trim()).then(
      function () {
        announce(status, 'copy.done');
      },
      function () {
        announce(status, 'copy.failed');
      },
    );
  });
})();
