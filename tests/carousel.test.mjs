import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Stage 7.3 Carousel ARIA, Accessibility & Timing Regression Tests ---');

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

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(val) {
    this.setAttribute('id', val);
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

// 1. Initial slide state & ARIA Semantics (WAI-ARIA Tabs pattern)
assert.strictEqual(indicatorsContainer.getAttribute('role'), 'tablist', 'FAIL: Indicators container must have role=tablist');
assert.strictEqual(indicatorsContainer.getAttribute('aria-label'), 'Carousel slides', 'FAIL: Tablist must have accessible name');
assert.strictEqual(indicatorsContainer.getAttribute('aria-orientation'), 'horizontal', 'FAIL: Tablist orientation must be horizontal');

assert.strictEqual(slides.length, 3, 'FAIL: Must create exactly 3 slides');
assert.strictEqual(indicators.length, 3, 'FAIL: Must create exactly 3 indicators');

// Bi-directional relationships and roving tabindex
for (let i = 0; i < 3; i++) {
  const slide = slides[i];
  const tab = indicators[i];

  assert(slide.id && slide.id.length > 0, `FAIL: Slide ${i} must have unique ID`);
  assert(tab.id && tab.id.length > 0, `FAIL: Tab ${i} must have unique ID`);

  assert.strictEqual(tab.getAttribute('role'), 'tab', `FAIL: Indicator ${i} must have role=tab`);
  assert.strictEqual(tab.getAttribute('aria-controls'), slide.id, `FAIL: Tab ${i} aria-controls must match Slide ${i} ID`);

  assert.strictEqual(slide.getAttribute('role'), 'tabpanel', `FAIL: Slide ${i} must have role=tabpanel`);
  assert.strictEqual(slide.getAttribute('aria-labelledby'), tab.id, `FAIL: Slide ${i} aria-labelledby must match Tab ${i} ID`);
  assert.strictEqual(slide.getAttribute('aria-roledescription'), 'slide', `FAIL: Slide ${i} aria-roledescription`);

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
console.log('✓ Test 1 Passed: Initial ARIA semantics, bi-directional relationships, and roving tabindex verified.');

// 2. Indicator click navigation & roving tabindex synchronization
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
console.log('✓ Test 2 Passed: Indicator click navigation and roving tabindex update verified.');

// 3. Previous and next controls with wrap-around
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
console.log('✓ Test 3 Passed: Previous/next buttons with wrap-around and roving tabindex verified.');

// 4. Keyboard navigation (ArrowLeft & ArrowRight on indicators)
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
console.log('✓ Test 4 Passed: ArrowLeft & ArrowRight navigation with focus management verified.');

// 5. Keyboard navigation (Home & End keys)
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
console.log('✓ Test 5 Passed: Home & End keyboard navigation verified.');

// Blur outside so block 1 is active (no focus)
const outsideEl = new MockElement('div');
indicators[2].blur(outsideEl);
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Block 1 must have 1 active timer when blurred outside');

// 6. Multiple Carousel Instances Without Duplicate IDs
const block2 = createTestCarousel();
const block2Slides = block2.children[0].children;
const block2Indicators = block2.children[3].children;

const allIdsInstance1 = [
  ...Array.from(slides).map(s => s.id),
  ...Array.from(indicators).map(t => t.id)
];
const allIdsInstance2 = [
  ...Array.from(block2Slides).map(s => s.id),
  ...Array.from(block2Indicators).map(t => t.id)
];

assert.strictEqual(allIdsInstance1.length, 6, 'FAIL: Instance 1 must have 6 IDs');
assert.strictEqual(allIdsInstance2.length, 6, 'FAIL: Instance 2 must have 6 IDs');

for (const id of allIdsInstance1) {
  assert(!allIdsInstance2.includes(id), `FAIL: ID collision detected: ${id} exists in both carousel instances`);
}

// Each carousel instance runs its own independent autoplay timer
assert.strictEqual(clock.activeTimerCount, 2, 'FAIL: Two carousels must have 2 active timers (1 each)');
// Pause block 2 so remaining timing tests focus purely on block 1
block2.dispatchEvent({ type: 'mouseenter', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Pausing block 2 leaves exactly 1 active timer for block 1');
console.log('✓ Test 6 Passed: Multi-carousel instance uniqueness (no duplicate IDs) & independent timers verified.');

// 7. Autoplay timing and lifecycle regression

// Baseline time
const baseTime = clock.now;
const activeTimers = clock.getActiveTimers();
assert.strictEqual(activeTimers.length, 1, 'FAIL: Exactly one autoplay timer active');
const currentTimer = activeTimers[0];
assert.strictEqual(currentTimer.ms, 5000, 'FAIL: Autoplay duration must be exactly 5000ms');

// Advance 4999ms: slide should not advance
clock.tick(4999);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Slide must remain static before 5000ms');

// Advance 1ms: slide advances to 0
clock.tick(1);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Slide must advance to 0 at 5000ms');
assert.strictEqual(indicators[0].getAttribute('tabindex'), '0', 'FAIL: Autoplay must update roving tabindex');

// Advance 5000ms: slide advances to 1
clock.tick(5000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must advance to 1 at 10000ms');
console.log('✓ Test 7 Passed: 5000ms autoplay interval and roving tabindex sync verified.');

// 8. Hover pause & cancelled timer verification
const timerCountBeforeHover = currentTimer.executionCount;
block.dispatchEvent({ type: 'mouseenter', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Timer must pause on mouseenter');
assert.strictEqual(currentTimer.cancelled, true, 'FAIL: Current timer must be cancelled on hover');

clock.tick(20000);
assert.strictEqual(currentTimer.executionCount, timerCountBeforeHover, 'FAIL: Cancelled timer must not execute across 20000ms');
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Slide must remain static while paused');
console.log('✓ Test 8 Passed: Pointer hover pause and cancelled-timer inactivity verified.');

// 9. Resuming after hover
block.dispatchEvent({ type: 'mouseleave', bubbles: false });
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Timer must resume on mouseleave');
const resumedTimer = clock.getActiveTimers()[0];
assert.notStrictEqual(resumedTimer.id, currentTimer.id, 'FAIL: Resumed timer must be a new instance');

clock.tick(4999);
assert.strictEqual(slides[1].classList.contains('active'), true);
clock.tick(1);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Resumed timer must advance slide at 5000ms');
console.log('✓ Test 9 Passed: Autoplay resume after hover verified.');

// 10. Focus pause & internal focus transitions
prevBtn.focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Timer must pause on keyboard focus');
nextBtn.focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Shifting focus internally must not resume timer');
indicators[0].focus();
assert.strictEqual(clock.activeTimerCount, 0, 'FAIL: Shifting focus to indicator must not resume timer');

clock.tick(20000);
assert.strictEqual(slides[2].classList.contains('active'), true, 'FAIL: Slide must not rotate during internal focus shifts');
console.log('✓ Test 10 Passed: Focus pause and internal control navigation verified.');

// 11. Multi-timer cancellation audit
const allCancelled = clock.getCancelledTimers();
assert(allCancelled.length >= 2, 'FAIL: Must have multiple cancelled timers in historical registry');
const countsBefore = allCancelled.map(t => t.executionCount);
clock.tick(20000);
const allUnchanged = allCancelled.every((t, i) => t.executionCount === countsBefore[i]);
assert.strictEqual(allUnchanged, true, 'FAIL: Historical cancelled timers must never fire');
console.log('✓ Test 11 Passed: Multi-timer historical cancellation registry verified.');

// 12. Final resume when pointer and focus both leave
indicators[0].blur(outsideEl); // focus leaves
block.dispatchEvent({ type: 'mouseleave', bubbles: false }); // pointer leaves
assert.strictEqual(clock.activeTimerCount, 1, 'FAIL: Timer resumes when both leave');
clock.tick(5000);
assert.strictEqual(slides[0].classList.contains('active'), true, 'FAIL: Autoplay rotates to slide 0 after full resume');
clock.tick(5000);
assert.strictEqual(slides[1].classList.contains('active'), true, 'FAIL: Autoplay rotates to slide 1 after next interval');
console.log('✓ Test 12 Passed: Clean resume after both pointer and focus leave verified.');

console.log('--- All 12 Carousel Accessibility, ARIA & Timing Tests Passed Successfully ---');
