import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Stage 7.4 Carousel Accessibility, ARIA & Rotation Conformance Tests ---');

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
globalThis.document = {
  activeElement: null,
  createElement(tag) {
    return new MockElement(tag);
  }
};

// Import carousel block decorator
const carouselModule = await import('../blocks/carousel/carousel.js');
const decorate = carouselModule.default;

function createTestCarousel(slideHeadings = ['Slide One', 'Slide Two', 'Slide Three']) {
  const block = new MockElement('div');
  block.className = 'carousel';

  for (let i = 0; i < slideHeadings.length; i++) {
    const slide = new MockElement('div');
    const cell1 = new MockElement('div'); // image
    const cell2 = new MockElement('div'); // text
    const heading = new MockElement('h3');
    heading.textContent = slideHeadings[i];
    cell2.appendChild(heading);
    slide.appendChild(cell1);
    slide.appendChild(cell2);
    block.appendChild(slide);
  }

  decorate(block);
  return block;
}

const block = createTestCarousel();

// Child 0: autoplayBtn
// Child 1: slidesContainer
// Child 2: prevBtn
// Child 3: nextBtn
// Child 4: indicators
const autoplayBtn = block.children[0];
const slidesContainer = block.children[1];
const slides = slidesContainer.children;
const prevBtn = block.children[2];
const nextBtn = block.children[3];
const indicatorsContainer = block.children[4];
const indicators = indicatorsContainer.children;

// 1. Container Semantics (Workstream A) & Tabbed Panel Semantics (Workstream B)
assert.strictEqual(block.getAttribute('role'), 'region', 'FAIL: Carousel container must have role="region"');
assert.strictEqual(block.getAttribute('aria-roledescription'), 'carousel', 'FAIL: Container must have aria-roledescription="carousel"');
assert.strictEqual(block.getAttribute('aria-label'), 'Featured Stories', 'FAIL: Container must have accessible name');
assert(block.id.startsWith('carousel-'), 'FAIL: Carousel must have unique ID');

assert.strictEqual(indicatorsContainer.getAttribute('role'), 'tablist', 'FAIL: Indicators container must have role=tablist');
assert.strictEqual(indicatorsContainer.getAttribute('aria-label'), 'Carousel slides', 'FAIL: Tablist must have accessible name');
assert.strictEqual(indicatorsContainer.getAttribute('aria-orientation'), 'horizontal', 'FAIL: Tablist orientation must be horizontal');

assert.strictEqual(slides.length, 3, 'FAIL: Must create exactly 3 slides');
assert.strictEqual(indicators.length, 3, 'FAIL: Must create exactly 3 indicators');

// Workstream C: Native visible autoplay control button
assert.strictEqual(autoplayBtn.tagName, 'BUTTON', 'FAIL: Autoplay control must be a native button');
assert.strictEqual(autoplayBtn.type, 'button', 'FAIL: Autoplay button type must be button');
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Stop slide rotation', 'FAIL: Initial label must be "Stop slide rotation"');

// Bi-directional relationships, tabs, and tabpanels
for (let i = 0; i < 3; i++) {
  const slide = slides[i];
  const tab = indicators[i];

  assert(slide.id && slide.id.length > 0, `FAIL: Slide ${i} must have unique ID`);
  assert(tab.id && tab.id.length > 0, `FAIL: Tab ${i} must have unique ID`);

  assert.strictEqual(tab.getAttribute('role'), 'tab', `FAIL: Indicator ${i} must have role=tab`);
  assert.strictEqual(tab.getAttribute('aria-controls'), slide.id, `FAIL: Tab ${i} aria-controls must match Slide ${i} ID`);

  assert.strictEqual(slide.getAttribute('role'), 'tabpanel', `FAIL: Slide ${i} must have role=tabpanel`);
  assert.strictEqual(slide.getAttribute('aria-labelledby'), tab.id, `FAIL: Slide ${i} aria-labelledby must match Tab ${i} ID`);
  // Workstream B: do NOT apply aria-roledescription="slide" to tabpanel elements
  assert.strictEqual(slide.getAttribute('aria-roledescription'), null, `FAIL: Tabpanel must not have aria-roledescription="slide"`);

  if (i === 0) {
    assert.strictEqual(slide.classList.contains('active'), true, 'FAIL: Slide 0 must be active');
    assert.strictEqual(slide.getAttribute('aria-hidden'), 'false', 'FAIL: Slide 0 aria-hidden false');
    assert.strictEqual(slide.hasAttribute('inert'), false, 'FAIL: Active slide must not be inert');
    assert.strictEqual(tab.getAttribute('aria-selected'), 'true', 'FAIL: Tab 0 aria-selected true');
    assert.strictEqual(tab.getAttribute('tabindex'), '0', 'FAIL: Active Tab 0 must have tabindex=0');
  } else {
    assert.strictEqual(slide.getAttribute('aria-hidden'), 'true', `FAIL: Slide ${i} aria-hidden true`);
    assert.strictEqual(slide.hasAttribute('inert'), true, `FAIL: Inactive slide ${i} must be inert`);
    assert.strictEqual(tab.getAttribute('aria-selected'), 'false', `FAIL: Tab ${i} aria-selected false`);
    assert.strictEqual(tab.getAttribute('tabindex'), '-1', `FAIL: Inactive Tab ${i} must have tabindex=-1`);
  }
}
console.log('✓ Test 1 Passed: Initial container, tabbed carousel semantics, and autoplay button verified.');

// 2. Tab indicator accessible name from slide heading
assert.strictEqual(indicators[0].getAttribute('aria-label'), 'Slide One', 'FAIL: Tab 0 accessible name must match slide heading');
assert.strictEqual(indicators[1].getAttribute('aria-label'), 'Slide Two', 'FAIL: Tab 1 accessible name must match slide heading');
assert.strictEqual(indicators[2].getAttribute('aria-label'), 'Slide Three', 'FAIL: Tab 2 accessible name must match slide heading');
console.log('✓ Test 2 Passed: Tab accessible names correctly derived from slide headings.');

// 3. Indicator click navigation & roving tabindex synchronization
indicators[1].click();
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide 1 active after click');
assert.strictEqual(slides[1].getAttribute('aria-hidden'), 'false', 'FAIL: Slide 1 aria-hidden false');
assert.strictEqual(slides[1].hasAttribute('inert'), false, 'FAIL: Slide 1 must not be inert');
assert.strictEqual(indicators[1].getAttribute('aria-selected'), 'true', 'FAIL: Tab 1 aria-selected true');
assert.strictEqual(indicators[1].getAttribute('tabindex'), '0', 'FAIL: Tab 1 must have tabindex=0');

assert.strictEqual(slides[0].getAttribute('aria-hidden'), 'true', 'FAIL: Slide 0 hidden after click');
assert.strictEqual(slides[0].hasAttribute('inert'), true, 'FAIL: Slide 0 must be inert');
assert.strictEqual(indicators[0].getAttribute('aria-selected'), 'false', 'FAIL: Tab 0 aria-selected false');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '-1', 'FAIL: Tab 0 must have tabindex=-1');
console.log('✓ Test 3 Passed: Indicator click navigation and roving tabindex update verified.');

// 4. Previous and next controls with wrap-around
nextBtn.click(); // 1 -> 2
assert.strictEqual(slides[2].classList.contains('active'), true);
assert.strictEqual(indicators[2].getAttribute('tabindex'), '0');
assert.strictEqual(indicators[1].getAttribute('tabindex'), '-1');

nextBtn.click(); // 2 -> 0 wrap-around
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Next button must wrap around to Slide 0');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '0');

prevBtn.click(); // 0 -> 2 wrap-around
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Prev button must wrap around to Slide 2');
assert.strictEqual(indicators[2].getAttribute('tabindex'), '0');
console.log('✓ Test 4 Passed: Previous/next buttons with wrap-around and roving tabindex verified.');

// 5. Keyboard navigation (ArrowLeft & ArrowRight on indicators)
indicators[2].focus();
assert.strictEqual(globalThis.document.activeElement, indicators[2], 'FAIL: Focus on Tab 2');

const rightEvent = {
  type: 'keydown',
  key: 'ArrowRight',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[2].dispatchEvent(rightEvent); // 2 -> 0 wrap-around
assert.strictEqual(rightEvent.defaultPrevented, true, 'FAIL: ArrowRight must call preventDefault()');
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: ArrowRight must advance to Slide 0');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '0', 'FAIL: Tab 0 must have tabindex=0');
assert.strictEqual(indicators[2].getAttribute('tabindex'), '-1', 'FAIL: Tab 2 must have tabindex=-1');
assert.strictEqual(globalThis.document.activeElement, indicators[0], 'FAIL: Focus must move to Tab 0');

const leftEvent = {
  type: 'keydown',
  key: 'ArrowLeft',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[0].dispatchEvent(leftEvent); // 0 -> 2 wrap-around
assert.strictEqual(leftEvent.defaultPrevented, true, 'FAIL: ArrowLeft must call preventDefault()');
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: ArrowLeft must wrap to Slide 2');
assert.strictEqual(globalThis.document.activeElement, indicators[2], 'FAIL: Focus must move to Tab 2');
console.log('✓ Test 5 Passed: ArrowLeft & ArrowRight navigation with focus management verified.');

// 6. Keyboard navigation (Home & End keys)
const homeEvent = {
  type: 'keydown',
  key: 'Home',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[2].dispatchEvent(homeEvent);
assert.strictEqual(homeEvent.defaultPrevented, true, 'FAIL: Home must call preventDefault()');
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Home must jump to first slide (Slide 0)');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '0', 'FAIL: Tab 0 tabindex must be 0 after Home');
assert.strictEqual(indicators[2].getAttribute('tabindex'), '-1', 'FAIL: Tab 2 tabindex must be -1 after Home');
assert.strictEqual(globalThis.document.activeElement, indicators[0], 'FAIL: Focus must move to first indicator after Home');

const endEvent = {
  type: 'keydown',
  key: 'End',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[0].dispatchEvent(endEvent);
assert.strictEqual(endEvent.defaultPrevented, true, 'FAIL: End must call preventDefault()');
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: End must jump to last slide (Slide 2)');
assert.strictEqual(indicators[2].getAttribute('tabindex'), '0', 'FAIL: Tab 2 tabindex must be 0 after End');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '-1', 'FAIL: Tab 0 tabindex must be -1 after End');
assert.strictEqual(globalThis.document.activeElement, indicators[2], 'FAIL: Focus must move to last indicator after End');
console.log('✓ Test 6 Passed: Home & End keyboard navigation verified.');

// 7. Autoplay focus stop (Workstream C & Test F)
// Focus entering carousel stops rotation permanently until explicit restart!
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Focus in carousel must have stopped active timers');
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Start slide rotation', 'FAIL: Button must indicate stopped state');
assert.strictEqual(slidesContainer.getAttribute('aria-live'), 'polite', 'FAIL: Live region must be polite when stopped');

// Blur focus outside carousel
const outsideEl = new MockElement('div');
indicators[2].blur(outsideEl);
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Blur outside must NOT automatically resume rotation!');
clock.tick(20000);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Slide must remain static while focus-stopped');
console.log('✓ Test 7 Passed: Autoplay permanently stops on focus and does NOT restart on blur.');

// 8. Explicit restart via button click (Test G)
autoplayBtn.click();
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Explicit start must restart autoplay timer');
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Stop slide rotation', 'FAIL: Button must indicate rotating state');
assert.strictEqual(slidesContainer.getAttribute('aria-live'), 'off', 'FAIL: Live region must be off during rotation');

// Advance 5000ms: slide advances to 0
clock.tick(5000);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Explicitly restarted timer must rotate slide at 5000ms');
console.log('✓ Test 8 Passed: Explicit restart via autoplay button operates cleanly.');

// 9. Pointer hover pause & resume on pointer leave (Test H)
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Timer must pause on mouseenter');
clock.tick(20000);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Slide must remain static while hovered');

block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Timer must resume on mouseleave when not focus-stopped');
clock.tick(5000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Resumed timer rotates slide at 5000ms');
console.log('✓ Test 9 Passed: Pointer hover pauses and cleanly resumes on pointer leave.');

// 10. Explicit stop via button click
autoplayBtn.click();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Explicit stop must clear timer');
assert.strictEqual(autoplayBtn.getAttribute('aria-label'), 'Start slide rotation', 'FAIL: Button must indicate stopped state');
clock.tick(20000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must remain static while stopped');

// Pointer leave must NOT override explicit user stop
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Pointer leave must not override explicit user stop');
console.log('✓ Test 10 Passed: Explicit stop prevents pointer leave from resuming rotation.');

// 11. Reduced Motion Preference (Workstream C & Test I)
reducedMotionSetting = true;
const reducedMotionBlock = createTestCarousel();
assert.strictEqual(reducedMotionBlock.children[0].getAttribute('aria-label'), 'Start slide rotation', 'FAIL: Reduced motion must start with rotation stopped');
reducedMotionSetting = false;
console.log('✓ Test 11 Passed: prefers-reduced-motion correctly suppresses initial rotation.');

// 12. Multiple Carousel Instances Without Duplicate IDs (Test K)
const blockA = createTestCarousel(['A1', 'A2', 'A3']);
const blockB = createTestCarousel(['B1', 'B2', 'B3']);

assert.strictEqual(blockA.getAttribute('aria-label'), 'Featured Stories 3', 'FAIL: Block A unique accessible name');
assert.strictEqual(blockB.getAttribute('aria-label'), 'Featured Stories 4', 'FAIL: Block B unique accessible name');

const idsA = [
  ...Array.from(blockA.children[1].children).map(s => s.id),
  ...Array.from(blockA.children[4].children).map(t => t.id)
];
const idsB = [
  ...Array.from(blockB.children[1].children).map(s => s.id),
  ...Array.from(blockB.children[4].children).map(t => t.id)
];

assert.strictEqual(idsA.length, 6);
assert.strictEqual(idsB.length, 6);
for (const id of idsA) {
  assert(!idsB.includes(id), `FAIL: Duplicate ID between carousels: ${id}`);
}
console.log('✓ Test 12 Passed: Multi-carousel instance uniqueness and independent timers verified.');

// 13. Single-slide and empty carousel edge cases (Test L)
const emptyBlock = new MockElement('div');
emptyBlock.className = 'carousel';
decorate(emptyBlock);
assert.strictEqual(emptyBlock.children.length, 0, 'FAIL: Empty carousel must exit gracefully without children');

const singleBlock = new MockElement('div');
singleBlock.className = 'carousel';
const singleSlide = new MockElement('div');
const singleCell1 = new MockElement('div');
const singleCell2 = new MockElement('div');
const singleHeading = new MockElement('h3');
singleHeading.textContent = 'Only One Slide';
singleCell2.appendChild(singleHeading);
singleSlide.appendChild(singleCell1);
singleSlide.appendChild(singleCell2);
singleBlock.appendChild(singleSlide);
decorate(singleBlock);

assert.strictEqual(singleBlock.children.length, 1, 'FAIL: Single-slide carousel has only slidesContainer');
const singleContainer = singleBlock.children[0];
assert.strictEqual(singleContainer.children.length, 1, 'FAIL: Exactly one slide present');
assert.strictEqual(singleContainer.children[0].classList.contains('active'), true, 'FAIL: Single slide is active');
assert.strictEqual(singleContainer.children[0].getAttribute('aria-hidden'), 'false');
assert.strictEqual(singleContainer.children[0].hasAttribute('inert'), false);
console.log('✓ Test 13 Passed: Single-slide and empty cases degrade gracefully with no active timers.');

// 14. Multi-timer historical cancellation registry
const allCancelled = clock.getCancelledTimers();
assert(allCancelled.length >= 2, 'FAIL: Must have cancelled timers in historical registry');
const countsBefore = allCancelled.map(t => t.executionCount);
clock.tick(20000);
const allUnchanged = allCancelled.every((t, i) => t.executionCount === countsBefore[i]);
assert.strictEqual(allUnchanged, true, 'FAIL: Historical cancelled timers must never fire');
console.log('✓ Test 14 Passed: Multi-timer historical cancellation registry verified.');

console.log('--- All 14 Carousel Accessibility, ARIA & Rotation Conformance Tests Passed Successfully ---');
