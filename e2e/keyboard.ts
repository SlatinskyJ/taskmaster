import { expect, type Locator, type Page } from '@playwright/test'

// A simulated iPhone keyboard for browser tests and brief screenshots. Chromium cannot show a
// real on-screen keyboard, so this copies what iOS does when a text field gets focus: the
// visual viewport shrinks by the keyboard's height (fixed bars and `dvh` stay where they are),
// the page scrolls the field into the part still visible, and a grey block covers the rest.
// Libraries that follow `window.visualViewport` (vaul's bottom sheet) react as on a phone.
// Close to an iPhone, not proof: time and date fields open a picker iOS draws itself.

/** iPhone 15 Pro, portrait: the keyboard with its suggestion row (336) plus the form bar (44). */
export const KEYBOARD_HEIGHT = 380

/** The iPhone 15 Pro screen as the installed app sees it (the brief's screenshot size). */
export const PHONE = { width: 393, height: 852 } as const

/**
 * The same iPhone in a browser (Chrome on iOS, measured 2026-11-24): the address and tool bars
 * leave 668 pt of page, and the keyboard with its autofill bubble covers all but the top 333.
 * Smaller than the installed app, so the tests use it: what passes here passes there.
 */
export const PHONE_BROWSER = { width: 393, height: 668, keyboard: 335 } as const

const script = (height: number) => `(() => {
  const KB = ${String(height)};
  window.__keyboardHeight = KB;
  const vv = new EventTarget();
  let open = false;
  for (const k of ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop']) vv[k] = 0;
  vv.scale = 1;
  window.__visualViewport = vv;
  Object.defineProperty(vv, 'width', { get: () => window.innerWidth });
  Object.defineProperty(vv, 'height', { get: () => window.innerHeight - (open ? KB : 0) });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  const NO_KEYS = ['checkbox', 'radio', 'button', 'submit', 'range', 'time', 'date'];
  const isText = (el) => !!el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !NO_KEYS.includes(el.type)));
  const board = (show) => {
    let b = document.getElementById('__keyboard');
    if (show && !b) {
      b = document.createElement('div');
      b.id = '__keyboard';
      b.setAttribute('aria-hidden', 'true');
      b.style.cssText = 'position:fixed;inset:auto 0 0 0;height:' + KB + 'px;z-index:2147483647;' +
        'background:repeating-linear-gradient(0deg,#9aa0a8 0 52px,#b9bec5 52px 56px);opacity:.96;' +
        'pointer-events:none;font:600 15px system-ui;color:#222;text-align:center;padding-top:12px';
      b.textContent = 'klávesnice';
      document.documentElement.appendChild(b);
    }
    if (!show && b) b.remove();
  };
  document.addEventListener('focusin', (e) => {
    if (!isText(e.target)) return;
    // iOS lets the page slide up under the keyboard even when it does not scroll; extra room
    // at the bottom gives the same slide here. Fixed layers (bars, dialogs) stay put, as on iOS.
    open = true; board(true); document.body.style.paddingBottom = KB + 'px';
    vv.dispatchEvent(new Event('resize'));
    setTimeout(() => {
      const r = e.target.getBoundingClientRect();
      const limit = window.innerHeight - KB - 8;
      if (r.bottom > limit) window.scrollBy(0, r.bottom - limit);
    }, 50);
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (isText(document.activeElement)) return;
    open = false; board(false); document.body.style.paddingBottom = '';
    vv.dispatchEvent(new Event('resize'));
  }, 0));
})();`

/** Call before the first `goto`: every text field that gets focus then opens the keyboard. */
export async function useKeyboard(page: Page, height = KEYBOARD_HEIGHT) {
  await page.addInitScript(script(height))
}

/** Taps into a field, as a person does, and waits for the page to settle around the keyboard. */
export async function openKeyboard(page: Page, field: Locator) {
  await field.focus()
  await expect(page.locator('#__keyboard')).toBeAttached()
  await page.waitForTimeout(400) // the scroll and the sheet's move are animated
}

interface FakeViewport extends EventTarget {
  offsetTop: number
  pageTop: number
}
type KeyboardWindow = Window & { __keyboardHeight: number; __visualViewport: FakeViewport }

/**
 * Slides the visible part down the page by `top` px, as iOS does when it pans the visual
 * viewport to reach a field (`visualViewport.offsetTop`), and tells listeners (`scroll`).
 */
export async function panKeyboard(page: Page, top: number) {
  await page.evaluate((t) => {
    const vv = (window as unknown as KeyboardWindow).__visualViewport
    vv.offsetTop = t
    vv.pageTop = t + window.scrollY
    vv.dispatchEvent(new Event('scroll'))
  }, top)
}

/** The element sits whole in the part of the screen the keyboard leaves visible. */
export async function expectAboveKeyboard(page: Page, element: Locator) {
  const { top, visible } = await page.evaluate(() => {
    const w = window as unknown as KeyboardWindow
    const offset = w.__visualViewport.offsetTop
    return { top: offset, visible: offset + w.innerHeight - w.__keyboardHeight }
  })
  await expect
    .poll(async () => {
      const box = await element.boundingBox()
      return box !== null && box.y >= top && box.y + box.height <= visible
    })
    .toBe(true)
}
