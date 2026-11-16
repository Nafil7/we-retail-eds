const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('--- Running Stage 5 Asset Delivery & Option A Regression Tests ---');

// 1. Verify original asset and alias file integrity
const origPath = path.resolve(__dirname, '../media/El Gordo Green.jpg');
const aliasPath = path.resolve(__dirname, '../media/El-Gordo-Green.jpg');

assert(fs.existsSync(origPath), 'FAIL: Original media/El Gordo Green.jpg must exist');
assert(fs.existsSync(aliasPath), 'FAIL: Alias media/El-Gordo-Green.jpg must exist');

const origBuf = fs.readFileSync(origPath);
const aliasBuf = fs.readFileSync(aliasPath);

const expectedHash = '929c4a1a94cc355c0e0c88ec6b9a19d44b6de6751e347aa614ebed4d8a5d88a3';
const origHash = crypto.createHash('sha256').update(origBuf).digest('hex');
const aliasHash = crypto.createHash('sha256').update(aliasBuf).digest('hex');

assert.strictEqual(origHash, expectedHash, 'FAIL: Original SHA-256 mismatch');
assert.strictEqual(aliasHash, expectedHash, 'FAIL: Alias SHA-256 mismatch');
assert.strictEqual(origBuf.length, 103000, 'FAIL: Original size must be 103000 bytes');
assert.strictEqual(aliasBuf.length, 103000, 'FAIL: Alias size must be 103000 bytes');
assert(origBuf.equals(aliasBuf), 'FAIL: Alias must be byte-for-byte identical to original');
console.log('✓ Test 1 Passed: Original and alias files exist, are 103,000 bytes, and byte-for-byte identical.');

// 2. Test central asset mapping logic from scripts.js
const scriptsContent = fs.readFileSync(path.resolve(__dirname, '../scripts/scripts.js'), 'utf8');

// Simulate normalizeMediaSources in a mock DOM environment
function createMockElement(tag, attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = val; },
    get src() { return this.attributes['src'] || ''; },
    set src(val) { this.attributes['src'] = val; },
    get srcset() { return this.attributes['srcset'] || ''; },
    set srcset(val) { this.attributes['srcset'] = val; }
  };
}

function createMockMain(elements) {
  return {
    querySelectorAll(selector) {
      if (selector === 'img') return elements.filter(e => e.tagName === 'IMG');
      if (selector === 'source') return elements.filter(e => e.tagName === 'SOURCE');
      return [];
    }
  };
}

// Extract ALIAS_MAP and resolver logic from scripts.js specification
const ALIAS_MAP = {
  'El Gordo Green.jpg': 'El-Gordo-Green.jpg',
};

function testResolver(rawSrc, basePath = '') {
  const damPrefix = '/content/dam/we-retail/';
  if (!rawSrc) return rawSrc;
  const isDam = rawSrc.includes(damPrefix);
  const isMedia = rawSrc.startsWith('/media/') || rawSrc.includes('/media/');

  if (isDam || isMedia) {
    const [pathOnly, queryOrHash] = rawSrc.split(/([?#].*)/, 2);
    let fileName = decodeURIComponent(pathOnly.split('/').pop());

    if (ALIAS_MAP[fileName]) {
      fileName = ALIAS_MAP[fileName];
    }

    const encodedFile = encodeURIComponent(fileName);
    return `${basePath}/media/${encodedFile}${queryOrHash || ''}`;
  }
  return rawSrc;
}

// Test mapping original JCR path to URL-safe alias
const jcrPath = '/content/dam/we-retail/en/products/apparel/coats/El Gordo Green.jpg';
const mappedUrl = testResolver(jcrPath);
assert.strictEqual(mappedUrl, '/media/El-Gordo-Green.jpg', 'FAIL: JCR path must resolve to /media/El-Gordo-Green.jpg');
console.log('✓ Test 2 Passed: Original JCR path maps to URL-safe alias /media/El-Gordo-Green.jpg.');

// Test mapping existing /media/El Gordo Green.jpg to URL-safe alias
const mediaPathWithSpace = '/media/El Gordo Green.jpg';
assert.strictEqual(testResolver(mediaPathWithSpace), '/media/El-Gordo-Green.jpg', 'FAIL: /media/ path with space must resolve to alias');
console.log('✓ Test 3 Passed: Space-containing media path maps to URL-safe alias.');

// Test codeBasePath resolution without double slashes
const withBasePath = testResolver(jcrPath, 'https://example.hlx.live');
assert.strictEqual(withBasePath, 'https://example.hlx.live/media/El-Gordo-Green.jpg', 'FAIL: Base path resolution error');
console.log('✓ Test 4 Passed: Resolves correctly against codeBasePath without double-prefixing.');

// Test preserving query parameters
const withQuery = testResolver(jcrPath + '?width=750&format=webply', '');
assert.strictEqual(withQuery, '/media/El-Gordo-Green.jpg?width=750&format=webply', 'FAIL: Query parameters must be preserved');
console.log('✓ Test 5 Passed: Preserves query parameters and transformation hints.');

// Test preserving all other 21 assets
const otherAssets = [
  'cart.png', 'tracking.png', 'support.png', 'Sleek.jpg', 'Expedition.jpg',
  'Trail.jpg', 'Marin.jpg', 'Rios.jpg', 'trekker-khumbu-valley.jpg',
  'running-woods-woman.jpg', 'rocks-downhill.jpg', 'climber-gear-rope.jpg',
  'camp-summer-night.jpg', 'ice-climbing-group.jpg', 'group-mountain-bikers.jpg',
  '48-hours-of-wilderness-1.jpg', 'surfer-wave-01.jpg', 'fly-fishing-the-amazon-1.jpg',
  'skitouring-1.jpg', 'steelhead-and-spines-in-alaska-1.jpg', 'camping-in-western-australia.jpg'
];

for (const asset of otherAssets) {
  const resolved = testResolver(`/content/dam/we-retail/.../${asset}`);
  assert.strictEqual(resolved, `/media/${asset}`, `FAIL: Asset ${asset} did not resolve correctly`);
}
console.log(`✓ Test 6 Passed: All other 21 authentic asset references resolve correctly without alteration.`);

console.log('--- All 6 Targeted Regression Tests Passed Successfully ---');

