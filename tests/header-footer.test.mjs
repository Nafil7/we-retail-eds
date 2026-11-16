import assert from 'assert';

console.log('--- Running Header & Footer Regression Test Suite ---');

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this._classes = new Set();
    this.listeners = new Map();
    this._value = '';
    this.nodeType = 1;
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }

  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
  }

  get className() {
    return [...this._classes].join(' ');
  }
  set className(val) {
    this._classes = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  get classList() {
    return {
      add: (...names) => names.forEach(n => n && this._classes.add(n)),
      remove: (...names) => names.forEach(n => this._classes.delete(n)),
      toggle: (n, force) => {
        if (force === undefined) {
          if (this._classes.has(n)) this._classes.delete(n);
          else this._classes.add(n);
        } else if (force) {
          this._classes.add(n);
        } else {
          this._classes.delete(n);
        }
      },
      contains: (n) => this._classes.has(n),
      toString: () => this.className
    };
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.toUpperCase() === curr.tagName || (selector.startsWith('.') && curr.classList.contains(selector.slice(1)))) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  contains(target) {
    let curr = target;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    if (!event.stopPropagation) event.stopPropagation = () => { };
    if (!event.preventDefault) event.preventDefault = () => { };
    event.currentTarget = this;
    const handlers = this.listeners.get(event.type) || [];
    for (const cb of handlers) {
      cb.call(this, event);
      if (event._stopImmediate) break;
    }
    if (event.bubbles && this.parentElement && !event._stop) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  focus() {
    globalThis.document.activeElement = this;
  }

  matches(node, sel) {
    let s = sel.trim();
    if (s.startsWith('a[')) {
      const roleMatch = s.match(/\[role="(.*?)"\]/);
      if (roleMatch && node.tagName === 'A') {
        return node.getAttribute('role') === roleMatch[1];
      }
    }
    const parts = s.split(/(?=[.#])/);
    for (const part of parts) {
      if (part.startsWith('.')) {
        if (!node.classList.contains(part.slice(1))) return false;
      } else if (part.startsWith('#')) {
        if (node.getAttribute('id') !== part.slice(1)) return false;
      } else if (part) {
        if (node.tagName !== part.toUpperCase()) return false;
      }
    }
    return true;
  }

  querySelector(sel) {
    const res = this.querySelectorAll(sel);
    return res[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const selectors = sel.split(',').map(s => s.trim());

    const walk = (node) => {
      for (const child of node.children) {
        if (selectors.some(s => this.matches(child, s))) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  set innerHTML(html) {
    // Parse simulated HTML structure for header/footer
    this.children = [];
    if (html.includes('we-header-utility')) {
      const utility = new MockElement('div');
      utility.className = 'we-header-utility';
      const container = new MockElement('div');
      container.className = 'we-header-container';

      const lang = new MockElement('div');
      lang.className = 'we-lang';
      const btn = new MockElement('button');
      btn.className = 'we-lang-btn';
      btn.id = 'we-lang-btn';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-controls', 'we-lang-menu');
      lang.appendChild(btn);

      const dropdown = new MockElement('div');
      dropdown.className = 'we-lang-dropdown';
      dropdown.id = 'we-lang-menu';
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-labelledby', 'we-lang-btn');

      const langs = ['en', 'es', 'ca-en', 'ca-fr', 'de', 'fr'];
      langs.forEach(code => {
        const a = new MockElement('a');
        a.setAttribute('role', 'menuitem');
        a.setAttribute('tabindex', '-1');
        a.setAttribute('href', `/content/we-retail/${code}.html`);
        dropdown.appendChild(a);
      });
      lang.appendChild(dropdown);
      container.appendChild(lang);
      utility.appendChild(container);
      this.appendChild(utility);

      const main = new MockElement('div');
      main.className = 'we-header-main';
      const mainContainer = new MockElement('div');
      mainContainer.className = 'we-header-container';
      const actions = new MockElement('div');
      actions.className = 'we-actions';

      const form = new MockElement('form');
      form.className = 'we-search-form';
      form.setAttribute('action', '/content/we-retail/us/en/search.html');
      form.setAttribute('method', 'get');
      form.setAttribute('role', 'search');

      const input = new MockElement('input');
      input.className = 'we-search-input';
      input.setAttribute('name', 'fulltext');
      form.appendChild(input);

      const searchBtn = new MockElement('button');
      searchBtn.className = 'we-search-btn';
      searchBtn.setAttribute('type', 'submit');
      form.appendChild(searchBtn);

      actions.appendChild(form);
      mainContainer.appendChild(actions);
      main.appendChild(mainContainer);
      this.appendChild(main);
    } else if (html.includes('we-footer')) {
      const footer = new MockElement('div');
      footer.className = 'we-footer';
      const copy = new MockElement('div');
      copy.className = 'we-footer-copy';

      const terms = new MockElement('a');
      terms.className = 'we-terms-link';
      terms.setAttribute('href', '#');
      terms.textContent = 'Terms of use & privacy policy';

      const ride = new MockElement('a');
      ride.className = 'we-ride-top';
      ride.setAttribute('href', '#top');
      ride.textContent = 'Ride to the top';

      copy.appendChild(terms);
      copy.appendChild(ride);
      footer.appendChild(copy);
      this.appendChild(footer);
    }
  }
}

const docListeners = new Map();
globalThis.document = {
  activeElement: null,
  addEventListener(type, cb) {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(cb);
  },
  dispatchEvent(event) {
    const list = docListeners.get(event.type) || [];
    for (const cb of list) cb(event);
  },
  getElementById(id) {
    if (id === 'top') return { id: 'top', scrollIntoView() { } };
    return null;
  }
};
globalThis.window = {
  history: { pushState() { } },
  scrollTo() { }
};

const headerModule = await import('../blocks/header/header.js');
const footerModule = await import('../blocks/footer/footer.js');
const decorateHeader = headerModule.default;
const decorateFooter = footerModule.default;

// Test 1: Header top anchor and ARIA menu roles
{
  const headerWrapper = new MockElement('header');
  const headerBlock = new MockElement('div');
  headerBlock.className = 'header';
  headerWrapper.appendChild(headerBlock);

  decorateHeader(headerBlock);

  assert.strictEqual(headerWrapper.id, 'top', 'Header must have id="top" for top anchor destination');

  const btn = headerBlock.querySelector('.we-lang-btn');
  const menu = headerBlock.querySelector('.we-lang-dropdown');
  assert.strictEqual(btn.getAttribute('aria-haspopup'), 'true');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(menu.getAttribute('role'), 'menu');
  assert.strictEqual(menu.querySelectorAll('a').length, 6);
  console.log('✓ Test 1 Passed: Header top anchor and language menu ARIA semantics verified.');
}

// Test 2: Language Selector Keyboard Navigation & Outside Click
{
  const headerBlock = new MockElement('div');
  headerBlock.className = 'header';
  decorateHeader(headerBlock);

  const btn = headerBlock.querySelector('.we-lang-btn');
  const lang = headerBlock.querySelector('.we-lang');
  const dropdown = headerBlock.querySelector('.we-lang-dropdown');
  const items = dropdown.querySelectorAll('a');

  // Click opens
  btn.dispatchEvent({ type: 'click', bubbles: true });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  assert(lang.classList.contains('open'));

  // Escape closes and restores focus to btn
  btn.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { } });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert(!lang.classList.contains('open'));
  assert.strictEqual(globalThis.document.activeElement, btn);

  // ArrowDown on button opens and focuses first item
  btn.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() { } });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(globalThis.document.activeElement, items[0]);

  // ArrowDown on first item focuses second item
  items[0].dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() { } });
  assert.strictEqual(globalThis.document.activeElement, items[1]);

  // ArrowUp on second item focuses first item
  items[1].dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault() { } });
  assert.strictEqual(globalThis.document.activeElement, items[0]);

  // End key focuses last item
  items[0].dispatchEvent({ type: 'keydown', key: 'End', preventDefault() { } });
  assert.strictEqual(globalThis.document.activeElement, items[items.length - 1]);

  // Home key focuses first item
  items[items.length - 1].dispatchEvent({ type: 'keydown', key: 'Home', preventDefault() { } });
  assert.strictEqual(globalThis.document.activeElement, items[0]);

  // Escape from inside menu closes and restores focus to btn
  items[0].dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { } });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(globalThis.document.activeElement, btn);

  // Outside click dismisses
  btn.dispatchEvent({ type: 'click', bubbles: true });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  const outsideNode = new MockElement('div');
  globalThis.document.dispatchEvent({ type: 'click', target: outsideNode });
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');

  console.log('✓ Test 2 Passed: Language selector APG keyboard navigation and dismissals verified.');
}

// Test 3: Search Functionality (Submit, Expand, Escape, Empty handling)
{
  const headerBlock = new MockElement('div');
  headerBlock.className = 'header';
  decorateHeader(headerBlock);

  const searchForm = headerBlock.querySelector('.we-search-form');
  const searchBtn = headerBlock.querySelector('.we-search-btn');
  const searchInput = headerBlock.querySelector('.we-search-input');

  assert.strictEqual(searchForm.getAttribute('action'), '/content/we-retail/us/en/search.html');
  assert.strictEqual(searchInput.getAttribute('name'), 'fulltext');

  // Click search button when closed expands form and focuses input
  searchBtn.dispatchEvent({ type: 'click', preventDefault() { } });
  assert(searchForm.classList.contains('active'));
  assert.strictEqual(globalThis.document.activeElement, searchInput);

  // Escape closes form and focuses search button
  searchInput.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { } });
  assert(!searchForm.classList.contains('active'));
  assert.strictEqual(globalThis.document.activeElement, searchBtn);

  // Reopen, click button with empty value -> closes form without submitting
  searchBtn.dispatchEvent({ type: 'click', preventDefault() { } });
  assert(searchForm.classList.contains('active'));
  searchInput.value = '';
  searchBtn.dispatchEvent({ type: 'click', preventDefault() { } });
  assert(!searchForm.classList.contains('active'));

  // Non-empty query submission via Enter / submit event
  searchBtn.dispatchEvent({ type: 'click', preventDefault() { } });
  assert(searchForm.classList.contains('active'));
  searchInput.value = 'hiking boots & jackets';
  let defaultPrevented = false;
  searchForm.dispatchEvent({
    type: 'submit',
    preventDefault() { defaultPrevented = true; }
  });
  assert.strictEqual(defaultPrevented, false, 'Non-empty search query must allow native GET submission to action URL');
  assert.strictEqual(searchInput.value, 'hiking boots & jackets', 'Query value must be preserved');
  assert.strictEqual(searchForm.getAttribute('action'), '/content/we-retail/us/en/search.html');
  assert.strictEqual(searchInput.getAttribute('name'), 'fulltext');

  console.log('✓ Test 3 Passed: Search expand, focus, empty handling, non-empty submit, and Escape verified.');
}

// Test 4: Footer Links (Terms of Use href="#" & Ride to the Top #top)
{
  const footerBlock = new MockElement('div');
  footerBlock.className = 'footer';
  decorateFooter(footerBlock);

  const termsLink = footerBlock.querySelector('.we-terms-link');
  assert(termsLink, 'Terms of use link must exist');
  assert.strictEqual(termsLink.getAttribute('href'), '#', 'Terms of use must preserve authoritative source href="#"');

  const rideTop = footerBlock.querySelector('.we-ride-top');
  assert(rideTop, 'Ride to the top link must exist');
  assert.strictEqual(rideTop.getAttribute('href'), '#top', 'Ride to the top must target #top');

  let scrolled = false;
  let pushedHash = '';
  globalThis.document.getElementById = (id) => {
    if (id === 'top') {
      return {
        id: 'top',
        scrollIntoView() { scrolled = true; }
      };
    }
    return null;
  };
  globalThis.window.history.pushState = (state, title, url) => {
    pushedHash = url;
  };

  rideTop.dispatchEvent({ type: 'click', preventDefault() { } });
  assert.strictEqual(scrolled, true, 'Clicking Ride to the top must scroll to top target element');
  assert.strictEqual(pushedHash, '#top', 'Clicking Ride to the top must update URL hash to #top');

  console.log('✓ Test 4 Passed: Footer Terms of Use and Ride to the Top verified.');
}

console.log('--- All 4 Header & Footer Regression Tests Passed Successfully ---');
