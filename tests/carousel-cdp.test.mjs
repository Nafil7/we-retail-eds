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
  console.log('--- Starting Stage 7.4.1 Real Browser CDP Conformance & APG Verification ---');
  const server = await startServer(8996);
  console.log('HTTP Server listening on http://127.0.0.1:8996');

  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cdp-741-'));
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
  console.log('\n--- Step 2: Executing Real-Browser Keystroke & Pointer Automation (Findings 1-7) ---');
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

  // 2. Finding 2: Tab Sequence (Controls and Tablist Precede Slide Content)
  console.log('\nVerifying Finding 2: Keyboard Tab Sequence');
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

  // Verify order: Autoplay button -> Previous button -> Tab indicator -> Next button -> Slide panel -> Slide CTA link
  if (!tabSequence[0]?.className?.includes('carousel-autoplay-btn')) {
    throw new Error('Finding 2 Failed: Autoplay button is not 1st in tab sequence');
  }
  if (!tabSequence[1]?.className?.includes('prev')) {
    throw new Error('Finding 2 Failed: Prev button is not 2nd in tab sequence');
  }
  if (tabSequence[2]?.role !== 'tab') {
    throw new Error('Finding 2 Failed: Tablist indicator is not 3rd in tab sequence');
  }
  if (!tabSequence[3]?.className?.includes('next')) {
    throw new Error('Finding 2 Failed: Next button is not 4th in tab sequence');
  }
  if (tabSequence[4]?.role !== 'tabpanel') {
    throw new Error('Finding 2 Failed: Slide tabpanel is not 5th in tab sequence');
  }
  if (tabSequence[5]?.tag !== 'A' || !tabSequence[5]?.label?.includes('Women')) {
    throw new Error('Finding 2 Failed: Slide CTA link is not 6th in tab sequence');
  }
  console.log('✓ Finding 2 Passed: Tab sequence strictly adheres to W3C APG Tabbed Carousel order.');

  // 3. Tablist exit and reverse Shift+Tab traversal
  console.log('\nVerifying Tablist exit & Shift+Tab traversal');
  // Focus active indicator (step 3)
  await cdp.eval('document.querySelector(".carousel-indicator.active").focus()');
  await cdp.sendKey('Tab', 'Tab', 9);
  const afterTabRole = await cdp.eval('document.activeElement?.className');
  if (afterTabRole !== 'carousel-btn next') {
    throw new Error(`Tab exit failed: Expected next button, got ${afterTabRole}`);
  }
  await cdp.sendKey('Tab', 'Tab', 9, 8); // Shift+Tab
  const reversedRole = await cdp.eval('document.activeElement?.getAttribute("role")');
  if (reversedRole !== 'tab') {
    throw new Error(`Reverse traversal failed: Expected tab, got ${reversedRole}`);
  }
  console.log('✓ Tablist Exit & Reverse: Verified clean single-stop tab traversal with no keyboard traps.');

  // 4. Arrow navigation with focus and tabpanel tabindex synchronization
  console.log('\nVerifying Arrow navigation & Panel tabindex synchronization');
  // Currently on Tab 0
  await cdp.sendKey('ArrowRight', 'ArrowRight', 39);
  let activeSlideHeading = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  let focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  let panelTabIndex = await cdp.eval('document.querySelector(".carousel-slide.active")?.getAttribute("tabindex")');
  console.log(`ArrowRight 1 -> Slide: "${activeSlideHeading}", Tab: "${focusedTabName}", Panel tabindex: "${panelTabIndex}"`);
  if (!focusedTabName?.includes('challenge the elements') || panelTabIndex !== '0') {
    throw new Error('Arrow navigation failed on step 1');
  }

  await cdp.sendKey('ArrowRight', 'ArrowRight', 39);
  activeSlideHeading = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  panelTabIndex = await cdp.eval('document.querySelector(".carousel-slide.active")?.getAttribute("tabindex")');
  console.log(`ArrowRight 2 -> Slide: "${activeSlideHeading}", Tab: "${focusedTabName}", Panel tabindex: "${panelTabIndex}"`);
  if (!focusedTabName?.includes('want the strongest') || panelTabIndex !== '0') {
    throw new Error('Arrow navigation failed on step 2');
  }

  // Wrap around
  await cdp.sendKey('ArrowRight', 'ArrowRight', 39);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`ArrowRight 3 (wrap-around) -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('never stop')) throw new Error('ArrowRight wrap-around failed');

  await cdp.sendKey('ArrowLeft', 'ArrowLeft', 37);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`ArrowLeft (wrap-around) -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('want the strongest')) throw new Error('ArrowLeft wrap-around failed');
  console.log('✓ Arrow Navigation & Wrap-around: Fully verified with active panel synchronization.');

  // 5. Home and End navigation
  console.log('\nVerifying Home and End navigation');
  await cdp.sendKey('Home', 'Home', 36);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`Home key -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('never stop')) throw new Error('Home key failed');

  await cdp.sendKey('End', 'End', 35);
  focusedTabName = await cdp.eval('document.activeElement?.getAttribute("aria-label")');
  console.log(`End key -> Tab: "${focusedTabName}"`);
  if (!focusedTabName?.includes('want the strongest')) throw new Error('End key failed');
  console.log('✓ Home & End Navigation: Successfully verified.');

  // 6. Finding 6: Mouse Click on Stop (Does not trigger accidental start)
  console.log('\nVerifying Finding 6: Mouse Click on Stop / Start (Interaction Modality)');
  // Reload page so rotation is active
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8996/rendered-migrated-page.html' });
  await new Promise(r => setTimeout(r, 600));

  await cdp.eval('document.querySelector(".carousel-autoplay-btn").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));

  let btnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel-autoplay-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);

  let initialBtnLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Initial button label on load:', initialBtnLabel);
  if (initialBtnLabel !== 'Stop slide rotation') throw new Error('Initial rotation was not active');

  // Click Stop with mouse
  console.log('Clicking Stop button with mouse pointer...');
  await cdp.mouseClick(btnBox.x, btnBox.y);
  let afterStopLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after mouse click Stop:', afterStopLabel);
  if (afterStopLabel !== 'Start slide rotation') {
    throw new Error(`Finding 6 Failed: Clicking Stop resulted in '${afterStopLabel}' instead of 'Start slide rotation'`);
  }

  // Move mouse away to ensure pointer departure does not resume
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Waiting 6s to confirm rotation stays stopped after mouse leave...');
  await new Promise(r => setTimeout(r, 6000));
  let slideAfterMouseLeave = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after 6s:', slideAfterMouseLeave);
  if (!slideAfterMouseLeave?.includes('never stop')) {
    throw new Error('Finding 6 Failed: Mouse leave restarted rotation after explicit Stop!');
  }
  console.log('✓ Finding 6 (Stop): Mouse click on Stop actually stops rotation and stays stopped.');

  // Click Start with mouse
  await cdp.eval('document.querySelector(".carousel-autoplay-btn").scrollIntoView();');
  await new Promise(r => setTimeout(r, 200));
  btnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel-autoplay-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  console.log('Clicking Start button with mouse pointer...');
  await cdp.mouseClick(btnBox.x, btnBox.y);
  let afterStartLabel = await cdp.eval('document.querySelector(".carousel-autoplay-btn")?.getAttribute("aria-label")');
  console.log('Button label after mouse click Start:', afterStartLabel);
  if (afterStartLabel !== 'Stop slide rotation') {
    throw new Error(`Finding 6 Failed: Clicking Start resulted in '${afterStartLabel}' instead of 'Stop slide rotation'`);
  }
  // Move pointer away and verify slide advances at 5000ms
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Waiting 5.5s to confirm restarted rotation advances slide...');
  await new Promise(r => setTimeout(r, 5500));
  let advancedSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after 5.5s:', advancedSlide);
  if (!advancedSlide?.includes('challenge the elements')) {
    throw new Error('Finding 6 Failed: Explicit restart did not advance slide!');
  }
  console.log('✓ Finding 6 (Start): Mouse click on Start resumes rotation cleanly.');

  // 7. Pointer hover pause & resume
  console.log('\nVerifying Pointer hover pause & resume');
  await cdp.eval('document.querySelector(".carousel").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));
  const carouselBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.carousel').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await cdp.mouseMove(carouselBox.x, carouselBox.y);
  console.log('Pointer hovering over carousel. Waiting 6s to confirm slide remains paused...');
  await new Promise(r => setTimeout(r, 6000));
  let hoveredSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  if (!hoveredSlide?.includes('challenge the elements')) {
    throw new Error('Hover pause failed: Slide rotated during hover!');
  }
  // Move pointer outside
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await cdp.mouseMove(100, 300);
  console.log('Pointer moved outside. Waiting 5.5s to confirm resume...');
  await new Promise(r => setTimeout(r, 5500));
  let resumedSlide = await cdp.eval('document.querySelector(".carousel-slide.active h3")?.textContent.trim()');
  console.log('Active slide after resume:', resumedSlide);
  if (!resumedSlide?.includes('want the strongest')) {
    throw new Error('Resume failed after pointer departure');
  }
  console.log('✓ Pointer Hover: Pauses on enter, resumes on leave.');

  // 8. Reduced Motion preference
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
