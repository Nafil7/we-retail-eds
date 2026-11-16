import assert from 'assert';

console.log('--- Running Columns Block Regression Test Suite ---');

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

const columnsModule = await import('../blocks/columns/columns.js');
const decorate = columnsModule.default;

// Test 1: Service Feature Columns (3 items with icon, heading, paragraph)
{
  const block = new MockNode('div');
  block.className = 'columns';

  const row = new MockNode('div');
  const services = [
    { icon: '/media/cart.png', title: 'Free delivery', desc: 'And free return' },
    { icon: '/media/tracking.png', title: 'Order tracking', desc: 'Worldwide shipping' },
    { icon: '/media/support.png', title: 'Online support', desc: 'With our outdoor specialist' }
  ];

  services.forEach(svc => {
    const col = new MockNode('div');
    const pic = new MockNode('picture');
    const img = new MockNode('img');
    img.setAttribute('src', svc.icon);
    pic.appendChild(img);

    const h4 = new MockNode('h4');
    h4.textContent = svc.title;

    const p = new MockNode('p');
    p.textContent = svc.desc;

    col.appendChild(pic);
    col.appendChild(h4);
    col.appendChild(p);
    row.appendChild(col);
  });

  block.appendChild(row);

  decorate(block);

  assert(row.classList.contains('columns-service-features'), 'Row must be identified as service features');
  assert.strictEqual(row.children.length, 3, 'Must maintain 3 columns');

  row.children.forEach((col, idx) => {
    assert(col.classList.contains('columns-col'), 'Col must have columns-col class');
    assert(col.classList.contains('has-icon-text'), 'Col must have has-icon-text class');
    const pic = col.querySelector('picture');
    assert(pic, 'Picture must remain in column');
    const textWrapper = col.querySelector('.columns-text');
    assert(textWrapper, 'Heading and description must be wrapped in .columns-text');
    assert.strictEqual(textWrapper.querySelector('h4').textContent, services[idx].title);
    assert.strictEqual(textWrapper.querySelector('p').textContent, services[idx].desc);
  });

  console.log('✓ Test 1 Passed: 3-column service features correctly grouped with .columns-text alongside icon.');
}

// Test 2: Community image-only columns (3 pictures, 0 text)
{
  const block = new MockNode('div');
  block.className = 'columns';

  const row = new MockNode('div');
  const images = ['/media/camp-summer-night.jpg', '/media/ice-climbing-group.jpg', '/media/group-mountain-bikers.jpg'];

  images.forEach(src => {
    const col = new MockNode('div');
    const pic = new MockNode('picture');
    const img = new MockNode('img');
    img.setAttribute('src', src);
    pic.appendChild(img);
    col.appendChild(pic);
    row.appendChild(col);
  });

  block.appendChild(row);

  decorate(block);

  assert(row.classList.contains('columns-images-only'), 'Row must be identified as image-only photo grid');
  assert.strictEqual(row.children.length, 3);

  row.children.forEach(col => {
    assert(col.classList.contains('has-image-only'), 'Col must have has-image-only class');
    assert.strictEqual(col.querySelector('.columns-text'), null, 'Image-only column must NOT have .columns-text wrapper');
    assert(col.querySelector('picture'), 'Picture must be preserved');
  });

  console.log('✓ Test 2 Passed: 3-column community images remain completely untouched and clean.');
}

// Test 3: Idempotency
{
  const block = new MockNode('div');
  block.className = 'columns';
  const row = new MockNode('div');
  const col = new MockNode('div');
  const pic = new MockNode('picture');
  const h4 = new MockNode('h4');
  h4.textContent = 'Free delivery';
  col.appendChild(pic);
  col.appendChild(h4);
  row.appendChild(col);
  block.appendChild(row);

  decorate(block);
  const firstColChildren = col.children.length;

  decorate(block);
  assert.strictEqual(col.children.length, firstColChildren, 'Repeated decoration must be idempotent');
  console.log('✓ Test 3 Passed: Idempotency confirmed.');
}

console.log('--- All 3 Columns Block Regression Tests Passed Successfully ---');
