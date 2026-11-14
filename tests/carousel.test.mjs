import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Stage 7 Carousel Lifecycle & Behavior Regression Tests ---');

// Controlled deterministic fake clock
class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.intervals = new Map();
  }
  setInterval(fn, ms) {
    const id = this.nextId++;
    this.intervals.set(id, { fn, ms, lastFired: this.now });
    return id;
  }
  clearInterval(id) {
    this.intervals.delete(id);
  }
  tick(ms) {
    this.now += ms;
    for (const [id, item] of this.intervals.entries()) {
      while (this.now - item.lastFired >= item.ms) {
        item.lastFired += item.ms;
        item.fn();
      }
    }
  }
  get activeTimerCount() {
    return this.intervals.size;
  }
}

// Lightweight DOM simulation with full bubbling and focus tracking
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this._classes = new Set();
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
  removeAttribute(name) {
    this.attributes.delete(name);
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

  querySelectorAll(sel) {
    const results = [];
    const isClass = sel.startsWith('.');
    const isTag = !isClass;
    const query = isClass ? sel.slice(1) : sel.toUpperCase();

    function walk(node) {
      for (const child of node.children) {
        if (isClass && child.classList.contains(query)) results.push(child);
        else if (isTag && child.tagName === query) results.push(child);
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
globalThis.document = {
  activeElement: null,
  createElement(tag) {
    return new MockElement(tag);
  }
};

// Import carousel block decorator
const carouselModule = await import('../blocks/carousel/carousel.js');
const decorate = carouselModule.default;

function createTestCarousel() {
  const block = new MockElement('div');
  block.className = 'carousel';

  for (let i = 0; i < 3; i++) {
    const slide = new MockElement('div');
    const cell1 = new MockElement('div'); // image
    const cell2 = new MockElement('div'); // text
    const heading = new MockElement('h3');
    cell2.appendChild(heading);
    slide.appendChild(cell1);
    slide.appendChild(cell2);
    block.appendChild(slide);
  }

  decorate(block);
  return block;
}

const block = createTestCarousel();
const slidesContainer = block.children[0];
const slides = slidesContainer.children;
const prevBtn = block.children[1];
const nextBtn = block.children[2];
const indicatorsContainer = block.children[3];
const indicators = indicatorsContainer.children;

// 1. Initial slide state
assert.strictEqual(slides.length, 3, 'FAIL: Must create exactly 3 slides');
assert.strictEqual(indicators.length, 3, 'FAIL: Must create exactly 3 indicators');
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Slide 0 must be active initially');
assert.strictEqual(slides[0].getAttribute('aria-hidden'), 'false', 'FAIL: Slide 0 aria-hidden must be false');
assert.strictEqual(slides[1].getAttribute('aria-hidden'), 'true', 'FAIL: Slide 1 aria-hidden must be true');
assert.strictEqual(slides[2].getAttribute('aria-hidden'), 'true', 'FAIL: Slide 2 aria-hidden must be true');
assert.strictEqual(indicators[0].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 0 must be selected');
assert.strictEqual(indicators[1].getAttribute('aria-selected'), 'false', 'FAIL: Indicator 1 must not be selected');
assert.strictEqual(indicators[2].getAttribute('aria-selected'), 'false', 'FAIL: Indicator 2 must not be selected');
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Autoplay timer must be active initially');
console.log('✓ Test 1 Passed: Initial slide state and ARIA attributes verified.');

// 2. Indicator click navigation
indicators[1].click();
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide 1 must be active after click');
assert.strictEqual(slides[0].getAttribute('aria-hidden'), 'true', 'FAIL: Slide 0 must be hidden after click');
assert.strictEqual(indicators[1].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 1 must be selected');

indicators[2].click();
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Slide 2 must be active after click');
assert.strictEqual(indicators[2].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 2 must be selected');
console.log('✓ Test 2 Passed: Indicator click navigation verified.');

// 3. Previous and next controls
nextBtn.click(); // 2 -> 0 wrap-around
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Next button must wrap around to Slide 0');
assert.strictEqual(indicators[0].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 0 must be selected');

prevBtn.click(); // 0 -> 2 wrap-around
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Prev button must wrap around to Slide 2');
assert.strictEqual(indicators[2].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 2 must be selected');

prevBtn.click(); // 2 -> 1
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Prev button must move to Slide 1');
console.log('✓ Test 3 Passed: Previous and next controls with wrap-around verified.');

// 4. Keyboard navigation (ArrowRight and ArrowLeft on indicators)
// Focus reaches indicator 1
indicators[1].focus();
assert.strictEqual(globalThis.document.activeElement, indicators[1], 'FAIL: Keyboard focus must reach indicator 1');

// ArrowRight moves to slide 2
const rightEvent = {
  type: 'keydown',
  key: 'ArrowRight',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[1].dispatchEvent(rightEvent);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: ArrowRight must move to slide 2');
assert.strictEqual(slides[2].getAttribute('aria-hidden'), 'false', 'FAIL: Slide 2 aria-hidden must be false');
assert.strictEqual(indicators[2].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 2 must be aria-selected');

// ArrowLeft moves back to slide 1
const leftEvent = {
  type: 'keydown',
  key: 'ArrowLeft',
  bubbles: true,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
};
indicators[2].dispatchEvent(leftEvent);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: ArrowLeft must move to slide 1');
assert.strictEqual(indicators[1].getAttribute('aria-selected'), 'true', 'FAIL: Indicator 1 must be aria-selected');
console.log('✓ Test 4 Passed: Keyboard navigation (ArrowRight/ArrowLeft on indicators) verified.');

// 5. Correct focus management
assert.strictEqual(globalThis.document.activeElement, indicators[1], 'FAIL: Indicator 1 must have active focus after ArrowLeft');
indicators[1].dispatchEvent(rightEvent);
assert.strictEqual(globalThis.document.activeElement, indicators[2], 'FAIL: Focus must move to indicator 2 after ArrowRight');
console.log('✓ Test 5 Passed: Focus management between indicators verified.');

// 6. Autoplay after five seconds
// Reset focus and hover to test clean autoplay
const outsideEl = new MockElement('div');
indicators[2].blur(outsideEl);
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Autoplay timer must be running when neither focused nor hovered');

// Current slide is 2. Advancing 4999ms should not rotate yet
clock.tick(4999);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Slide 2 must remain active before 5000ms');

// At 5000ms, should advance to slide 0 (wrap-around)
clock.tick(1);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Autoplay must rotate to slide 0 at 5000ms');

// At 10000ms, should advance to slide 1
clock.tick(5000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Autoplay must rotate to slide 1 at 10000ms');
console.log('✓ Test 6 Passed: 5000ms autoplay interval verified.');

// 7. Pause on pointer hover
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Autoplay timer must be paused on pointer hover (mouseenter)');
clock.tick(10000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must not rotate while hovered');
console.log('✓ Test 7 Passed: Pause on pointer hover verified.');

// 8. Pause on keyboard focus
block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Autoplay timer must resume when mouse leaves');

// Focus into carousel control
prevBtn.focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Autoplay timer must be paused on keyboard focus (focusin)');
clock.tick(10000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must not rotate while keyboard focused');
console.log('✓ Test 8 Passed: Pause on keyboard focus verified.');

// 9. Focus movement between internal controls does not resume autoplay
// Move focus from prevBtn to nextBtn
nextBtn.focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Focus shift between internal controls must NOT resume autoplay');

// Move focus from nextBtn to indicator 0
indicators[0].focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Focus shift to indicator must NOT resume autoplay');
clock.tick(10000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must remain static while shifting focus internally');
console.log('✓ Test 9 Passed: Internal focus transitions do not resume autoplay.');

// 10. Pointer leaving while focus remains inside does not resume autoplay
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Pointer leave while keyboard focus is inside must NOT resume autoplay');
clock.tick(10000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must not rotate when pointer leaves while focused');
console.log('✓ Test 10 Passed: Pointer leaving while focus is retained does not resume autoplay.');

// 11. Focus leaving while pointer remains inside does not resume autoplay
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
indicators[0].blur(outsideEl); // focus moved outside, but pointer is still hovering
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Focus leaving while pointer is hovering must NOT resume autoplay');
clock.tick(10000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must not rotate when focus leaves while hovered');
console.log('✓ Test 11 Passed: Focus leaving while pointer is hovering does not resume autoplay.');

// 12. Autoplay resumes after both pointer and focus leave
block.dispatchEvent({ type: 'mouseleave', bubbles: false }); // pointer leaves now
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Autoplay timer must resume after both pointer and focus leave');

// Advance clock 5000ms: slide 1 -> slide 2
clock.tick(5000);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Autoplay must rotate to slide 2 after resuming');

// Advance clock 5000ms: slide 2 -> slide 0
clock.tick(5000);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Autoplay must rotate to slide 0 after resuming');
console.log('✓ Test 12 Passed: Autoplay resumes cleanly when neither pointer nor focus remain inside.');

console.log('--- All 12 Carousel Behavior & Lifecycle Tests Passed Successfully ---');
