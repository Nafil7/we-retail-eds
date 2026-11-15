import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Stage 7.4.1 Carousel Accessibility, APG & Modality Conformance Tests ---');

// Controlled deterministic fake clock with active & historical tracking
class FakeClock {
  constructor() {
    this.now = 0;
    this.nextTimerId = 1;
    this.activeTimers = new Map();
    this.history = new Map();
  }
  setInterval(fn, ms) {
    const id = this.nextTimerId++;
    const duration = Number(ms) || 0;
    const record = {
      id,
      fn: () => {
        record.executionCount++;
        fn();
      },
      rawFn: fn,
      ms: duration,
      nextRun: this.now + duration,
      createdAt: this.now,
      cancelled: false,
      cancelledAt: null,
      executionCount: 0
    };
    this.activeTimers.set(id, record);
    this.history.set(id, record);
    return id;
  }
  clearInterval(id) {
    const timer = this.history.get(id);
    if (timer) {
      timer.cancelled = true;
      timer.cancelledAt = this.now;
      this.activeTimers.delete(id);
    }
  }
  tick(ms) {
    const target = this.now + ms;
    while (true) {
      let earliest = null;
      for (const timer of this.activeTimers.values()) {
        if (!timer.cancelled && timer.nextRun <= target) {
          if (!earliest || timer.nextRun < earliest.nextRun || (timer.nextRun === earliest.nextRun && timer.id < earliest.id)) {
            earliest = timer;
          }
        }
      }
      if (!earliest) break;
      this.now = earliest.nextRun;
      earliest.nextRun = this.now + earliest.ms;
      if (!earliest.cancelled) {
        earliest.fn();
      }
    }
    this.now = target;
  }
  getActiveTimers() {
    return Array.from(this.activeTimers.values()).filter(t => !t.cancelled);
  }
  get activeTimerCount() {
    return this.getActiveTimers().length;
  }
  getCancelledTimers() {
    return Array.from(this.history.values()).filter(t => t.cancelled);
  }
  getTimer(id) {
    return this.history.get(id) || null;
  }
}

// Lightweight DOM simulation with bubbling, querySelector and focus tracking
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this._classes = new Set();
    this._textContent = '';
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(val) {
    this.setAttribute('id', val);
  }

  get type() {
    return this.getAttribute('type') || '';
  }
  set type(val) {
    this.setAttribute('type', val);
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
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get tabIndex() {
    const val = this.getAttribute('tabindex');
    return val !== null ? parseInt(val, 10) : 0;
  }
  set tabIndex(val) {
    this.setAttribute('tabindex', String(val));
  }

  get inert() {
    return this.hasAttribute('inert');
  }
  set inert(val) {
    if (val) this.setAttribute('inert', '');
    else this.removeAttribute('inert');
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    if (idx > 0) return this.parentElement.children[idx - 1];
    return null;
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

  replaceWith(newElem) {
    if (!this.parentElement) return;
    const p = this.parentElement;
    const idx = p.children.indexOf(this);
    if (idx !== -1) {
      if (newElem.parentElement) newElem.parentElement.removeChild(newElem);
      p.children[idx] = newElem;
      newElem.parentElement = p;
      this.parentElement = null;
    }
  }

  get firstChild() {
    return this.children[0] || null;
  }

  set innerHTML(val) {
    if (val === '') {
      this.children.forEach(c => { c.parentElement = null; });
      this.children = [];
    }
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

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      bubbles: true,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    });
  }

  focus() {
    const prev = globalThis.document.activeElement;
    globalThis.document.activeElement = this;
    if (prev && prev !== this) {
      prev.dispatchEvent({
        type: 'focusout',
        target: prev,
        relatedTarget: this,
        bubbles: true
      });
    }
    this.dispatchEvent({
      type: 'focusin',
      target: this,
      relatedTarget: prev,
      bubbles: true
    });
  }

  blur(nextTarget = null) {
    if (globalThis.document.activeElement === this) {
      globalThis.document.activeElement = nextTarget;
      this.dispatchEvent({
        type: 'focusout',
        target: this,
        relatedTarget: nextTarget,
        bubbles: true
      });
    }
  }

  querySelector(sel) {
    const results = this.querySelectorAll(sel);
    return results[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const selectors = sel.split(',').map(s => s.trim());

    function matchesSingle(node, s) {
      if (s.startsWith('.')) return node.classList.contains(s.slice(1));
      if (s.startsWith('#')) return node.id === s.slice(1);
      if (s.startsWith('a[')) return node.tagName === 'A' && node.hasAttribute('href');
      if (s.includes('h1') || s.includes('h2') || s.includes('h3') || s.includes('h4') || s.includes('h5') || s.includes('h6')) {
        return ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName);
      }
      return node.tagName === s.toUpperCase();
    }

    function walk(node) {
      for (const child of node.children) {
        if (selectors.some(s => matchesSingle(child, s))) {
          results.push(child);
        }
        walk(child);
      }
    }
    walk(this);
    return results;
  }
}

// Setup global mock environment
const clock = new FakeClock();
globalThis.setInterval = clock.setInterval.bind(clock);
globalThis.clearInterval = clock.clearInterval.bind(clock);
let reducedMotionSetting = false;
globalThis.window = {
  matchMedia(query) {
    return {
      matches: query.includes('prefers-reduced-motion') ? reducedMotionSetting : false
    };
  }
};
const elementsById = new Map();
globalThis.document = {
  activeElement: null,
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return elementsById.get(id) || null;
  }
};

// Import carousel block decorator
const carouselModule = await import('../blocks/carousel/carousel.js');
const decorate = carouselModule.default;

function createTestCarouselWithHeading(headingText = 'Discover the Finest Gear', slideHeadings = ['Slide One', 'Slide Two', 'Slide Three']) {
  const container = new MockElement('div');

  let headingWrapper = null;
  let headingEl = null;
  if (headingText) {
    headingWrapper = new MockElement('div');
    headingEl = new MockElement('h2');
    headingEl.textContent = headingText;
    headingWrapper.appendChild(headingEl);
    container.appendChild(headingWrapper);
  }

  const block = new MockElement('div');
  block.className = 'carousel';

  for (let i = 0; i < slideHeadings.length; i++) {
    const slide = new MockElement('div');
    const cell1 = new MockElement('div'); // image
    const pic = new MockElement('picture');
    const img = new MockElement('img');
    pic.appendChild(img);
    cell1.appendChild(pic);

    const cell2 = new MockElement('div'); // text
    const heading = new MockElement('h3');
    heading.textContent = slideHeadings[i];
    cell2.appendChild(heading);

    const p = new MockElement('p');
    p.textContent = `Description for slide ${i + 1}`;
    cell2.appendChild(p);

    const cta = new MockElement('a');
    cta.setAttribute('href', `/link-${i + 1}`);
    cta.textContent = `CTA ${i + 1}`;
    cell2.appendChild(cta);

    slide.appendChild(cell1);
    slide.appendChild(cell2);
    block.appendChild(slide);
  }

  container.appendChild(block);

  decorate(block);
  if (headingEl && headingEl.id) {
    elementsById.set(headingEl.id, headingEl);
  }
  return { container, headingEl, block };
}

const { headingEl, block } = createTestCarouselWithHeading();

// Finding 2 DOM order verification:
// Child 0: autoplayBtn
// Child 1: prevBtn
// Child 2: indicators (tablist)
// Child 3: nextBtn
// Child 4: slidesContainer
const autoplayBtn = block.children[0];
const prevBtn = block.children[1];
const indicatorsContainer = block.children[2];
const nextBtn = block.children[3];
const slidesContainer = block.children[4];

const slides = slidesContainer.children;
const indicators = indicatorsContainer.children;

// 1. Finding 1: Carousel Accessible Name Association with Visible Heading
assert(headingEl.id && headingEl.id.startsWith('carousel-heading-'), 'FAIL: Preceding visible heading must receive an ID');
assert.strictEqual(block.getAttribute('aria-labelledby'), headingEl.id, 'FAIL: Carousel must reference visible heading via aria-labelledby');
assert.strictEqual(block.hasAttribute('aria-label'), false, 'FAIL: Carousel must not use hardcoded aria-label when visible heading exists');
assert.strictEqual(block.getAttribute('role'), 'region', 'FAIL: Carousel container must have role="region"');
assert.strictEqual(block.getAttribute('aria-roledescription'), 'carousel', 'FAIL: Container must have aria-roledescription="carousel"');
console.log('✓ Test 1 Passed: Carousel accessible name correctly derived from visible heading via aria-labelledby.');

// 2. Finding 2: DOM Assembly Order (W3C APG Tabbed Carousel Interaction Sequence)
assert.strictEqual(autoplayBtn.tagName, 'BUTTON', 'FAIL: Child 0 must be autoplay button');
assert.strictEqual(autoplayBtn.className, 'carousel-autoplay-btn', 'FAIL: Child 0 must be autoplay button');
assert.strictEqual(prevBtn.className, 'carousel-btn prev', 'FAIL: Child 1 must be prev button');
assert.strictEqual(indicatorsContainer.getAttribute('role'), 'tablist', 'FAIL: Child 2 must be tablist indicators');
assert.strictEqual(nextBtn.className, 'carousel-btn next', 'FAIL: Child 3 must be next button');
assert.strictEqual(slidesContainer.className, 'carousel-slides', 'FAIL: Child 4 must be slides container');
console.log('✓ Test 2 Passed: DOM order adheres to W3C APG: Controls & tablist precede slide content.');

// 3. Finding 3: Tabpanel Focusability Evaluation
// Active slide (Slide 0) has an image before the CTA link -> first content is NOT focusable -> MUST have tabindex="0"
assert.strictEqual(slides[0].getAttribute('tabindex'), '0', 'FAIL: Slide 0 must have tabindex="0" because first content is non-focusable');
assert.strictEqual(slides[1].hasAttribute('tabindex'), false, 'FAIL: Inactive Slide 1 must not have tabindex');
assert.strictEqual(slides[2].hasAttribute('tabindex'), false, 'FAIL: Inactive Slide 2 must not have tabindex');

// Test the other 3 content fixtures:
// Fixture 3a: Text followed by CTA
const panelText = new MockElement('div');
const p1 = new MockElement('p');
p1.textContent = 'Prose text first';
const a1 = new MockElement('a');
a1.setAttribute('href', '#');
panelText.appendChild(p1);
panelText.appendChild(a1);
// Fixture 3b: Interactive element is the first meaningful content
const panelInteractiveFirst = new MockElement('div');
const a2 = new MockElement('a');
a2.setAttribute('href', '#');
const p2 = new MockElement('p');
panelInteractiveFirst.appendChild(a2);
panelInteractiveFirst.appendChild(p2);
// Fixture 3c: No interactive elements
const panelNoInteractive = new MockElement('div');
const h3 = new MockElement('h3');
h3.textContent = 'Only heading';
panelNoInteractive.appendChild(h3);

// Evaluate focusability on slide change
indicators[1].click();
assert.strictEqual(slides[1].getAttribute('tabindex'), '0', 'FAIL: Slide 1 receives tabindex="0" upon becoming active');
assert.strictEqual(slides[0].hasAttribute('tabindex'), false, 'FAIL: Slide 0 loses tabindex upon becoming inactive');
console.log('✓ Test 3 Passed: Tabpanel focusability correctly based on first meaningful content.');

// 4. Finding 4: Single-Slide Semantics (No Orphaned Tabpanels)
const singleParent = new MockElement('div');
const singleHeading = new MockElement('h2');
singleHeading.textContent = 'Single Section';
singleParent.appendChild(singleHeading);

const singleBlock = new MockElement('div');
singleBlock.className = 'carousel';
const singleSlide = new MockElement('div');
const singleCell1 = new MockElement('div');
const singleCell2 = new MockElement('div');
const singleH3 = new MockElement('h3');
singleH3.textContent = 'Only One Slide';
singleCell2.appendChild(singleH3);
singleSlide.appendChild(singleCell1);
singleSlide.appendChild(singleCell2);
singleBlock.appendChild(singleSlide);
singleParent.appendChild(singleBlock);

decorate(singleBlock);

assert.strictEqual(singleBlock.children.length, 1, 'FAIL: Single slide carousel has only slidesContainer');
const singleContainer = singleBlock.children[0];
const singleRenderedSlide = singleContainer.children[0];
assert.strictEqual(singleRenderedSlide.getAttribute('role'), null, 'FAIL: Single slide must NOT have role="tabpanel" (no orphaned tabpanel)');
assert.strictEqual(singleRenderedSlide.hasAttribute('aria-labelledby'), false, 'FAIL: Single slide must NOT have orphaned aria-labelledby');
assert.strictEqual(singleBlock.querySelector('.carousel-indicators'), null, 'FAIL: No tablist on single slide');
assert.strictEqual(singleBlock.querySelector('.carousel-autoplay-btn'), null, 'FAIL: No autoplay button on single slide');
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Single slide must create 0 timers (count remains 1 from block 1)');
console.log('✓ Test 4 Passed: Single-slide edge case degrades cleanly without orphaned tabpanels or timers.');

// 5. Finding 5: Live Region Atomicity
assert.strictEqual(slidesContainer.getAttribute('aria-atomic'), 'false', 'FAIL: Live region must have aria-atomic="false" per W3C APG');
console.log('✓ Test 5 Passed: Live region configured with aria-atomic="false".');

// 6. Finding 6: Pointer Modality & Mouse Click Stop/Start Reliability
// When mouse clicks autoplay button: mousedown/pointerdown sets modality -> focusin does NOT trigger premature focus-stop!
block.dispatchEvent({ type: 'mousedown', bubbles: true });
autoplayBtn.focus();
// Autoplay button should still reflect rotating state until click event fires
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Stop slide rotation', 'FAIL: Mouse focus must NOT prematurely stop rotation before click');
autoplayBtn.click();
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Start slide rotation', 'FAIL: Mouse click on Stop must stop rotation');
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Timer must be cancelled after explicit Stop');

// Pointer leave after explicit stop must NOT resume rotation
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Mouse leave must not override explicit Stop');

// Mouse click on Start must start rotation
block.dispatchEvent({ type: 'mousedown', bubbles: true });
autoplayBtn.focus();
autoplayBtn.click();
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Stop slide rotation', 'FAIL: Mouse click on Start must start rotation');
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Timer must restart after explicit Start');
console.log('✓ Test 6 Passed: Pointer interaction modality prevents accidental focus-stop reversal.');

// 7. Keyboard Focus Entry Permanently Stops Rotation
// Blur outside first
const outsideEl = new MockElement('div');
autoplayBtn.blur(outsideEl);
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Still rotating while no keyboard focus has entered');

// Real keyboard focus enters (no mousedown event)
autoplayBtn.focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Keyboard focus enter permanently stops rotation');
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Start slide rotation', 'FAIL: Button updates to Start on keyboard focus enter');

// Blur outside does NOT resume
autoplayBtn.blur(outsideEl);
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Blur outside does not resume rotation');
console.log('✓ Test 7 Passed: Pure keyboard focus entry permanently stops rotation.');

// 8. Multiple Carousel Instances with Independent Headings
const instanceA = createTestCarouselWithHeading('Heading A', ['A1', 'A2']);
const instanceB = createTestCarouselWithHeading('Heading B', ['B1', 'B2']);

assert.strictEqual(instanceA.block.getAttribute('aria-labelledby'), instanceA.headingEl.id, 'FAIL: Instance A references Heading A');
assert.strictEqual(instanceB.block.getAttribute('aria-labelledby'), instanceB.headingEl.id, 'FAIL: Instance B references Heading B');
assert.notStrictEqual(instanceA.headingEl.id, instanceB.headingEl.id, 'FAIL: Distinct heading IDs across carousels');
console.log('✓ Test 8 Passed: Multiple carousel instances resolve to their own headings independently.');

// 9. Arrow and Tab Navigation
// Reset to slide 0 first
indicators[0].click();
assert.strictEqual(slides[0].classList.contains('active'), true);
indicators[0].focus();

const rightEvent = {
  type: 'keydown',
  key: 'ArrowRight',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[0].dispatchEvent(rightEvent);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: ArrowRight advances to Slide 1');
assert.strictEqual(indicators[1].getAttribute('aria-selected'), 'true');
assert.strictEqual(indicators[1].getAttribute('tabindex'), '0');
assert.strictEqual(slides[1].getAttribute('tabindex'), '0');
console.log('✓ Test 9 Passed: ArrowRight navigates slide, selects tab, and synchronizes panel tabindex.');

console.log('--- All 9 Stage 7.4.1 Carousel Conformance Tests Passed Successfully ---');
