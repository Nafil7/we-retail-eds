import assert from 'assert';

console.log('--- Running Hero Block Regression Test Suite ---');

class MockNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this._classes = new Set();
    this._textContent = '';
    this.nodeType = 1;
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join(' ');
  }
  set textContent(val) {
    this._textContent = val;
  }

  get className() {
    return [...this._classes].join(' ');
  }
  set className(val) {
    this._classes = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  set innerHTML(val) {
    if (val === '') {
      this.children.forEach(c => { c.parentElement = null; });
      this.children = [];
    }
  }

  get classList() {
    return {
      add: (...names) => names.forEach(n => n && this._classes.add(n)),
      remove: (...names) => names.forEach(n => this._classes.delete(n)),
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

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  replaceWith(newEl) {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1, newEl);
        newEl.parentElement = this.parentElement;
        this.parentElement = null;
      }
    }
  }

  get childNodes() {
    return [...this.children];
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

  matches(node, sel) {
    let s = sel.trim();
    if (s.includes(':not(')) {
      const match = s.match(/^(.*?):not\((.*?)\)$/);
      if (match) {
        const base = match[1];
        const notCond = match[2];
        return (base === '' || this.matches(node, base)) && !this.matches(node, notCond);
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
}

globalThis.document = {
  createElement(tag) {
    return new MockNode(tag);
  }
};

const heroModule = await import('../blocks/hero/hero.js');
const decorate = heroModule.default;

// Test 1: Shape 1 — Single row with multiple cells (migrated page markup)
{
  const block = new MockNode('div');
  block.className = 'hero';

  const row = new MockNode('div');
  const cell0 = new MockNode('div');
  const pic = new MockNode('picture');
  const img = new MockNode('img');
  img.setAttribute('src', '/media/trekker-khumbu-valley.jpg');
  img.setAttribute('alt', 'Built for the coldest winter on earth');
  pic.appendChild(img);
  cell0.appendChild(pic);

  const cell1 = new MockNode('div');
  const h1 = new MockNode('h1');
  h1.textContent = 'Built for the coldest winter on earth';
  cell1.appendChild(h1);

  const cell2 = new MockNode('div');
  const pSubtitle = new MockNode('p');
  pSubtitle.textContent = 'All-new winter collection';
  cell2.appendChild(pSubtitle);

  const cell3 = new MockNode('div');
  const pCta = new MockNode('p');
  const a = new MockNode('a');
  a.setAttribute('href', '/content/we-retail/us/en/products/equipment/snow-sports.html');
  a.textContent = 'Shop Now';
  pCta.appendChild(a);
  cell3.appendChild(pCta);

  row.appendChild(cell0);
  row.appendChild(cell1);
  row.appendChild(cell2);
  row.appendChild(cell3);
  block.appendChild(row);

  decorate(block);

  assert.strictEqual(block.children.length, 2, 'Hero block must have exactly 2 top-level children: hero-image and hero-content');
  assert.strictEqual(block.children[0].className, 'hero-image');
  assert.strictEqual(block.children[1].className, 'hero-content');

  const content = block.children[1];
  assert(content.querySelector('h1'), 'h1 must be preserved');
  assert.strictEqual(content.querySelector('h1').textContent, 'Built for the coldest winter on earth');
  assert(content.querySelector('p'), 'subtitle paragraph must be preserved');
  assert(content.querySelector('a.button.primary'), 'CTA anchor must be upgraded to button primary');
  assert.strictEqual(content.querySelector('a').textContent, 'Shop Now');
  console.log('✓ Test 1 Passed: Single-row multi-cell markup shape correctly decorated.');
}

// Test 2: Shape 2 — Multi-row layout (Row 0 = picture, Row 1 = content)
{
  const block = new MockNode('div');
  block.className = 'hero';

  const row0 = new MockNode('div');
  const picCell = new MockNode('div');
  const pic = new MockNode('picture');
  const img = new MockNode('img');
  pic.appendChild(img);
  picCell.appendChild(pic);
  row0.appendChild(picCell);

  const row1 = new MockNode('div');
  const contentCell = new MockNode('div');
  const h2 = new MockNode('h2');
  h2.textContent = 'Experiences';
  const p = new MockNode('p');
  p.textContent = 'Inspiring stories from around the world';
  contentCell.appendChild(h2);
  contentCell.appendChild(p);
  row1.appendChild(contentCell);

  block.appendChild(row0);
  block.appendChild(row1);

  decorate(block);

  assert.strictEqual(block.children.length, 2);
  const content = block.children[1];
  assert(content.querySelector('h2'), 'h2 heading must be preserved');
  assert.strictEqual(content.querySelector('h2').textContent, 'Experiences');
  assert.strictEqual(content.querySelector('p').textContent, 'Inspiring stories from around the world');
  console.log('✓ Test 2 Passed: Multi-row markup shape preserved completely.');
}

// Test 3: Shape 3 — Standalone CTA anchor (no wrapping paragraph)
{
  const block = new MockNode('div');
  block.className = 'hero';

  const row = new MockNode('div');
  const cell0 = new MockNode('div');
  const img = new MockNode('img');
  cell0.appendChild(img);

  const cell1 = new MockNode('div');
  const h1 = new MockNode('h1');
  h1.textContent = 'Adventure Awaits';
  const standaloneA = new MockNode('a');
  standaloneA.setAttribute('href', '/explore');
  standaloneA.textContent = 'Discover';
  cell1.appendChild(h1);
  cell1.appendChild(standaloneA);
  row.appendChild(cell0);
  row.appendChild(cell1);
  block.appendChild(row);

  decorate(block);

  const content = block.children[1];
  const btn = content.querySelector('a.button.primary');
  assert(btn, 'Standalone anchor must be given button.primary');
  assert.strictEqual(btn.parentElement.className, 'button-wrapper', 'Standalone anchor must be wrapped in button-wrapper');
  console.log('✓ Test 3 Passed: Standalone anchors wrapped in button-wrapper with button classes.');
}

// Test 4: Shape 4 — Non-standard authored elements (lists, blockquotes, divs)
{
  const block = new MockNode('div');
  block.className = 'hero';

  const row = new MockNode('div');
  const cell0 = new MockNode('div');
  const pic = new MockNode('picture');
  cell0.appendChild(pic);

  const cell1 = new MockNode('div');
  const h1 = new MockNode('h1');
  h1.textContent = 'Technical Equipment';
  const ul = new MockNode('ul');
  const li1 = new MockNode('li');
  li1.textContent = 'Weatherproof';
  const li2 = new MockNode('li');
  li2.textContent = 'Lightweight';
  ul.appendChild(li1);
  ul.appendChild(li2);
  cell1.appendChild(h1);
  cell1.appendChild(ul);
  row.appendChild(cell0);
  row.appendChild(cell1);
  block.appendChild(row);

  decorate(block);

  const content = block.children[1];
  assert(content.querySelector('ul'), 'Lists and non-heading content must be preserved without loss');
  assert.strictEqual(content.querySelectorAll('li').length, 2);
  console.log('✓ Test 4 Passed: Non-standard authored elements preserved without content loss.');
}

// Test 5: Idempotency
{
  const block = new MockNode('div');
  block.className = 'hero';
  const row = new MockNode('div');
  const cell = new MockNode('div');
  const h1 = new MockNode('h1');
  h1.textContent = 'Winter Gear';
  cell.appendChild(h1);
  row.appendChild(cell);
  block.appendChild(row);

  decorate(block);
  const firstChildren = [...block.children];
  const firstContent = block.querySelector('.hero-content').children.length;

  // Run a second time
  decorate(block);
  assert.strictEqual(block.children.length, firstChildren.length, 'Idempotency guard must prevent duplicate children');
  assert.strictEqual(block.querySelector('.hero-content').children.length, firstContent, 'Idempotency guard must prevent duplicate content');
  console.log('✓ Test 5 Passed: Idempotency confirmed across repeated executions.');
}

console.log('--- All 5 Hero Block Regression Tests Passed Successfully ---');
