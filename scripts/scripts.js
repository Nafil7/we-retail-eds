import {
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  buildBlock,
} from './aem.js';

if (window.trustedTypes && window.trustedTypes.createPolicy) {
  const innerTT = window.trustedTypes.createPolicy('tt-inner', {
    createHTML: (s) => s, // avoid stack overflow
  });

  window.trustedTypes.createPolicy('default', {
    createHTML: (input, type, sink) => {
      let processedInput = input;
      if (/srcdoc\s*=/i.test(processedInput)) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('iframe[srcdoc]').forEach((el) => el.removeAttribute('srcdoc'));
        processedInput = doc.body.innerHTML;
      }
      if (sink.includes('createContextualFragment') || sink.includes('Document write')) {
        const doc = new DOMParser().parseFromString(innerTT.createHTML(processedInput), 'text/html');
        doc.querySelectorAll('script').forEach((el) => el.remove());
        processedInput = doc.body.innerHTML;
      }
      return processedInput;
    },
    createScriptURL: (input) => input,
    createScript: (input) => input,
  });
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Turns `/widgets/...` links into widget blocks.
 * @param {Element} main The container element
 */
function buildWidgetAutoBlocks(main) {
  const widgetLinks = [...main.querySelectorAll('a[href*="/widgets/"]')];
  widgetLinks.forEach((link) => {
    if (link.closest('.widget')) return;
    const newLink = link.cloneNode(true);
    const widgetBlock = buildBlock('widget', { elems: [newLink] });
    const p = link.closest('p');
    if (
      p
      && p.querySelectorAll('a').length === 1
      && p.querySelector('a') === link
      && p.textContent.trim() === link.textContent.trim()
    ) {
      p.replaceWith(widgetBlock);
    } else {
      link.replaceWith(widgetBlock);
    }
  });
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // auto load `*/fragments/*` references
    const fragments = [...main.querySelectorAll('a[href*="/fragments/"]')].filter((f) => !f.closest('.fragment'));
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(...frag.children);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }
    buildWidgetAutoBlocks(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();

    // quick structural checks
    if (a.querySelector('img') || p.textContent.trim() !== text) return;

    // skip URL display links
    try {
      if (new URL(a.href).href === new URL(text, window.location).href) return;
    } catch { /* continue */ }

    // require authored formatting for buttonization
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (!strong && !em) return;

    p.className = 'button-wrapper';
    a.className = 'button';
    if (strong && em) { // high-impact call-to-action
      a.classList.add('accent');
      const outer = strong.contains(em) ? strong : em;
      outer.replaceWith(a);
    } else if (strong) {
      a.classList.add('primary');
      strong.replaceWith(a);
    } else {
      a.classList.add('secondary');
      em.replaceWith(a);
    }
  });
}

/**
 * Resolves We.Retail DAM asset references to repository-hosted media.
 * Normalizes JCR paths and maps whitespace-containing assets to URL-safe aliases.
 * @param {Element} main The main container element
 */
/**
 * Central asset alias map for URL-safe delivery
 */
export const ASSET_ALIAS_MAP = {
  'El Gordo Green.jpg': 'El-Gordo-Green.jpg',
};

/**
 * Safely decodes a URI component without throwing on malformed sequences.
 * @param {string} val String to decode
 * @returns {string} Decoded string or original if malformed
 */
export function safeDecodeURIComponent(val) {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

/**
 * Checks if a URL is an external absolute URL (http, https, protocol-relative).
 * @param {string} url The URL to check
 * @returns {boolean} True if external
 */
export function isExternalMediaUrl(url) {
  if (!url) return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) || /^\/\//.test(trimmed);
}

/**
 * Resolves a single media URL to the repository-hosted media path.
 * @param {string} rawSrc Raw media URL or path
 * @param {string} basePath Base code path (defaults to window.hlx.codeBasePath)
 * @returns {string} Resolved media URL
 */
export function resolveMediaUrl(rawSrc, basePath = (typeof window !== 'undefined' && window.hlx?.codeBasePath) || '') {
  if (!rawSrc) return rawSrc;
  const trimmed = rawSrc.trim();

  // Do not rewrite external absolute URLs
  if (isExternalMediaUrl(trimmed)) {
    return rawSrc;
  }

  const damPrefix = '/content/dam/we-retail/';
  const isDam = trimmed.includes(damPrefix);
  const isMedia = trimmed.startsWith('/media/') || trimmed.startsWith('media/') || (trimmed.includes('/media/') && !trimmed.includes('://'));

  if (isDam || isMedia || trimmed.includes('El Gordo Green.jpg')) {
    try {
      const [pathOnly, queryOrHash] = trimmed.split(/([?#].*)/, 2);
      let fileName = safeDecodeURIComponent(pathOnly.split('/').pop());

      if (ASSET_ALIAS_MAP[fileName]) {
        fileName = ASSET_ALIAS_MAP[fileName];
      }

      const encodedFile = encodeURIComponent(fileName);
      return `${basePath}/media/${encodedFile}${queryOrHash || ''}`;
    } catch {
      return rawSrc;
    }
  }
  return rawSrc;
}

/**
 * Resolves srcset entries to repository-hosted media paths while preserving
 * descriptors (e.g. 2000w, 2x) and query parameters.
 * @param {string} srcset Raw srcset string
 * @param {string} basePath Base code path
 * @returns {string} Resolved srcset string
 */
export function resolveMediaSrcset(srcset, basePath = (typeof window !== 'undefined' && window.hlx?.codeBasePath) || '') {
  if (!srcset) return srcset;
  try {
    return srcset
      .split(',')
      .map((entry) => {
        const trimmed = entry.trim();
        if (!trimmed) return entry;
        const tokens = trimmed.split(/\s+/);
        if (tokens.length === 1) {
          return resolveMediaUrl(tokens[0], basePath);
        }
        const lastToken = tokens[tokens.length - 1];
        if (/^\d+(\.\d+)?[wx]$/i.test(lastToken)) {
          const url = tokens.slice(0, -1).join(' ');
          const resolved = resolveMediaUrl(url, basePath);
          return `${resolved} ${lastToken}`;
        }
        const url = tokens[0];
        const descriptor = tokens.slice(1).join(' ');
        const resolved = resolveMediaUrl(url, basePath);
        return descriptor ? `${resolved} ${descriptor}` : resolved;
      })
      .join(', ');
  } catch {
    return srcset;
  }
}

/**
 * Resolves We.Retail DAM asset references to repository-hosted media.
 * Normalizes JCR paths and maps whitespace-containing assets to URL-safe aliases.
 * @param {Element} main The main container element
 */
export function normalizeMediaSources(main) {
  const damPrefix = '/content/dam/we-retail/';
  const basePath = (typeof window !== 'undefined' && window.hlx?.codeBasePath) || '';

  try {
    main.querySelectorAll('img').forEach((img) => {
      try {
        const src = img.getAttribute('src');
        if (src && !isExternalMediaUrl(src) && (src.includes(damPrefix) || src.includes('El Gordo Green.jpg') || src.startsWith('/media/') || src.startsWith('media/'))) {
          if (src.includes(damPrefix) || src.includes('El Gordo Green.jpg')) {
            img.setAttribute('data-original-source', src);
          }
          img.src = resolveMediaUrl(src, basePath);
        }

        const srcset = img.getAttribute('srcset');
        if (srcset) {
          if (srcset.includes(damPrefix) || srcset.includes('El Gordo Green.jpg')) {
            img.setAttribute('data-original-source', srcset);
          }
          img.srcset = resolveMediaSrcset(srcset, basePath);
        }
      } catch {
        // Individual image failure must not halt processing
      }
    });

    main.querySelectorAll('source').forEach((source) => {
      try {
        const srcset = source.getAttribute('srcset');
        if (srcset) {
          if (srcset.includes(damPrefix) || srcset.includes('El Gordo Green.jpg')) {
            source.setAttribute('data-original-source', srcset);
          }
          source.srcset = resolveMediaSrcset(srcset, basePath);
        }
      } catch {
        // Individual source failure must not halt processing
      }
    });
  } catch {
    // Non-fatal: ensure entire page decoration process is never crashed
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  normalizeMediaSources(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('body > header'));

  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('body > footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  import('./consent-check.js');
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

if (!window.hlx?.suppressLoadPage) {
  loadPage();
}
