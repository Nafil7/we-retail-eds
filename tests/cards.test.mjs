import assert from 'assert';
import decorateCards from '../blocks/cards/cards.js';

console.log('--- Running Cards Block Regression Test Suite ---');

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
    if (val === '') {
      this.children = [];
    }
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
      contains: (n) => this._classes.has(n),
      toString: () => this.className
    };
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach(n => this.appendChild(n));
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  contains(target) {
    let curr = target;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  matches(node, sel) {
    let s = sel.trim();
    if (s.includes(',')) {
      return s.split(',').some(part => this.matches(node, part.trim()));
    }
    if (s.startsWith('.')) {
      return node.classList.contains(s.slice(1));
    }
    if (s.includes('[href*="')) {
      const match = s.match(/\[href\*="([^"]+)"\]/);
      if (match && node.getAttribute('href')?.includes(match[1])) return true;
    }
    return node.tagName === s.toUpperCase();
  }

  querySelector(sel) {
    const res = this.querySelectorAll(sel);
    return res[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (this.matches(child, sel)) {
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
  createElement: (tag) => new MockNode(tag)
};

// Test 1: Product Grid Classification and Structure
{
  const block = new MockNode('div');
  block.className = 'cards';

  // 6 product rows
  for (let i = 1; i <= 6; i++) {
    const row = new MockNode('div');
    const imgCol = new MockNode('div');
    const img = new MockNode('img');
    img.setAttribute('src', `/media/product-${i}.jpg`);
    imgCol.appendChild(img);

    const bodyCol = new MockNode('div');
    const h3 = new MockNode('h3');
    h3.textContent = `Product ${i}`;
    const priceP = new MockNode('p');
    priceP.className = 'price';
    priceP.textContent = `$${i * 10}.00`;
    const ctaP = new MockNode('p');
    const a = new MockNode('a');
    a.setAttribute('href', `/content/we-retail/us/en/products/item-${i}.html`);
    a.textContent = 'View Product →';
    ctaP.appendChild(a);

    bodyCol.appendChild(h3);
    bodyCol.appendChild(priceP);
    bodyCol.appendChild(ctaP);

    row.appendChild(imgCol);
    row.appendChild(bodyCol);
    block.appendChild(row);
  }

  decorateCards(block);

  assert(block.classList.contains('cards-products'), 'Must classify as .cards-products');
  assert(!block.classList.contains('cards-stories'), 'Must not classify as .cards-stories');
  assert(block.classList.contains('cards-decorated'), 'Must have .cards-decorated');

  const ul = block.querySelector('ul');
  assert(ul, 'Must wrap items in <ul>');
  const lis = ul.querySelectorAll('li');
  assert.strictEqual(lis.length, 6, 'Must preserve all 6 product cards');

  lis.forEach(li => {
    assert(li.querySelector('.cards-card-image'), 'Card must have .cards-card-image');
    assert(li.querySelector('.cards-card-body'), 'Card must have .cards-card-body');
  });

  console.log('✓ Test 1 Passed: Product cards classified as .cards-products with 6-item ul/li structure.');
}

// Test 2: Story Grid Classification and Structure
{
  const block = new MockNode('div');
  block.className = 'cards';

  // 6 story rows
  for (let i = 1; i <= 6; i++) {
    const row = new MockNode('div');
    const imgCol = new MockNode('div');
    const img = new MockNode('img');
    img.setAttribute('src', `/media/story-${i}.jpg`);
    imgCol.appendChild(img);

    const bodyCol = new MockNode('div');
    const h3 = new MockNode('h3');
    h3.textContent = `Story Title ${i}`;
    const ctaP = new MockNode('p');
    const a = new MockNode('a');
    a.setAttribute('href', `/content/we-retail/us/en/experience/story-${i}.html`);
    a.textContent = 'Read More →';
    ctaP.appendChild(a);

    bodyCol.appendChild(h3);
    bodyCol.appendChild(ctaP);

    row.appendChild(imgCol);
    row.appendChild(bodyCol);
    block.appendChild(row);
  }

  decorateCards(block);

  assert(block.classList.contains('cards-stories'), 'Must classify as .cards-stories');
  assert(!block.classList.contains('cards-products'), 'Must not classify as .cards-products');
  const lis = block.querySelectorAll('li');
  assert.strictEqual(lis.length, 6, 'Must preserve all 6 story cards');

  console.log('✓ Test 2 Passed: Story cards classified as .cards-stories with 6-item ul/li structure.');
}

// Test 3: Idempotency
{
  const block = new MockNode('div');
  block.className = 'cards cards-decorated';
  const dummyUl = new MockNode('ul');
  block.appendChild(dummyUl);

  decorateCards(block);
  assert.strictEqual(block.children.length, 1);
  assert.strictEqual(block.children[0], dummyUl);
  console.log('✓ Test 3 Passed: Idempotency confirmed.');
}

console.log('--- All 3 Cards Block Regression Tests Passed Successfully ---');

