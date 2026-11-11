(function () {
  'use strict';
  const S = globalThis.FPX.promptState;
  const area = chrome.storage.local;
  const stateEl = document.getElementById('state');
  const button = document.getElementById('toggle');
  let state = S.normalise(null);

  function paint() {
    stateEl.textContent = state.dismissedForever ? 'ההזמנה ב־XPlace מוסתרת.' : 'ההזמנה ב־XPlace מופעלת.';
    button.textContent = state.dismissedForever ? 'הצגת ההזמנה שוב' : 'הסתרת ההזמנה';
  }
  button.addEventListener('click', async () => {
    state = state.dismissedForever ? S.enable(state) : S.dismissForever(state);
    await S.saveState(area, state);
    paint();
  });
  S.loadState(area).then((s) => { state = s; paint(); });
})();
