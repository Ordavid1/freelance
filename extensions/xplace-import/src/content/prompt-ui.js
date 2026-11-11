// The invitation: a closed Shadow DOM component (pill + card). Hebrew, RTL, never a blocking overlay.
// Built with createElement/textContent only. Clearly labelled as the extension, fixed to the bottom inline-end corner.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const LIME = '#ceef00';
  const INK = '#151719';
  const HOST_ID = 'fp-xplace-import-host';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const COPY = {
    brandLine: 'Freelance Place · תוסף',
    notNow: 'לא עכשיו',
    never: 'אל תציגו שוב',
    settings: 'הגדרות',
    close: 'סגירה',
    hidePill: 'הסתרה',
    variants: {
      freelancer: {
        title: 'העבירו את הפרופיל שלכם ל־Freelance Place',
        value: 'מעתיקים את הפרופיל מ־XPlace ל־Freelance Place, בלי להקליד הכול מחדש.',
        bullets: ['בלחיצה אחת', 'אתם בודקים ועורכים הכול לפני שמירה', 'לא משנים ולא מוחקים דבר ב־XPlace'],
        cta: 'העתקת הפרופיל',
        pill: 'העבירו ל־Freelance Place',
        disclosure: 'לפני הלחיצה נבדק רק אם אתם מחוברים ובעלי הדף. תוכן הפרופיל נקרא ונשלח ל־Freelance Place רק בלחיצה שלכם, לעריכה.',
      },
      'own-project': {
        title: 'פרסמו גם את הפרויקט הזה ב־Freelance Place',
        value: 'מעתיקים את פרטי הפרויקט מ־XPlace לטיוטה ב־Freelance Place.',
        bullets: ['פרסום פרויקטים חינם', 'הטיוטה מוכנה לעריכה ולאישור שלכם'],
        cta: 'ייבוא הפרויקט',
        pill: 'פרסמו ב־Freelance Place',
        disclosure: 'לפני הלחיצה נבדק רק אם אתם מחוברים ובעלי הדף. תוכן הפרויקט נקרא ונשלח ל־Freelance Place רק בלחיצה שלכם, לעריכה.',
      },
      publisher: {
        title: 'פרסמו את הפרויקטים שלכם גם ב־Freelance Place',
        value: 'כדי לייבא פרויקט קיים, היכנסו לעמוד הפרויקט שלכם ב־XPlace ולחצו שם על הכפתור הזה.',
        bullets: ['פרסום פרויקטים חינם', 'הטיוטה מוכנה לעריכה ולאישור שלכם'],
        cta: 'מעבר ל־Freelance Place',
        pill: 'פרסמו ב־Freelance Place',
        disclosure: 'לפני הלחיצה נבדק רק אם אתם מחוברים. בלחיצה נפתח Freelance Place, ושום תוכן לא נקרא מהעמוד ולא נשלח.',
      },
    },
    messages: {
      busyCapture: 'קוראים את הפרופיל שלכם…',
      busyProject: 'קוראים את פרטי הפרויקט…',
      busyOpen: 'פותחים את הפרופיל שלכם ב־XPlace…',
      doneStaged: 'הנתונים הועברו ל־Freelance Place. בדקו אותם בלשונית שנפתחה לפני השמירה.',
      doneTabOpen: 'פתחנו את הפרופיל שלכם בלשונית נפרדת. הקריאה תסתיים שם והלשונית תיסגר מעצמה.',
      doneProfileClosed: 'הפרופיל הועבר ל־Freelance Place. אפשר לסגור את הלשונית.',
      doneOpened: 'Freelance Place נפתח בלשונית חדשה.',
      loginRequired: 'התחברו ל־XPlace ואז חזרו ל־Freelance Place ולחצו שוב על כפתור XPlace.',
      errUnreadable: 'לא הצלחנו לקרוא את הדף. רעננו את העמוד ונסו שוב.',
      errNotOwner: 'זה לא הפרופיל שלכם ב־XPlace.',
      errNotOwnerProject: 'הפרויקט הזה לא שייך לחשבון שלכם ב־XPlace, ולכן אי אפשר לייבא אותו.',
      errEmpty: 'לא מצאנו בדף מידע לייבוא.',
      errTooLarge: 'המידע בדף גדול מדי לייבוא.',
      errNoSlug: 'לא מצאנו את כתובת הפרופיל שלכם. היכנסו לפרופיל שלכם ב־XPlace ולחצו שם.',
      errFp: 'לא הצלחנו לפתוח את Freelance Place. נסו שוב בעוד רגע.',
      hiddenNotice: 'ההזמנה הוסתרה. אפשר להחזיר אותה בהגדרות התוסף.',
    },
  };

  function css(config) {
    const maxW = config.CARD_MAX_WIDTH_PX;
    const maxH = config.CARD_MAX_HEIGHT_PERCENT;
    return `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; color: ${INK}; direction: rtl; text-align: right;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; line-height: 1.45; font-size: 14px; }
button { font: inherit; cursor: pointer; color: inherit; }
button:focus-visible, a:focus-visible { outline: 3px solid ${INK}; outline-offset: 2px; }
.pill { display: inline-flex; align-items: center; gap: 4px; background: ${LIME}; border-radius: 999px; box-shadow: 0 2px 10px rgba(21,23,25,.28); padding: 4px; }
.pill-main { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; padding: 4px 8px 4px 4px; font-weight: 700; font-size: 13px; }
.pill-x { border: 0; background: rgba(21,23,25,.12); border-radius: 999px; width: 24px; height: 24px; line-height: 1; font-size: 16px; padding: 0; }
.card { background: #fff; border: 1px solid rgba(21,23,25,.18); border-radius: 16px; box-shadow: 0 10px 34px rgba(21,23,25,.3);
  width: min(${maxW}px, calc(100vw - 32px)); max-height: ${maxH}vh; overflow-y: auto; overscroll-behavior: contain; }
.head { display: flex; align-items: center; gap: 8px; background: ${INK}; color: ${LIME}; padding: 8px 12px; border-radius: 15px 15px 0 0; font-size: 12px; font-weight: 700; }
.head .grow { flex: 1; }
.x { border: 0; background: transparent; color: ${LIME}; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.body { padding: 14px 16px 16px; }
h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.3; }
p { margin: 0 0 8px; }
ul { margin: 0 0 10px; padding: 0 18px 0 0; }
li { margin: 2px 0; }
.disclosure { font-size: 12px; background: rgba(21,23,25,.06); border-radius: 8px; padding: 8px 10px; margin: 0 0 12px; }
.status { min-height: 0; margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.status.error { color: #a40e26; }
.status.done { color: #14672f; }
.status.busy::before { content: ''; display: inline-block; width: 12px; height: 12px; margin-inline-end: 6px; border: 2px solid ${INK}; border-top-color: transparent; border-radius: 50%; vertical-align: -2px; animation: spin .8s linear infinite; }
.cta { display: block; width: 100%; background: ${LIME}; color: ${INK}; border: 2px solid ${INK}; border-radius: 10px; padding: 10px 14px; font-weight: 800; font-size: 15px; }
.cta[disabled] { opacity: .6; cursor: progress; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 10px; }
.sec { background: transparent; border: 1px solid rgba(21,23,25,.35); border-radius: 8px; padding: 5px 10px; font-size: 13px; }
.link { background: transparent; border: 0; padding: 2px 0; font-size: 12px; text-decoration: underline; }
.sp { flex: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .status.busy::before { animation: none; } * { transition: none !important; } }
@media (max-width: ${config.BOTTOM_SHEET_BELOW_PX - 1}px) {
  .wrap { position: fixed; inset-inline: 0; bottom: 0; align-items: stretch; gap: 0; }
  .card { width: 100%; max-width: none; border-radius: 16px 16px 0 0; border-width: 1px 0 0; }
  .head { border-radius: 15px 15px 0 0; }
  .pill { align-self: flex-end; margin: 0 12px 12px; }
}`;
  }

  function el(doc, tag, props, children) {
    const node = doc.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === 'text') node.textContent = props[k];
        else if (k === 'class') node.className = props[k];
        else node.setAttribute(k, props[k]);
      }
    }
    for (const c of children || []) if (c) node.appendChild(c);
    return node;
  }

  function mark(doc, size) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 512 512'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const bg = doc.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of [['width', '512'], ['height', '512'], ['rx', '110'], ['fill', LIME]]) bg.setAttribute(k, v);
    svg.appendChild(bg);
    for (const d of ['M157 80H362V150H157V333H80V155Z', 'M207 213H277V283H207Z', 'M312 185H432V432H157V362H298L360 256H312Z']) {
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d); p.setAttribute('fill', INK);
      svg.appendChild(p);
    }
    return svg;
  }

  /**
   * handlers: onCta, onNotNow, onNever, onSettings, onOpenCard, onCloseCard, onHidePill.
   * model: { pill, cardOpen, variant, status: idle|busy|error|done, message, notice, force }
   */
  function createPromptUI(options) {
    const doc = options.doc;
    const config = options.config;
    const handlers = options.handlers || {};
    let host = null;
    let shadow = null;
    let lastKey = null;
    let lastModel = null;
    let styleReady = false;
    let focusAction = null;

    function ensureAttached() {
      if (host && host.isConnected) return;
      host = doc.createElement('div');
      host.id = HOST_ID;
      const s = host.style;
      s.setProperty('all', 'initial');
      s.setProperty('position', 'fixed');
      s.setProperty('inset-block-end', '16px');
      s.setProperty('inset-inline-end', '16px');
      s.setProperty('z-index', '2147483647');
      s.setProperty('direction', 'rtl');
      shadow = host.attachShadow({ mode: 'closed' });
      styleReady = false;
      lastKey = null;
      (doc.documentElement || doc.body).appendChild(host);
    }

    function applyStyles() {
      if (styleReady) return;
      const text = css(config);
      try {
        const sheet = new root.CSSStyleSheet();
        sheet.replaceSync(text);
        shadow.adoptedStyleSheets = [sheet];
      } catch (e) {
        shadow.appendChild(el(doc, 'style', { text }));
      }
      styleReady = true;
    }

    function btn(cls, text, action, extra) {
      const b = el(doc, 'button', Object.assign({ type: 'button', class: cls, text, 'data-action': action }, extra || {}));
      b.addEventListener('click', (ev) => { ev.stopPropagation(); focusAction = action; const h = handlers[action]; if (h) h(); });
      return b;
    }

    function buildCard(model, copy) {
      const titleId = 'fpx-title';
      const card = el(doc, 'div', { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'aria-label': COPY.brandLine });
      card.setAttribute('aria-labelledby', titleId);
      const head = el(doc, 'div', { class: 'head' }, [mark(doc, 18), el(doc, 'span', { class: 'grow', text: COPY.brandLine }), btn('x', '×', 'onCloseCard', { 'aria-label': COPY.close, title: COPY.close })]);
      const body = el(doc, 'div', { class: 'body' });
      body.appendChild(el(doc, 'h2', { id: titleId, text: copy.title }));
      body.appendChild(el(doc, 'p', { text: copy.value }));
      body.appendChild(el(doc, 'ul', null, copy.bullets.map((b) => el(doc, 'li', { text: b }))));
      const status = el(doc, 'p', { class: `status ${model.status}`, 'aria-live': 'polite', role: 'status' });
      if (model.message) status.textContent = model.message; else status.style.setProperty('display', 'none');
      body.appendChild(status);
      body.appendChild(el(doc, 'p', { class: 'disclosure', text: copy.disclosure }));
      const cta = btn('cta', copy.cta, 'onCta');
      if (model.status === 'busy') { cta.setAttribute('disabled', ''); cta.setAttribute('aria-busy', 'true'); }
      body.appendChild(cta);
      body.appendChild(el(doc, 'div', { class: 'row' }, [
        btn('sec', COPY.notNow, 'onNotNow'),
        btn('link', COPY.never, 'onNever'),
        el(doc, 'span', { class: 'sp' }),
        btn('link', COPY.settings, 'onSettings'),
      ]));
      card.appendChild(head); card.appendChild(body);
      return card;
    }

    function buildNotice(message) {
      const card = el(doc, 'div', { class: 'card', role: 'status' });
      card.appendChild(el(doc, 'div', { class: 'head' }, [mark(doc, 18), el(doc, 'span', { class: 'grow', text: COPY.brandLine }), btn('x', '×', 'onCloseCard', { 'aria-label': COPY.close })]));
      card.appendChild(el(doc, 'div', { class: 'body' }, [el(doc, 'p', { class: `status ${lastModel && lastModel.status === 'error' ? 'error' : ''}`, text: message })]));
      return card;
    }

    function buildPill(copy) {
      const main = btn('pill-main', copy.pill, 'onOpenCard', { 'aria-label': `${COPY.brandLine}: ${copy.pill}`, 'aria-expanded': 'false' });
      main.insertBefore(mark(doc, 24), main.firstChild);
      return el(doc, 'div', { class: 'pill' }, [main, btn('pill-x', '×', 'onHidePill', { 'aria-label': COPY.hidePill, title: COPY.hidePill })]);
    }

    // opts.focus: 'card' (close button) or 'pill' (its main button), applied after the next rebuild only.
    function render(model, opts) {
      if (!model || (!model.pill && !model.cardOpen && !model.notice)) { destroy(); return; }
      ensureAttached();
      const key = JSON.stringify(model);
      if (key === lastKey) return;
      lastKey = key; lastModel = model;
      applyStyles();
      for (const child of Array.from(shadow.childNodes)) if (child.tagName !== 'STYLE') shadow.removeChild(child);
      const copy = COPY.variants[model.variant] || COPY.variants.freelancer;
      const wrap = el(doc, 'div', { class: 'wrap' });
      if (model.notice) wrap.appendChild(buildNotice(model.notice));
      else if (model.cardOpen) wrap.appendChild(buildCard(model, copy));
      else if (model.pill) wrap.appendChild(buildPill(copy));
      shadow.appendChild(wrap);
      const want = opts && opts.focus;
      if (want) {
        const target = want === 'card' ? wrap.querySelector('[data-action="onCloseCard"]') : wrap.querySelector('[data-action="onOpenCard"]');
        if (target) try { target.focus(); } catch (e) { /* ignore */ }
        focusAction = null;
      } else if (focusAction) {
        const again = wrap.querySelector(`[data-action="${focusAction}"]`);
        if (again && !again.disabled) try { again.focus(); } catch (e) { /* ignore */ }
        focusAction = null;
      }
    }

    function destroy() {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null; shadow = null; lastKey = null; styleReady = false;
    }

    // Esc collapses the card; never prevents the page's own handling.
    doc.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && lastModel && lastModel.cardOpen && handlers.onCloseCard) handlers.onCloseCard();
    });

    return { render, destroy, ensureAttached, get host() { return host; }, get shadow() { return shadow; }, HOST_ID };
  }

  FPX.promptUi = { createPromptUI, COPY, HOST_ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.promptUi;
})(globalThis);
