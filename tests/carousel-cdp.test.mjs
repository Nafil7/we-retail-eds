import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const edsRoot = path.resolve(__dirname, '..');
const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function startServer(port = 8996) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/rendered-migrated-page.html';
      const filePath = path.join(edsRoot, reqPath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  async sendKey(key, code, vk, modifiers = 0) {
    const text = key === 'Enter' ? '\r' : (key === ' ' ? ' ' : undefined);
    await this.send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      text,
      modifiers
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    });
    await new Promise(r => setTimeout(r, 60));
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });
    await new Promise(r => setTimeout(r, 60));
  }

  async mouseClick(x, y) {
    await this.mouseMove(x, y);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await new Promise(r => setTimeout(r, 50));
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await new Promise(r => setTimeout(r, 60));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('--- Starting Stage 7.4.2 Real Browser CDP Conformance & APG Verification ---');
  const server = await startServer(8996);
  console.log('HTTP Server listening on http://127.0.0.1:8996');

  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cdp-742-'));
  const chromeProc = spawn(chromeExe, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${tempProfileDir}`,
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  let versionData = null;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9223/json/version');
      if (r.ok) {
        versionData = await r.json();
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  if (!versionData) {
    throw new Error('Chrome remote debugging did not respond on port 9223');
  }

  console.log(`Browser: ${versionData.Browser}`);
  console.log(`User-Agent: ${versionData['User-Agent']}`);

  const targetsRes = await fetch('http://127.0.0.1:9223/json/list');
  const targets = await targetsRes.json();
  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // STEP 1: In-Page Browser Test Suite Execution
  console.log('\n--- Step 1: Executing In-Page Browser Test Suite ---');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/tests/carousel-browser-test.html' });

  let testDone = false;
  for (let i = 0; i < 50; i++) {
    testDone = await cdp.eval('window.__CAROUSEL_TESTS_DONE === true');
    if (testDone) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const results = await cdp.eval('window.__CAROUSEL_TEST_RESULTS');
  console.log(`In-Page Tests Passed: ${results.passed}/${results.total}`);
  if (!results.allPassed) {
    console.error('Failed in-page assertions:', results.log.filter(l => !l.pass));
    throw new Error('In-page carousel test suite had failures');
  }
  console.log(`✓ In-Page Browser Test Suite: 100% Passed (${results.passed}/${results.total} assertions)`);

  // STEP 2: Real Browser Keystroke & Mouse Automation on rendered-migrated-page.html
  console.log('\n--- Step 2: Executing Real-Browser Keystroke & Pointer Automation (Findings A, B & Stage 7.4.2 Requirements) ---');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  // 1. Finding 1: Accessible name verification (associated visible heading)
  console.log('\nVerifying Finding 1: Accessible Name Association with Visible Heading');
  const carouselNameInfo = await cdp.eval(`(() => {
    const c = document.querySelector('.carousel');
    const labelledby = c.getAttribute('aria-labelledby');
    const heading = labelledby ? document.getElementById(labelledby) : null;
    return {
      role: c.getAttribute('role'),
      roledescription: c.getAttribute('aria-roledescription'),
      ariaLabelledby: labelledby,
      ariaLabel: c.getAttribute('aria-label'),
      headingText: heading ? heading.textContent.trim() : null
    };
  })()`);
  console.log('Carousel container semantics:', carouselNameInfo);
  if (carouselNameInfo.headingText !== 'Discover the Finest Gear') {
    throw new Error(`Finding 1 Failed: Expected heading 'Discover the Finest Gear', got '${carouselNameInfo.headingText}'`);
  }
  if (carouselNameInfo.ariaLabel !== null) {
    throw new Error(`Finding 1 Failed: aria-label should be null when aria-labelledby is used, got '${carouselNameInfo.ariaLabel}'`);
  }
  console.log('✓ Finding 1 Passed: Carousel correctly linked to visible heading "Discover the Finest Gear" via aria-labelledby.');

  // 2. Finding A / Test A: Correct Keyboard Tab Sequence and Tablist Exit
  console.log('\nVerifying Finding A / Test A: Keyboard Tab Sequence and Tablist Exit');
  await cdp.eval('window.scrollTo(0, 0); document.body.focus();');

  const tabSequence = [];
  for (let t = 0; t < 60; t++) {
    await cdp.sendKey('Tab', 'Tab', 9);
    const active = await cdp.eval(`(() => {
      const el = document.activeElement;
      const inCarousel = document.querySelector('.carousel')?.contains(el);
      return {
        inCarousel,
        tag: el?.tagName,
        className: el?.className,
        role: el?.getAttribute('role'),
        label: el?.getAttribute('aria-label') || el?.textContent?.trim()
      };
    })()`);
    if (active.inCarousel) {
      tabSequence.push(active);
      // Stop when focus moves past slide content
      if (active.tag === 'A' && active.label?.includes('Women')) {
        break;
      }
    }
  }

  console.log('Observed keyboard tab sequence in carousel:');
  tabSequence.forEach((step, idx) => {
    console.log(`  ${idx + 1}. [${step.tag}] class="${step.className}" role="${step.role}" label="${step.label?.slice(0, 30)}"`);
  });

  // Required sequence:
  // 1. Autoplay control
  // 2. Previous button
  // 3. Next button
  // 4. Tablist active tab
  // 5. Active tabpanel
  // 6. Active slide CTA
  if (!tabSequence[0]?.className?.includes('carousel-autoplay-btn')) {
    throw new Error('Finding A Failed: Autoplay button is not 1st in tab sequence');
  }
  if (!tabSequence[1]?.className?.includes('prev')) {
    throw new Error('Finding A Failed: Prev button is not 2nd in tab sequence');
  }
  if (!tabSequence[2]?.className?.includes('next')) {
    throw new Error('Finding A Failed: Next button is not 3rd in tab sequence');
  }
  if (tabSequence[3]?.role !== 'tab') {
    throw new Error('Finding A Failed: Tablist indicator is not 4th in tab sequence');
  }
  if (tabSequence[4]?.role !== 'tabpanel') {
    throw new Error('Finding A Failed: Active slide tabpanel is not 5th in tab sequence');
  }
  if (tabSequence[5]?.tag !== 'A' || !tabSequence[5]?.label?.includes('Women')) {
    throw new Error('Finding A Failed: Slide CTA link is not 6th in tab sequence');
  }
  console.log('✓ Finding A Tab Sequence Passed: Sequence strictly adheres to W3C APG Tabbed Carousel order.');

  // Test A continued: Tablist Exit & Reverse Shift+Tab traversal
  console.log('\nVerifying Test A: Tablist Exit & Shift+Tab Traversal');
  // Focus active indicator (Child 3)
  await cdp.eval('document.querySelector(".carousel-indicator.active").focus()');
  // Press Tab from active tab: MUST move to active tabpanel, NOT to Next button!
  await cdp.sendKey('Tab', 'Tab', 9);
  const afterTabActive = await cdp.eval(`(() => {
    const el = document.activeElement;
    return {
      className: el?.className,
      role: el?.getAttribute('role'),
      tabIndex: el?.getAttribute('tabindex')
    };
  })()`);
  console.log('Element focused after Tab on active tab:', afterTabActive);
  if (afterTabActive.className?.includes('next')) {
    throw new Error('Finding A Failed: Tab from active tab moved to Next button instead of active slide!');
  }
  if (afterTabActive.role !== 'tabpanel') {
    throw new Error(`Finding A Failed: Expected active tabpanel, got role='${afterTabActive.role}', class='${afterTabActive.className}'`);
  }
  console.log('✓ Tab from active tab cleanly moves to active tabpanel.');

  // Press Tab again to reach slide CTA
  await cdp.sendKey('Tab', 'Tab', 9);
  const afterTabCTA = await cdp.eval('document.activeElement?.tagName');
  if (afterTabCTA !== 'A') {
    throw new Error(`Finding A Failed: Expected CTA link 'A', got ${afterTabCTA}`);
  }

  // Reverse Shift+Tab traversal:
  // From CTA -> Shift+Tab -> active tabpanel
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  let reversedRole = await cdp.eval('document.activeElement?.getAttribute("role")');
  if (reversedRole !== 'tabpanel') {
    throw new Error(`Reverse traversal failed: Expected active tabpanel, got ${reversedRole}`);
  }

  // From active tabpanel -> Shift+Tab -> active tab
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  reversedRole = await cdp.eval('document.activeElement?.getAttribute("role")');
  if (reversedRole !== 'tab') {
    throw new Error(`Reverse traversal failed: Expected active tab, got ${reversedRole}`);
  }

  // From active tab -> Shift+Tab -> Next button
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  let reversedClass = await cdp.eval('document.activeElement?.className');
  if (!reversedClass?.includes('next')) {
    throw new Error(`Reverse traversal failed: Expected Next button, got ${reversedClass}`);
  }

  // From Next button -> Shift+Tab -> Prev button
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  reversedClass = await cdp.eval('document.activeElement?.className');
  if (!reversedClass?.includes('prev')) {
    throw new Error(`Reverse traversal failed: Expected Prev button, got ${reversedClass}`);
  }

  // From Prev button -> Shift+Tab -> Autoplay button
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  reversedClass = await cdp.eval('document.activeElement?.className');
  if (!reversedClass?.includes('carousel-autoplay-btn')) {
    throw new Error(`Reverse traversal failed: Expected Autoplay button, got ${reversedClass}`);
  }
  console.log('✓ Test A Passed: Clean forward tablist exit to slide and full reverse Shift+Tab traversal.');

  // 3. Test B: Stale Pointer Modality Regression
  console.log('\nVerifying Test B: Stale Pointer Modality Regression');
  // Load a fresh page with autoplay running
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  let initialAutoplayLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Initial autoplay label on fresh page:', initialAutoplayLabel);
  if (initialAutoplayLabel !== 'Stop slide rotation') {
    throw new Error('Test B Failed: Carousel was not rotating initially');
  }

  // Move pointer to non-focusable part of the carousel slide (e.g. image area above caption)
  await cdp.eval('document.querySelector(".carousel").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));

  const nonFocusableBox = await cdp.eval(`(() => {
    const img = document.querySelector('.carousel-slide.active img');
    const rect = img.getBoundingClientRect();
    return { x: Math.round(rect.left + 100), y: Math.round(rect.top + 100) };
  })()`);

  console.log('Clicking non-focusable slide image with mouse pointer...');
  await cdp.mouseClick(nonFocusableBox.x, nonFocusableBox.y);

  const activeTagAfterPointer = await cdp.eval('document.activeElement?.tagName');
  console.log('Active element tag after pointer click on non-focusable element:', activeTagAfterPointer);

  // Move pointer outside carousel
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  await new Promise(r => setTimeout(r, 100));

  // Position keyboard focus on element immediately preceding the carousel (.hero a)
  await cdp.eval(`(() => {
    const heroLink = document.querySelector('.hero a');
    if (heroLink) heroLink.focus();
    else { window.scrollTo(0, 0); }
  })()`);

  // Use real keyboard Tab input to enter the carousel
  console.log('Navigating into carousel via real keyboard Tab input...');
  await cdp.sendKey('Tab', 'Tab', 9);

  const focusedElementInCarousel = await cdp.eval(`(() => {
    const el = document.activeElement;
    return {
      tagName: el?.tagName,
      className: el?.className,
      label: el?.getAttribute('aria-label') || el?.textContent?.trim()
    };
  })()`);
  console.log('Focused element in carousel after keyboard Tab:', focusedElementInCarousel);
  if (!focusedElementInCarousel.className?.includes('carousel-autoplay-btn')) {
    throw new Error(`Test B Failed: Expected focus on autoplay button, got ${focusedElementInCarousel.className}`);
  }

  // Verify autoplay stops immediately on keyboard focus
  const labelAfterKeyboardFocus = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after keyboard focus entry:', labelAfterKeyboardFocus);
  if (labelAfterKeyboardFocus !== 'Start slide rotation') {
    throw new Error(`Test B Failed: Stale pointer interaction prevented keyboard focus from stopping rotation! (Label: '${labelAfterKeyboardFocus}')`);
  }

  // Wait beyond one autoplay interval (6 seconds) and confirm slide does not advance
  console.log('Waiting 6s to confirm rotation stays stopped after keyboard focus entry...');
  await new Promise(r => setTimeout(r, 6000));
  const activeSlideAfterWait = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after 6s wait:', activeSlideAfterWait);
  if (!activeSlideAfterWait?.includes('never stop')) {
    throw new Error('Test B Failed: Slide rotated despite keyboard focus entry stopping rotation!');
  }
  console.log('✓ Test B Passed: Stale pointer modality regression completely resolved; keyboard focus stops rotation.');

  // 4. Test C: Mouse Stop and Start
  console.log('\nVerifying Test C: Mouse Stop and Start');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  await cdp.eval('document.querySelector(".carousel-autoplay-btn").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));

  let btnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel-autoplay-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);

  initialAutoplayLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  if (initialAutoplayLabel !== 'Stop slide rotation') throw new Error('Test C Failed: Initial rotation was not active');

  // Click Stop with mouse
  console.log('Activating Stop with real CDP mouse input...');
  await cdp.mouseClick(btnBox.x, btnBox.y);
  let afterStopLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after mouse click Stop:', afterStopLabel);
  if (afterStopLabel !== 'Start slide rotation') {
    throw new Error(`Test C Failed: Clicking Stop resulted in '${afterStopLabel}' instead of 'Start slide rotation'`);
  }

  // Move mouse away to confirm departure does not resume
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Waiting 6s to confirm rotation remains stopped after mouse departure...');
  await new Promise(r => setTimeout(r, 6000));
  let slideAfterStop = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after 6s:', slideAfterStop);
  if (!slideAfterStop?.includes('never stop')) {
    throw new Error('Test C Failed: Mouse departure restarted rotation after explicit Stop!');
  }

  // Activate Start with mouse input
  await cdp.eval('document.querySelector(".carousel-autoplay-btn").scrollIntoView();');
  await new Promise(r => setTimeout(r, 200));
  btnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel-autoplay-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);

  console.log('Activating Start with real CDP mouse input...');
  await cdp.mouseClick(btnBox.x, btnBox.y);
  let afterStartLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after mouse click Start:', afterStartLabel);
  if (afterStartLabel !== 'Stop slide rotation') {
    throw new Error(`Test C Failed: Clicking Start resulted in '${afterStartLabel}' instead of 'Stop slide rotation'`);
  }

  // Move pointer away and verify slide advances at 5000ms
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Waiting 5.5s to confirm restarted rotation advances slide at configured interval...');
  await new Promise(r => setTimeout(r, 5500));
  let advancedSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after 5.5s:', advancedSlide);
  if (!advancedSlide?.includes('challenge the elements')) {
    throw new Error('Test C Failed: Explicit restart did not advance slide!');
  }
  console.log('✓ Test C Passed: Mouse Stop and Start verified with real CDP mouse input.');

  // 5. Test D: Keyboard Stop and Start (Enter and Space Keys)
  console.log('\nVerifying Test D: Keyboard Stop and Start (Enter and Space Keys)');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  await cdp.eval(`(() => {
    const heroLink = document.querySelector('.hero a');
    if (heroLink) heroLink.focus();
    else { window.scrollTo(0, 0); }
  })()`);
  await cdp.sendKey('Tab', 'Tab', 9);

  let labelOnFocus = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Autoplay button label upon keyboard Tab focus:', labelOnFocus);
  if (labelOnFocus !== 'Start slide rotation') {
    throw new Error(`Test D Failed: Keyboard focus entry did not stop rotation (label: '${labelOnFocus}')`);
  }

  // Press Enter key to activate Start
  console.log('Pressing Enter key on focused rotation button to activate Start...');
  await cdp.sendKey('Enter', 'Enter', 13);
  let labelAfterEnter = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after Enter key:', labelAfterEnter);
  if (labelAfterEnter !== 'Stop slide rotation') {
    throw new Error(`Test D Failed: Enter key did not start rotation (label: '${labelAfterEnter}')`);
  }

  // Verify rotation actually runs
  console.log('Waiting 5.5s to confirm Enter-started rotation advances slide...');
  await new Promise(r => setTimeout(r, 5500));
  let slideAfterEnter = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after Enter restart:', slideAfterEnter);
  if (!slideAfterEnter?.includes('challenge the elements')) {
    throw new Error('Test D Failed: Rotation did not advance after Enter key activation!');
  }

  // Refocus autoplay button and press Space key to activate Stop
  await cdp.eval('document.querySelector(".carousel-autoplay-btn").focus();');
  console.log('Pressing Space key on focused rotation button to activate Stop...');
  await cdp.sendKey(' ', 'Space', 32);
  let labelAfterSpace = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after Space key:', labelAfterSpace);
  if (labelAfterSpace !== 'Start slide rotation') {
    throw new Error(`Test D Failed: Space key did not stop rotation (label: '${labelAfterSpace}')`);
  }

  // Confirm rotation stays stopped
  console.log('Waiting 6s to confirm Space-stopped rotation stays stopped...');
  await new Promise(r => setTimeout(r, 6000));
  let slideAfterSpace = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after Space stop wait:', slideAfterSpace);
  if (!slideAfterSpace?.includes('challenge the elements')) {
    throw new Error('Test D Failed: Slide advanced despite Space key stop!');
  }
  console.log('✓ Test D Passed: Keyboard Enter (Start) and Space (Stop) verified with real browser keystrokes.');

  // 6. Test E: Existing Behavior (Arrow Navigation, Wrap-Around, Home/End, Hover, Reduced Motion)
  console.log('\nVerifying Test E: Existing Behavior (Arrow Keys, Wrap-around, Home/End, Hover, Reduced Motion)');
  // Focus active indicator
  await cdp.eval('document.querySelector(".carousel-indicator.active").focus()');
  await cdp.sendKey('ArrowRight', 'ArrowRight', 39);
  let activeSlideHeading = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  let focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  let panelTabIndex = await cdp.eval('document.querySelector(".carousel-slide.active")?.getAttribute("tabindex")');
  console.log(`ArrowRight 1 -> Slide: "${activeSlideHeading}", Tab: "${focusedTabName}", Panel tabindex: "${panelTabIndex}"`);
  if (!focusedTabName?.includes('want the strongest') || panelTabIndex !== '0') {
    throw new Error('Arrow navigation failed on step 1');
  }

  // Wrap around to slide 0
  await cdp.sendKey('ArrowRight', 'ArrowRight', 39);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`ArrowRight 2 (wrap-around) -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('never stop')) throw new Error('ArrowRight wrap-around failed');

  // Wrap around left to last slide
  await cdp.sendKey('ArrowLeft', 'ArrowLeft', 37);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`ArrowLeft (wrap-around) -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('want the strongest')) throw new Error('ArrowLeft wrap-around failed');

  // Home key
  await cdp.sendKey('Home', 'Home', 36);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`Home key -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('never stop')) throw new Error('Home key failed');

  // End key
  await cdp.sendKey('End', 'End', 35);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`End key -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('want the strongest')) throw new Error('End key failed');
  console.log('✓ Arrow, Wrap-around, Home and End navigation fully verified.');

  // Pointer hover pause and resume
  console.log('\nVerifying Pointer hover pause & resume');
  // First restart rotation via mouse on Start
  await cdp.eval('document.querySelector(".carousel-autoplay-btn").scrollIntoView();');
  await new Promise(r => setTimeout(r, 200));
  btnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel-autoplay-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await cdp.mouseClick(btnBox.x, btnBox.y);

  // Move pointer outside carousel first so subsequent move enters from outside
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  await new Promise(r => setTimeout(r, 200));

  // Now enter carousel from outside
  await cdp.eval('document.querySelector(".carousel").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));
  const carouselBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await cdp.mouseMove(carouselBox.x, carouselBox.y);
  console.log('Pointer hovering over carousel. Waiting 6s to confirm slide remains paused during hover...');
  await new Promise(r => setTimeout(r, 6000));
  let hoveredSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide during hover pause:', hoveredSlide);
  if (!hoveredSlide?.includes('want the strongest')) {
    throw new Error('Hover pause failed: Slide rotated during hover!');
  }

  // Move pointer outside
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Pointer moved outside. Waiting 5.5s to confirm resume...');
  await new Promise(r => setTimeout(r, 5500));
  let resumedSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after resume:', resumedSlide);
  if (!resumedSlide?.includes('never stop')) {
    throw new Error('Resume failed after pointer departure');
  }
  console.log('✓ Pointer Hover: Pauses on enter, resumes on leave.');

  // Reduced motion preference
  console.log('\nVerifying prefers-reduced-motion preference');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  let reducedLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label under prefers-reduced-motion:', reducedLabel);
  if (reducedLabel !== 'Start slide rotation') {
    throw new Error('prefers-reduced-motion failed: initial rotation was not suppressed');
  }
  await new Promise(r => setTimeout(r, 6000));
  let reducedSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  if (!reducedSlide?.includes('never stop')) {
    throw new Error('Slide rotated under prefers-reduced-motion');
  }
  console.log('✓ Reduced Motion: Automatic rotation cleanly suppressed on load.');

  // Cleanup
  console.log('\n--- Shutting Down Test Environment ---');
  cdp.close();
  try {
    chromeProc.kill();
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
  await new Promise(resolve => server.close(resolve));
  try {
    fs.rmSync(tempProfileDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
  console.log('All real browser CDP conformance tests passed successfully!');
}

run().catch((err) => {
  console.error('CDP test failed:', err);
  process.exit(1);
});
