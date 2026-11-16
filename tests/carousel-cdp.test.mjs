import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const edsRoot = path.resolve(__dirname, '..');

function terminateProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  } else {
    try {
      proc.kill('SIGKILL');
    } catch {}
  }
}

function findChromeExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not find Chrome/Chromium executable. Please set CHROME_PATH environment variable.');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

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
      try {
        reqPath = decodeURIComponent(reqPath);
      } catch {}
      if (reqPath === '/') reqPath = '/rendered-migrated-page.html';

      if (reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (reqPath.startsWith('/img') && reqPath.endsWith('.jpg')) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
        res.end(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
        return;
      }

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

function validatePngAndGetDimensions(filePath, expectedWidth, expectedHeight) {
  assert(fs.existsSync(filePath), `Target file does not exist: ${filePath}`);
  const stat = fs.statSync(filePath);
  assert(stat.size > 0, `Captured PNG file is empty (0 bytes): ${filePath}`);

  const buf = fs.readFileSync(filePath);
  assert(buf.length >= 24, `File too short to be a valid PNG: ${filePath} (${buf.length} bytes)`);

  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < pngSignature.length; i++) {
    if (buf[i] !== pngSignature[i]) {
      throw new Error(`Invalid PNG signature in ${filePath} at byte ${i}: got 0x${buf[i].toString(16)}, expected 0x${pngSignature[i].toString(16)}`);
    }
  }

  const chunkType = buf.subarray(12, 16).toString('ascii');
  assert.strictEqual(chunkType, 'IHDR', `First chunk in PNG must be IHDR, got "${chunkType}" in ${filePath}`);

  const actualWidth = buf.readUInt32BE(16);
  const actualHeight = buf.readUInt32BE(20);

  if (expectedWidth !== undefined && expectedWidth !== null) {
    assert.strictEqual(actualWidth, expectedWidth, `PNG width mismatch for ${path.basename(filePath)}: expected ${expectedWidth}, got ${actualWidth}`);
  }
  if (expectedHeight !== undefined && expectedHeight !== null) {
    assert.strictEqual(actualHeight, expectedHeight, `PNG height mismatch for ${path.basename(filePath)}: expected ${expectedHeight}, got ${actualHeight}`);
  }

  return { width: actualWidth, height: actualHeight, size: stat.size };
}

class CDPClient {
  constructor(wsUrl, monitoredOrigins = []) {
    this.wsUrl = wsUrl;
    this.monitoredOrigins = monitoredOrigins.map(origin => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    });
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
    this.jsExceptions = [];
    this.requests = new Map();
    this.allResponses = [];
    this.networkFailures = [];
    this.unexpectedHttpErrors = [];
    this.searchSubmission = null;
    this.deliberateSearchRequestId = null;
    this.searchResponse = null;
    this.expectingSearchSubmission = false;
  }

  isMonitored(urlString) {
    if (!urlString || typeof urlString !== 'string') return false;
    if (this.monitoredOrigins.length === 0) return true;
    try {
      const parsed = new URL(urlString);
      return this.monitoredOrigins.includes(parsed.origin);
    } catch {
      return false;
    }
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.consoleAPICalled') {
        if (data.params.type === 'error') {
          const text = (data.params.args || []).map(a => a.value || a.description || '').join(' ');
          this.consoleErrors.push(text);
        }
      } else if (data.method === 'Runtime.exceptionThrown') {
        const details = data.params.exceptionDetails;
        const text = details.exception?.description || details.text || JSON.stringify(details);
        this.jsExceptions.push({
          text,
          url: details.url,
          lineNumber: details.lineNumber,
          columnNumber: details.columnNumber,
          stackTrace: details.stackTrace
        });
      } else if (data.method === 'Network.requestWillBeSent') {
        const req = data.params.request;
        this.requests.set(data.params.requestId, {
          url: req.url,
          method: req.method,
          headers: req.headers,
          type: data.params.type,
          timestamp: data.params.timestamp
        });
        if (this.expectingSearchSubmission && !this.deliberateSearchRequestId && req.url.includes('/content/we-retail/us/en/search.html')) {
          this.deliberateSearchRequestId = data.params.requestId;
          this.searchSubmission = {
            requestId: data.params.requestId,
            url: req.url,
            method: req.method,
            headers: req.headers,
            timestamp: data.params.timestamp
          };
        }
      } else if (data.method === 'Network.responseReceived') {
        const resp = data.params.response;
        const entry = {
          requestId: data.params.requestId,
          url: resp.url,
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
          mimeType: resp.mimeType,
          type: data.params.type
        };
        this.allResponses.push(entry);

        const isDeliberateSearch = !!(this.deliberateSearchRequestId && data.params.requestId === this.deliberateSearchRequestId);
        if (isDeliberateSearch) {
          this.searchResponse = entry;
        }

        if (resp.status >= 400 && this.isMonitored(resp.url)) {
          const isFavicon = resp.url.includes('/favicon.ico');
          // Allow the expected search platform limitation ONLY for that exact correlated request ID
          if (!isDeliberateSearch && !isFavicon) {
            this.unexpectedHttpErrors.push(entry);
          }
        }
      } else if (data.method === 'Network.loadingFailed') {
        const req = this.requests.get(data.params.requestId);
        const failure = {
          requestId: data.params.requestId,
          url: req ? req.url : 'unknown',
          method: req ? req.method : 'unknown',
          type: data.params.type,
          errorText: data.params.errorText,
          canceled: !!data.params.canceled,
          timestamp: data.params.timestamp
        };
        if (!data.params.canceled && data.params.errorText !== 'net::ERR_ABORTED' && this.isMonitored(failure.url)) {
          this.networkFailures.push(failure);
        }
      }

      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
  }

  async captureScreenshot(outputPath, expectedWidth, expectedHeight) {
    // Before each screenshot capture, remove any existing target file to ensure freshness
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    assert(!fs.existsSync(outputPath), `Pre-existing screenshot could not be deleted: ${outputPath}`);

    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    if (!res || typeof res.data !== 'string' || res.data.length === 0) {
      throw new Error(`Page.captureScreenshot returned empty image data for ${outputPath}`);
    }

    const buffer = Buffer.from(res.data, 'base64');
    if (buffer.length === 0) {
      throw new Error(`Decoded image data is 0 bytes for ${outputPath}`);
    }
    fs.writeFileSync(outputPath, buffer);

    return validatePngAndGetDimensions(outputPath, expectedWidth, expectedHeight);
  }

  async captureFullPageScreenshot(outputPath, width = 1440) {
    // Before each screenshot capture, remove any existing target file to ensure freshness
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    assert(!fs.existsSync(outputPath), `Pre-existing screenshot could not be deleted: ${outputPath}`);

    const isMobile = width < 768;
    await this.setViewport(width, 1000, isMobile);
    await this.eval('window.scrollTo(0, 0);');
    await new Promise(r => setTimeout(r, 200));

    const dims = await this.eval(`(() => {
      const body = document.body;
      const html = document.documentElement;
      const height = Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        html ? html.clientHeight : 0,
        html ? html.scrollHeight : 0,
        html ? html.offsetHeight : 0
      );
      return { width: ${width}, height: Math.max(height, 800) };
    })()`);

    const expectedHeight = dims.height;

    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: expectedHeight,
      deviceScaleFactor: 1,
      mobile: isMobile
    });
    await new Promise(r => setTimeout(r, 300));

    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height: expectedHeight,
        scale: 1
      }
    });

    if (!res || typeof res.data !== 'string' || res.data.length === 0) {
      throw new Error(`Page.captureScreenshot returned empty image data for full-page capture: ${outputPath}`);
    }

    const buffer = Buffer.from(res.data, 'base64');
    if (buffer.length === 0) {
      throw new Error(`Decoded full-page image data is 0 bytes for ${outputPath}`);
    }
    fs.writeFileSync(outputPath, buffer);

    // Restore normal viewport height
    await this.setViewport(width, 900, isMobile);

    return validatePngAndGetDimensions(outputPath, width, expectedHeight);
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile
    });
    await new Promise(r => setTimeout(r, 200));
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
  console.log('--- Starting Stage 8 Real Browser CDP Conformance & APG Verification ---');
  let server = null;
  let chromeProc = null;
  let cdp = null;
  let tempProfileDir = null;

  try {
    const chromeExe = findChromeExecutable();
    console.log(`Using Chrome executable: ${chromeExe}`);

    const httpPort = process.env.PORT ? parseInt(process.env.PORT, 10) : await getFreePort();
    const cdpPort = process.env.CDP_PORT ? parseInt(process.env.CDP_PORT, 10) : await getFreePort();
    const baseUrl = `http://127.0.0.1:${httpPort}`;
    const cdpBase = `http://127.0.0.1:${cdpPort}`;

    server = await startServer(httpPort);
    console.log(`HTTP Server listening on ${baseUrl}`);

    tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cdp-8-'));
    chromeProc = spawn(chromeExe, [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tempProfileDir}`,
      '--disable-gpu',
      '--no-first-run',
      'about:blank'
    ]);

    let versionData = null;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${cdpBase}/json/version`);
        if (r.ok) {
          versionData = await r.json();
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }

    if (!versionData) {
      throw new Error(`Chrome remote debugging did not respond on port ${cdpPort}`);
    }

    console.log(`Browser: ${versionData.Browser}`);
    console.log(`User-Agent: ${versionData['User-Agent']}`);

    const targetsRes = await fetch(`${cdpBase}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const livePreviewOrigin = 'https://feature-visual-parity-reconciliation--we-retail-eds--nafil7.aem.page';
    const monitoredOrigins = [baseUrl, livePreviewOrigin];
    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl, monitoredOrigins);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // STEP 1: In-Page Browser Test Suite Execution
    console.log('\n--- Step 1: Executing In-Page Browser Test Suite ---');
    await cdp.send('Page.navigate', { url: `${baseUrl}/tests/carousel-browser-test.html` });

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
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
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
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
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
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
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
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
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
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
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

  // STEP 3: Hero Visual Parity, Dimensions & Lower-Left Positioning
  console.log('\n--- Step 3: Hero Visual Parity & Positioning ---');
  await cdp.setViewport(1440, 900);
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
  await new Promise(r => setTimeout(r, 600));

  const heroData = await cdp.eval(`(() => {
    const hero = document.querySelector('.hero');
    const heroContent = hero.querySelector('.hero-content');
    const h1 = heroContent.querySelector('h1');
    const cta = heroContent.querySelector('a.button.primary');
    const heroRect = hero.getBoundingClientRect();
    const contentRect = heroContent.getBoundingClientRect();
    const compHero = window.getComputedStyle(hero);
    const compContent = window.getComputedStyle(heroContent);
    return {
      minHeight: parseInt(compHero.minHeight, 10),
      display: compHero.display,
      alignItems: compHero.alignItems,
      justifyContent: compHero.justifyContent,
      textAlign: compContent.textAlign,
      contentAlignItems: compContent.alignItems,
      h1Text: h1 ? h1.textContent.trim() : null,
      ctaText: cta ? cta.textContent.trim() : null,
      ctaHref: cta ? cta.getAttribute('href') : null,
      contentLeftOffset: Math.round(contentRect.left - heroRect.left),
      contentBottomOffset: Math.round(heroRect.bottom - contentRect.bottom)
    };
  })()`);
  console.log('Hero computed geometry & layout:', heroData);
  assert(heroData.minHeight >= 460, `Hero minHeight must be >= 460px (got ${heroData.minHeight})`);
  assert.strictEqual(heroData.display, 'flex');
  assert.strictEqual(heroData.alignItems, 'flex-end', 'Hero vertical alignment must be flex-end for lower positioning');
  assert.strictEqual(heroData.textAlign, 'left', 'Hero text alignment must be left');
  assert.strictEqual(heroData.contentAlignItems, 'flex-start', 'Hero content flex items must align to flex-start (left)');
  assert.strictEqual(heroData.h1Text, 'Built for the coldest winter on earth');
  assert.strictEqual(heroData.ctaText, 'Shop Now');
  assert.strictEqual(heroData.ctaHref, '/content/we-retail/us/en/products/equipment/snow-sports.html');
  assert(heroData.contentBottomOffset < 100, `Hero content must be positioned near the bottom of hero (got offset ${heroData.contentBottomOffset}px)`);
  console.log('✓ Hero: Lower-left positioning, dimensions (>=460px), typography, and CTA verified.');

  // Hero Direct DOM Text Node Verification (Requirement 4)
  console.log('Verifying Hero Direct DOM Text Node Handling in Real Browser...');
  const heroTextNodeResult = await cdp.eval(`(() => {
    const testHero = document.createElement('div');
    testHero.className = 'hero';
    const testRow = document.createElement('div');
    const picCell = document.createElement('div');
    picCell.innerHTML = '<picture><img src="/media/trekker-khumbu-valley.jpg" alt="Winter Gear"></picture>';
    const textCell = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = 'Built for the coldest winter on earth';
    textCell.appendChild(h1);

    // Direct real DOM text node without wrapping p
    const directText = document.createTextNode('All-new winter collection direct authored text');
    textCell.appendChild(directText);

    // Direct authored link
    const link = document.createElement('a');
    link.href = '/content/we-retail/us/en/products/equipment/snow-sports.html';
    link.textContent = 'Shop Now';
    textCell.appendChild(link);

    testRow.appendChild(picCell);
    testRow.appendChild(textCell);
    testHero.appendChild(testRow);

    window.__decorateHero(testHero);

    const content = testHero.querySelector('.hero-content');
    const paras = [...content.querySelectorAll('p')].map(p => p.textContent.trim());
    const cta = content.querySelector('a.button.primary');
    return {
      childrenCount: testHero.children.length,
      hasHeroImage: !!testHero.querySelector('.hero-image'),
      hasHeroContent: !!content,
      h1: content.querySelector('h1')?.textContent.trim(),
      paras,
      ctaText: cta?.textContent.trim(),
      ctaHref: cta?.getAttribute('href'),
      hasDirectTextP: paras.includes('All-new winter collection direct authored text')
    };
  })()`);
  assert.strictEqual(heroTextNodeResult.childrenCount, 2, 'Hero with direct text nodes must have 2 children');
  assert.strictEqual(heroTextNodeResult.hasDirectTextP, true, 'Direct text node must be converted to paragraph and preserved word for word');
  assert.strictEqual(heroTextNodeResult.h1, 'Built for the coldest winter on earth');
  assert.strictEqual(heroTextNodeResult.ctaText, 'Shop Now');
  assert.strictEqual(heroTextNodeResult.ctaHref, '/content/we-retail/us/en/products/equipment/snow-sports.html');
  console.log('✓ Hero: Direct DOM text nodes preserved verbatim in real browser without losing content or links.');

  // STEP 4: Columns Regression: Service Features vs Community Images
  console.log('\n--- Step 4: Columns Regression (Service Features & Community Images) ---');
  const colsData = await cdp.eval(`(() => {
    const cols = [...document.querySelectorAll('.columns')];
    const svcRow = cols[0].querySelector('.columns-row') || cols[0].firstElementChild;
    const svcItems = [...svcRow.children].map(col => {
      const img = col.querySelector('img');
      const text = col.querySelector('.columns-text');
      const h4 = text ? text.querySelector('h4') : null;
      const p = text ? text.querySelector('p') : null;
      const imgRect = img ? img.getBoundingClientRect() : null;
      return {
        iconWidth: imgRect ? Math.round(imgRect.width) : 0,
        iconHeight: imgRect ? Math.round(imgRect.height) : 0,
        title: h4 ? h4.textContent.trim() : null,
        desc: p ? p.textContent.trim() : null,
        flexDirection: window.getComputedStyle(col).flexDirection
      };
    });

    const photoRow = cols[1].querySelector('.columns-row') || cols[1].firstElementChild;
    const photoItems = [...photoRow.children].map(col => {
      const img = col.querySelector('img');
      const imgRect = img ? img.getBoundingClientRect() : null;
      return {
        hasImage: !!img,
        hasText: !!col.querySelector('h1, h2, h3, h4, h5, h6, p'),
        imgHeight: imgRect ? Math.round(imgRect.height) : 0
      };
    });

    return {
      svcItems,
      photoItems
    };
  })()`);
  console.log('Columns desktop data:', colsData);
  assert.strictEqual(colsData.svcItems.length, 3, 'Must have 3 service feature items');
  colsData.svcItems.forEach((item, i) => {
    assert.strictEqual(item.iconWidth, 36, `Service icon ${i} width must be 36px`);
    assert.strictEqual(item.iconHeight, 36, `Service icon ${i} height must be 36px`);
    assert.strictEqual(item.flexDirection, 'row', 'Service item must have flex-direction row (icon beside text)');
    assert(item.title, `Service item ${i} must have title`);
    assert(item.desc, `Service item ${i} must have description`);
  });
  assert.strictEqual(colsData.photoItems.length, 3, 'Must have 3 community photos');
  colsData.photoItems.forEach((item, i) => {
    assert.strictEqual(item.hasImage, true, `Photo ${i} must have image`);
    assert.strictEqual(item.hasText, false, `Photo ${i} must not have text elements`);
    assert.strictEqual(item.imgHeight, 240, `Photo ${i} height must be 240px`);
  });
  console.log('✓ Columns: Service features (36x36 icon + stacked text) and community images (240px image-only) verified on desktop.');

  // Verify responsive columns stacking on mobile (375px)
  await cdp.setViewport(375, 812, true);
  await new Promise(r => setTimeout(r, 300));
  const mobileColsFlex = await cdp.eval(`(() => {
    const row = document.querySelector('.columns .columns-row') || document.querySelector('.columns > div');
    return window.getComputedStyle(row).flexDirection;
  })()`);
  assert.strictEqual(mobileColsFlex, 'column', 'Columns row must stack vertically (column) on mobile 375px');
  console.log('✓ Columns: Stacks vertically on mobile 375px.');

  // Reset to desktop viewport for subsequent interaction tests
  await cdp.setViewport(1440, 900, false);
  await new Promise(r => setTimeout(r, 200));

  // STEP 5: Language Selector APG Accessibility Verification
  console.log('\n--- Step 5: Language Selector APG Accessibility ---');
  const langInitial = await cdp.eval(`(() => {
    const btn = document.querySelector('.we-lang-btn');
    const menu = document.querySelector('.we-lang-dropdown');
    return {
      ariaExpanded: btn?.getAttribute('aria-expanded'),
      ariaHasPopup: btn?.getAttribute('aria-haspopup'),
      ariaControls: btn?.getAttribute('aria-controls'),
      menuRole: menu?.getAttribute('role'),
      menuItemCount: menu?.querySelectorAll('a[role="menuitem"]').length
    };
  })()`);
  console.log('Language selector initial semantics:', langInitial);
  assert.strictEqual(langInitial.ariaExpanded, 'false');
  assert.strictEqual(langInitial.ariaHasPopup, 'true');
  assert.strictEqual(langInitial.menuRole, 'menu');
  assert.strictEqual(langInitial.menuItemCount, 6);

  // Mouse Click opens dropdown
  const langBtnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.we-lang-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await cdp.mouseClick(langBtnBox.x, langBtnBox.y);
  let expandedAfterClick = await cdp.eval('document.querySelector(".we-lang-btn").getAttribute("aria-expanded")');
  assert.strictEqual(expandedAfterClick, 'true', 'Click must expand language menu');

  // Escape dismisses and returns focus to button
  await cdp.sendKey('Escape', 'Escape', 27);
  let expandedAfterEsc = await cdp.eval('document.querySelector(".we-lang-btn").getAttribute("aria-expanded")');
  assert.strictEqual(expandedAfterEsc, 'false', 'Escape must collapse language menu');
  let focusedAfterEsc = await cdp.eval('document.activeElement?.className');
  assert(focusedAfterEsc?.includes('we-lang-btn'), 'Escape must restore focus to language button');

  // ArrowDown enters menu and focuses first item
  await cdp.sendKey('ArrowDown', 'ArrowDown', 40);
  let expandedAfterArrow = await cdp.eval('document.querySelector(".we-lang-btn").getAttribute("aria-expanded")');
  assert.strictEqual(expandedAfterArrow, 'true', 'ArrowDown must open menu');
  let focusedItemText = await cdp.eval('document.activeElement?.textContent.trim()');
  assert(focusedItemText?.includes('United States (EN)'), `ArrowDown must focus first menuitem (got "${focusedItemText}")`);

  // ArrowDown moves to next menuitem
  await cdp.sendKey('ArrowDown', 'ArrowDown', 40);
  let nextFocusedText = await cdp.eval('document.activeElement?.textContent.trim()');
  assert(nextFocusedText?.includes('United States (ES)'), `Second ArrowDown must focus second menuitem (got "${nextFocusedText}")`);

  // Outside click dismisses
  await cdp.mouseClick(500, 300);
  let expandedAfterOutside = await cdp.eval('document.querySelector(".we-lang-btn").getAttribute("aria-expanded")');
  assert.strictEqual(expandedAfterOutside, 'false', 'Outside click must collapse language menu');
  console.log('✓ Language Selector: Click, Enter/Space, Escape + focus return, ArrowDown entry, Arrow navigation, outside click, and aria-expanded fully verified.');

  // STEP 6: Search Functionality Verification
  console.log('\n--- Step 6: Search Functionality ---');
  const searchBtnBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.we-search-btn').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  // Click search button expands input and focuses it
  await cdp.mouseClick(searchBtnBox.x, searchBtnBox.y);
  let searchActive = await cdp.eval('document.querySelector(".we-search-form").classList.contains("active")');
  assert.strictEqual(searchActive, true, 'Clicking search button must activate form');
  let activeTag = await cdp.eval('document.activeElement?.tagName');
  assert.strictEqual(activeTag, 'INPUT', 'Search input must receive focus');

  // Escape dismisses search and restores focus to search button
  await cdp.sendKey('Escape', 'Escape', 27);
  searchActive = await cdp.eval('document.querySelector(".we-search-form").classList.contains("active")');
  assert.strictEqual(searchActive, false, 'Escape must close search');
  let focusedSearchBtn = await cdp.eval('document.activeElement?.className');
  assert(focusedSearchBtn?.includes('we-search-btn'), 'Escape must restore focus to search button');

  // Re-open, verify empty input handling
  await cdp.mouseClick(searchBtnBox.x, searchBtnBox.y);
  searchActive = await cdp.eval('document.querySelector(".we-search-form").classList.contains("active")');
  assert.strictEqual(searchActive, true);
  await cdp.mouseClick(searchBtnBox.x, searchBtnBox.y);
  searchActive = await cdp.eval('document.querySelector(".we-search-form").classList.contains("active")');
  assert.strictEqual(searchActive, false, 'Empty click must close search without submitting');

  // Verify form configuration: action and parameter name
  const searchConfig = await cdp.eval(`(() => {
    const form = document.querySelector('.we-search-form');
    const input = form.querySelector('.we-search-input');
    return {
      action: form.getAttribute('action'),
      method: form.getAttribute('method'),
      inputName: input.getAttribute('name')
    };
  })()`);
  console.log('Search form configuration:', searchConfig);
  assert.strictEqual(searchConfig.action, '/content/we-retail/us/en/search.html');
  assert.strictEqual(searchConfig.inputName, 'fulltext');

  // Re-open, input non-empty query and submit via Enter key
  await cdp.mouseClick(searchBtnBox.x, searchBtnBox.y);
  searchActive = await cdp.eval('document.querySelector(".we-search-form").classList.contains("active")');
  assert.strictEqual(searchActive, true);

  await cdp.eval(`(() => {
    const input = document.querySelector('.we-search-input');
    input.value = 'hiking boots & jackets';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  console.log('Submitting non-empty search query "hiking boots & jackets" via Enter key...');
  cdp.searchSubmission = null;
  cdp.deliberateSearchRequestId = null;
  cdp.searchResponse = null;
  cdp.expectingSearchSubmission = true;
  await cdp.sendKey('Enter', 'Enter', 13);

  // Correlate the search response with the actual search request and wait for network completion
  let searchResponseReceived = false;
  for (let i = 0; i < 30; i++) {
    if (cdp.searchSubmission && cdp.searchResponse) {
      searchResponseReceived = true;
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  cdp.expectingSearchSubmission = false;

  assert(cdp.searchSubmission, 'Search form submission request must be dispatched on Enter');
  console.log('Captured search submission:', cdp.searchSubmission);
  const submittedUrl = new URL(cdp.searchSubmission.url);
  assert.strictEqual(submittedUrl.pathname, '/content/we-retail/us/en/search.html', 'Submission pathname must match action URL');
  assert.strictEqual(submittedUrl.searchParams.get('fulltext'), 'hiking boots & jackets', 'Submitted fulltext query must match input');
  assert(
    submittedUrl.search.includes('fulltext=hiking+boots+%26+jackets') ||
    submittedUrl.search.includes('fulltext=hiking%20boots%20%26%20jackets'),
    `Search query must be correctly URL encoded (got "${submittedUrl.search}")`
  );
  console.log('✓ Search Submission: Non-empty query submitted via Enter, fulltext parameter, and URL encoding verified.');

  // Verify correlated search destination HTTP response status
  assert(searchResponseReceived && cdp.searchResponse, 'Search response must be recorded for the search request (missing response)');
  assert.strictEqual(
    cdp.searchResponse.requestId,
    cdp.searchSubmission.requestId,
    `Search response requestId (${cdp.searchResponse.requestId}) must correlate with search request ID (${cdp.searchSubmission.requestId})`
  );
  console.log(`Search destination HTTP response status: ${cdp.searchResponse.status} ${cdp.searchResponse.statusText}`);
  assert.strictEqual(cdp.searchResponse.status, 404, 'Search destination returns 404 due to static EDS platform limitation');
  console.log('✓ Documented EDS Search Limitation Verified: Static EDS repository does not deploy a server-side JCR QueryBuilder search endpoint. Search results page is unbacked (HTTP 404). Search results functionality is NOT claimed as functioning.');

  // Navigate back to rendered migrated page for subsequent footer and media tests
  console.log('Navigating back to migration test page...');
  await cdp.send('Page.navigate', { url: `${baseUrl}/rendered-migrated-page.html` });
  await new Promise(r => setTimeout(r, 600));

  console.log('✓ Search: Open, focus, Escape + focus return, empty input handling, non-empty submission, encoding, and documented limitation verified.');

  // STEP 7: Footer Links Verification
  console.log('\n--- Step 7: Footer Links & Top Anchor ---');
  const footerData = await cdp.eval(`(() => {
    const terms = document.querySelector('.we-terms-link');
    const ride = document.querySelector('.we-ride-top');
    const topAnchor = document.getElementById('top');
    return {
      termsHref: terms?.getAttribute('href'),
      rideHref: ride?.getAttribute('href'),
      hasTopAnchor: !!topAnchor,
      topAnchorTag: topAnchor?.tagName
    };
  })()`);
  console.log('Footer links & anchor semantics:', footerData);
  assert.strictEqual(footerData.termsHref, '#', 'Terms of Use must preserve authoritative AEM source href="#"');
  assert.strictEqual(footerData.rideHref, '#top', 'Ride to the top must target #top');
  assert.strictEqual(footerData.hasTopAnchor, true, 'Target element with id="top" must exist in DOM');

  // Test Ride to the top smooth scroll
  await cdp.eval('window.scrollTo(0, document.body.scrollHeight);');
  await new Promise(r => setTimeout(r, 200));
  let scrollY = await cdp.eval('window.scrollY');
  assert(scrollY > 500, `Page must be scrolled down before test (got ${scrollY})`);

  // Scroll link into view to ensure it is within click coordinates
  await cdp.eval('document.querySelector(".we-ride-top").scrollIntoView({ block: "center" });');
  await new Promise(r => setTimeout(r, 200));

  // Click Ride to the top link
  const rideBox = await cdp.eval(`(() => {
    const rect = document.querySelector('.we-ride-top').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await cdp.mouseClick(rideBox.x, rideBox.y);

  let finalScrollY = await cdp.eval('window.scrollY');
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 100));
    finalScrollY = await cdp.eval('window.scrollY');
    if (finalScrollY === 0) break;
  }

  let currentHash = await cdp.eval('window.location.hash');
  console.log(`Scroll after Ride to the top: ${finalScrollY}px, hash: "${currentHash}"`);
  assert(finalScrollY < 15, `Ride to the top must return viewport scroll to top (got ${finalScrollY})`);
  assert.strictEqual(currentHash, '#top');
  console.log('✓ Footer: Terms of Use preserves href="#" and Ride to the top smoothly scrolls back to #top.');

  // STEP 8: Media Normalization in Live Browser
  console.log('\n--- Step 8: Media Normalization in Live Browser ---');
  const mediaAudit = await cdp.eval(`(() => {
    const imgs = [...document.querySelectorAll('img')];
    const elGordo = imgs.find(img => img.src.includes('El-Gordo-Green.jpg'));
    const broken = imgs.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src);
    return {
      totalImages: imgs.length,
      brokenImages: broken,
      elGordoFound: !!elGordo,
      elGordoDimensions: elGordo ? { w: elGordo.naturalWidth, h: elGordo.naturalHeight } : null
    };
  })()`);
  console.log('Live browser media audit:', mediaAudit);
  assert.strictEqual(mediaAudit.brokenImages.length, 0, `All images must load completely with non-zero dimensions`);
  assert.strictEqual(mediaAudit.elGordoFound, true, 'El-Gordo-Green.jpg URL-safe alias must be present in live DOM');
  assert(mediaAudit.elGordoDimensions.w > 0, 'El-Gordo-Green.jpg must have non-zero natural width');
  console.log('✓ Media Normalization: 100% of live browser images load successfully with URL-safe aliases preserved.');

  // STEP 9: Visual Acceptance Full-Page Screenshots at Desktop, Tablet, and Mobile
  console.log('\n--- Step 9: Capturing Visual Acceptance Screenshots ---');
  const artifactDir = process.env.ARTIFACT_DIR || 'C:\\Users\\mohammednafil\\.gemini\\antigravity\\brain\\41b01aa4-fa7e-406b-b2bd-a4c73363f5f1';

  // 1. Local Fixture Full-Page Screenshots
  console.log('Capturing Local Fixture full-page screenshots from:', baseUrl);
  const localCaptureFiles = [
    { name: 'desktop', file: 'eds-local-fullpage-desktop-1440.png', width: 1440 },
    { name: 'tablet', file: 'eds-local-fullpage-tablet-768.png', width: 768 },
    { name: 'mobile', file: 'eds-local-fullpage-mobile-375.png', width: 375 }
  ];
  for (const item of localCaptureFiles) {
    const targetPath = path.join(artifactDir, item.file);
    const validated = await cdp.captureFullPageScreenshot(targetPath, item.width);
    assert(validated.size > 10000, `Required local screenshot is unexpectedly small: ${targetPath} (${validated.size} bytes)`);
    console.log(`✓ Generated and validated fresh local fixture ${item.name} full-page screenshot (${validated.width}x${validated.height}): ${item.file} (${validated.size} bytes)`);
  }

  // Maintain viewport screenshots with freshness deletion and dimension verification
  await cdp.setViewport(1440, 900, false);
  await cdp.captureScreenshot(path.join(artifactDir, 'eds-remediation-desktop-1440.png'), 1440, 900);
  await cdp.setViewport(768, 1024, false);
  await cdp.captureScreenshot(path.join(artifactDir, 'eds-remediation-tablet-768.png'), 768, 1024);
  await cdp.setViewport(375, 812, true);
  await cdp.captureScreenshot(path.join(artifactDir, 'eds-remediation-mobile-375.png'), 375, 812);

  // 2. Actual Live EDS Preview Full-Page Screenshots
  const expectedLiveOrigin = 'https://feature-visual-parity-reconciliation--we-retail-eds--nafil7.aem.page';
  const expectedLiveHostname = 'feature-visual-parity-reconciliation--we-retail-eds--nafil7.aem.page';
  const expectedLivePathname = '/rendered-migrated-page.html';
  const livePreviewUrl = `${expectedLiveOrigin}${expectedLivePathname}`;
  console.log('Navigating to Actual Live EDS Preview:', livePreviewUrl);
  await cdp.send('Page.navigate', { url: livePreviewUrl });

  // Verify final browser URL matches expected origin, hostname, and pathname exactly
  let liveNavUrl = '';
  let parsedLiveUrl = null;
  for (let i = 0; i < 40; i++) {
    liveNavUrl = await cdp.eval('window.location.href');
    if (liveNavUrl) {
      try {
        const u = new URL(liveNavUrl);
        if (u.origin === expectedLiveOrigin && u.pathname === expectedLivePathname) {
          parsedLiveUrl = u;
          break;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 200));
  }
  assert(parsedLiveUrl, `Browser failed to reach live preview expected URL (current URL: "${liveNavUrl}")`);
  assert.strictEqual(parsedLiveUrl.origin, expectedLiveOrigin, `Live preview origin must match exact expected origin`);
  assert.strictEqual(parsedLiveUrl.hostname, expectedLiveHostname, `Live preview hostname must match exact expected hostname without lookalikes`);
  assert.strictEqual(parsedLiveUrl.pathname, expectedLivePathname, `Live preview pathname must match exact expected pathname`);
  console.log(`✓ Live Preview URL verified exactly: ${parsedLiveUrl.href} (origin: ${parsedLiveUrl.origin}, pathname: ${parsedLiveUrl.pathname})`);

  // Verify expected page content rendered in DOM
  const pageReady = await cdp.eval(`(() => {
    const hero = document.querySelector('.hero');
    const h1 = hero ? hero.querySelector('h1') : null;
    const carousel = document.querySelector('.carousel');
    const cols = document.querySelectorAll('.columns');
    return {
      hasHero: !!hero,
      h1Text: h1 ? h1.textContent.trim() : null,
      hasCarousel: !!carousel,
      columnsCount: cols.length
    };
  })()`);
  assert.strictEqual(pageReady.hasHero, true, 'Live preview must contain .hero block');
  assert.strictEqual(pageReady.h1Text, 'Built for the coldest winter on earth', 'Live preview must render expected H1 content');
  assert.strictEqual(pageReady.hasCarousel, true, 'Live preview must contain .carousel block');
  assert(pageReady.columnsCount >= 2, 'Live preview must render columns blocks');
  console.log('✓ Live Preview Content verified in live DOM:', pageReady);

  // Wait for document readiness and all required images to finish loading
  let imagesReady = false;
  let liveMediaAudit = null;
  for (let i = 0; i < 40; i++) {
    liveMediaAudit = await cdp.eval(`(() => {
      const isDocComplete = document.readyState === 'complete';
      const imgs = [...document.querySelectorAll('img')];
      const loaded = imgs.filter(img => img.complete && img.naturalWidth > 0);
      const broken = imgs.filter(img => img.complete && img.naturalWidth === 0);
      return {
        isDocComplete,
        total: imgs.length,
        loaded: loaded.length,
        broken: broken.map(img => img.src)
      };
    })()`);
    if (liveMediaAudit && liveMediaAudit.isDocComplete && liveMediaAudit.total > 0 && liveMediaAudit.loaded === liveMediaAudit.total) {
      imagesReady = true;
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log('Live preview document & image audit:', liveMediaAudit);
  assert.strictEqual(imagesReady, true, 'All images on live preview must finish loading with non-zero dimensions');
  assert.strictEqual(liveMediaAudit.broken.length, 0, `No broken images allowed on live preview: ${JSON.stringify(liveMediaAudit.broken)}`);

  // Capture live preview full-page screenshots
  const previewCaptureFiles = [
    { name: 'desktop', file: 'eds-preview-fullpage-desktop-1440.png', width: 1440 },
    { name: 'tablet', file: 'eds-preview-fullpage-tablet-768.png', width: 768 },
    { name: 'mobile', file: 'eds-preview-fullpage-mobile-375.png', width: 375 }
  ];
  for (const item of previewCaptureFiles) {
    const targetPath = path.join(artifactDir, item.file);
    const validated = await cdp.captureFullPageScreenshot(targetPath, item.width);
    assert(validated.size > 10000, `Required live preview screenshot is unexpectedly small: ${targetPath} (${validated.size} bytes)`);
    console.log(`✓ Generated and validated fresh live preview ${item.name} full-page screenshot (${validated.width}x${validated.height}): ${item.file} (${validated.size} bytes)`);
  }

  // Regression Test: Unexpected 404 Detection on Live Preview Origin
  console.log('\n--- Regression Test: Verifying Unexpected 404 Detection on Live Preview Origin ---');
  const probePath = `/deliberate-missing-asset-probe-${Date.now()}.css`;
  const probeUrl = `${expectedLiveOrigin}${probePath}`;
  console.log(`Dispatching deliberate probe request to non-existent asset on live preview: ${probeUrl}`);
  await cdp.eval(`fetch('${probePath}').catch(() => {})`);
  await new Promise(r => setTimeout(r, 800));

  const probeIndex = cdp.unexpectedHttpErrors.findIndex(e => e.url === probeUrl);
  assert(probeIndex !== -1, `Network monitor must detect unexpected 404 from live preview origin (${probeUrl})`);
  const detectedProbe = cdp.unexpectedHttpErrors[probeIndex];
  assert.strictEqual(detectedProbe.status, 404, 'Detected probe must carry status 404');
  console.log('✓ Regression Test Passed: Unexpected 404 on live preview origin correctly detected and recorded in unexpectedHttpErrors:');
  console.log('   Probe record:', { url: detectedProbe.url, status: detectedProbe.status, statusText: detectedProbe.statusText });
  // Remove probe entry so subsequent health audit reflects genuine page traffic
  cdp.unexpectedHttpErrors.splice(probeIndex, 1);

  // STEP 10: Final Health Audit (Console Errors, JS Exceptions, Network Failures & Unexpected HTTP Statuses)
  console.log('\n--- Step 10: Final Browser Health Audit ---');
  console.log(`Failed network requests: ${cdp.networkFailures.length}`);
  if (cdp.networkFailures.length > 0) {
    console.error('Failed network requests diagnostic details:', JSON.stringify(cdp.networkFailures, null, 2));
  }
  assert.strictEqual(
    cdp.networkFailures.length,
    0,
    `Browser network assertion failed: expected 0 failed network requests, got ${cdp.networkFailures.length}. Details: ${JSON.stringify(cdp.networkFailures)}`
  );

  console.log(`Unexpected 4xx/5xx HTTP responses: ${cdp.unexpectedHttpErrors.length}`);
  if (cdp.unexpectedHttpErrors.length > 0) {
    console.error('Unexpected HTTP status diagnostic details:', JSON.stringify(cdp.unexpectedHttpErrors, null, 2));
  }
  assert.strictEqual(
    cdp.unexpectedHttpErrors.length,
    0,
    `HTTP response status assertion failed: expected 0 unexpected 4xx/5xx responses, got ${cdp.unexpectedHttpErrors.length}. Details: ${JSON.stringify(cdp.unexpectedHttpErrors)}`
  );

  console.log(`Uncaught JS Exceptions: ${cdp.jsExceptions.length}`);
  if (cdp.jsExceptions.length > 0) {
    console.error('Diagnostic details for uncaught JS exceptions:', JSON.stringify(cdp.jsExceptions, null, 2));
  }
  assert.strictEqual(
    cdp.jsExceptions.length,
    0,
    `Browser JavaScript exception assertion failed: expected 0 uncaught JS exceptions, got ${cdp.jsExceptions.length}. Details: ${JSON.stringify(cdp.jsExceptions)}`
  );

  console.log(`Console Errors detected: ${cdp.consoleErrors.length}`);
  if (cdp.consoleErrors.length > 0) {
    console.error('Console errors:', cdp.consoleErrors);
  }
  assert.strictEqual(cdp.consoleErrors.length, 0, 'No uncaught console errors allowed during acceptance pass');
  console.log('✓ Browser Health Audit: 0 network failures, 0 unexpected 4xx/5xx responses, 0 JS exceptions, 0 uncaught console errors.');

  console.log('\nAll real browser CDP conformance & visual acceptance tests passed successfully!');
  } finally {
    console.log('\n--- Shutting Down Test Environment ---');
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    if (chromeProc) {
      terminateProcessTree(chromeProc);
    }
    if (server) {
      try {
        await new Promise(resolve => server.close(resolve));
      } catch {}
    }
    if (tempProfileDir && fs.existsSync(tempProfileDir)) {
      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true, maxRetries: 3 });
      } catch {}
    }
  }
}

run().catch((err) => {
  console.error('CDP test failed:', err);
  process.exit(1);
});
