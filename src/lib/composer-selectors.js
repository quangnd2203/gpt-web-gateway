// ChatGPT has used several DOM shapes for the home composer. Keep detection and
// interaction on the same selector set so a UI refresh cannot make one stage see
// the editor while another stage misses it.
const COMPOSER_SELECTOR = [
  '#prompt-textarea',
  '#pending-home-input',
  '[data-testid="prompt-textarea"]',
  'textarea[aria-label*="Ask ChatGPT" i]',
  'textarea[placeholder*="Ask ChatGPT" i]',
  '[contenteditable="true"][aria-label*="Ask ChatGPT" i]',
  '[contenteditable="true"][data-placeholder*="Ask ChatGPT" i]',
  '[role="textbox"][aria-label*="Ask ChatGPT" i]',
  'textarea',
  // Do not use a bare contenteditable fallback: Personal can contain other
  // editable widgets, and document order must not make one win over the composer.
  '[contenteditable="true"][role="textbox"]',
].join(', ');

const VISIBLE_COMPOSER_SELECTOR = COMPOSER_SELECTOR
  .split(', ')
  .map((selector) => `${selector}:visible`)
  .join(', ');

module.exports = { COMPOSER_SELECTOR, VISIBLE_COMPOSER_SELECTOR };
