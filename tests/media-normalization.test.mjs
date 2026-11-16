import assert from 'assert';

// Define minimal browser environment for Node environment before importing scripts
globalThis.window = {
  hlx: { codeBasePath: '', suppressLoadPage: true },
  location: new URL('http://localhost/'),
  origin: 'http://localhost'
};
globalThis.document = {
  documentElement: { classList: { add() {}, remove() {}, contains() { return false; } } },
  head: { querySelectorAll() { return []; }, querySelector() { return null; } },
  body: { querySelectorAll() { return []; }, querySelector() { return null; }, classList: { add() {}, remove() {}, contains() { return false; } } },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

const {
  resolveMediaUrl,
  resolveMediaSrcset,
  isExternalMediaUrl,
  safeDecodeURIComponent,
  normalizeMediaSources
} = await import('../scripts/scripts.js');

// Reset codeBasePath to '' for root testing
window.hlx.codeBasePath = '';

console.log('--- Running Stage 8 Media Normalisation Test Suite ---');

// Test 1: DAM path resolution
const damUrl = '/content/dam/we-retail/en/products/apparel/running-woods-woman.jpg';
const resolvedDam = resolveMediaUrl(damUrl);
assert.strictEqual(resolvedDam, '/media/running-woods-woman.jpg', 'FAIL: DAM path should resolve to /media/running-woods-woman.jpg');
console.log('✓ Test 1 Passed: DAM paths map correctly to /media/.');

// Test 2: URL-safe alias mapping (El Gordo Green.jpg -> El-Gordo-Green.jpg)
const originalWithSpace = '/content/dam/we-retail/en/products/apparel/El Gordo Green.jpg';
const resolvedAlias = resolveMediaUrl(originalWithSpace);
assert.strictEqual(resolvedAlias, '/media/El-Gordo-Green.jpg', 'FAIL: Space-containing DAM path must resolve to URL-safe alias');

const encodedOriginal = '/media/El%20Gordo%20Green.jpg';
const resolvedEncoded = resolveMediaUrl(encodedOriginal);
assert.strictEqual(resolvedEncoded, '/media/El-Gordo-Green.jpg', 'FAIL: Encoded space media path must resolve to URL-safe alias');
console.log('✓ Test 2 Passed: URL-safe alias mapping preserves El-Gordo-Green.jpg.');

// Test 3: Existing repository-hosted media paths remain correct and support codeBasePath
const localMedia = '/media/cart.png';
assert.strictEqual(resolveMediaUrl(localMedia), '/media/cart.png', 'FAIL: Local media path must resolve correctly');
assert.strictEqual(resolveMediaUrl(localMedia, '/we-retail'), '/we-retail/media/cart.png', 'FAIL: Local media path must honor codeBasePath');
console.log('✓ Test 3 Passed: Existing repository-hosted media paths remain correct with codeBasePath.');

// Test 4: Query strings and transformation parameters preservation
const mediaWithQuery = '/media/running-woods-woman.jpg?width=2000&format=webply&optimize=medium#section';
const resolvedQuery = resolveMediaUrl(mediaWithQuery);
assert.strictEqual(resolvedQuery, '/media/running-woods-woman.jpg?width=2000&format=webply&optimize=medium#section', 'FAIL: Query parameters and hash must be preserved');
console.log('✓ Test 4 Passed: Query strings and transformation hints are preserved.');

// Test 5: External absolute URLs are NOT rewritten as local repository assets
const externalHttps = 'https://images.unsplash.com/media/photo-123.jpg?width=800';
const externalHttp = 'http://external-cdn.com/content/dam/we-retail/banner.jpg';
const protocolRelative = '//cdn.example.org/media/avatar.png';
assert.strictEqual(resolveMediaUrl(externalHttps), externalHttps, 'FAIL: External HTTPS URL must not be rewritten');
assert.strictEqual(resolveMediaUrl(externalHttp), externalHttp, 'FAIL: External HTTP URL must not be rewritten');
assert.strictEqual(resolveMediaUrl(protocolRelative), protocolRelative, 'FAIL: Protocol-relative URL must not be rewritten');
assert.strictEqual(isExternalMediaUrl(externalHttps), true);
assert.strictEqual(isExternalMediaUrl(externalHttp), true);
assert.strictEqual(isExternalMediaUrl(protocolRelative), true);
assert.strictEqual(isExternalMediaUrl('/media/cart.png'), false);
console.log('✓ Test 5 Passed: External absolute URLs are not accidentally rewritten as local assets.');

// Test 6: Responsive image sources (srcset) with descriptors and query parameters
const rawSrcset = '/media/running-woods-woman.jpg?width=750&format=webply 750w, /content/dam/we-retail/en/products/apparel/El Gordo Green.jpg?width=2000&format=webply 2000w';
const resolvedSrcset = resolveMediaSrcset(rawSrcset);
assert(resolvedSrcset.includes('/media/running-woods-woman.jpg?width=750&format=webply 750w'), 'FAIL: First srcset candidate must resolve with query and descriptor');
assert(resolvedSrcset.includes('/media/El-Gordo-Green.jpg?width=2000&format=webply 2000w'), 'FAIL: Second srcset candidate must apply alias, query and descriptor');
console.log('✓ Test 6 Passed: Responsive image sources in srcset preserve descriptors and queries.');

// Test 7: Malformed URI safety
const malformedUri = '/media/corrupt%99file.jpg?param=1';
const safeDecoded = safeDecodeURIComponent('%99');
assert.strictEqual(safeDecoded, '%99', 'FAIL: safeDecodeURIComponent must not throw on malformed bytes');
const resolvedMalformed = resolveMediaUrl(malformedUri);
assert(typeof resolvedMalformed === 'string', 'FAIL: resolveMediaUrl must safely return string without throwing');
console.log('✓ Test 7 Passed: Malformed URIs do not crash decoding or URL resolution.');

// Test 8: normalizeMediaSources DOM manipulation on img and source
class MockNode {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attrs));
  }
  getAttribute(name) {
    return this.attributes.get(name) || null;
  }
  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }
}

class MockContainer {
  constructor() {
    this.imgs = [];
    this.sources = [];
  }
  querySelectorAll(sel) {
    if (sel === 'img') return this.imgs;
    if (sel === 'source') return this.sources;
    return [];
  }
}

const mockMain = new MockContainer();
const img1 = new MockNode('img', { src: '/content/dam/we-retail/en/El Gordo Green.jpg' });
const img2 = new MockNode('img', { src: 'https://cdn.example.com/media/external.jpg', srcset: '/media/running-woods-woman.jpg 1x, /media/running-woods-woman.jpg?width=2000 2x' });
const source1 = new MockNode('source', { srcset: '/content/dam/we-retail/logo.png 1x' });
mockMain.imgs.push(img1, img2);
mockMain.sources.push(source1);

normalizeMediaSources(mockMain);
assert.strictEqual(img1.src, '/media/El-Gordo-Green.jpg', 'FAIL: img1 src must resolve to alias');
assert.strictEqual(img1.getAttribute('data-original-source'), '/content/dam/we-retail/en/El Gordo Green.jpg', 'FAIL: img1 must record data-original-source');
assert.strictEqual(img2.src, undefined, 'FAIL: img2 external src must not be modified');
assert(img2.srcset.includes('/media/running-woods-woman.jpg 1x'), 'FAIL: img2 srcset must resolve');
assert.strictEqual(source1.srcset, '/media/logo.png 1x', 'FAIL: source1 srcset must resolve');
assert.strictEqual(source1.getAttribute('data-original-source'), '/content/dam/we-retail/logo.png 1x');
console.log('✓ Test 8 Passed: normalizeMediaSources updates DOM img and source elements safely.');

console.log('--- All 8 Stage 8 Media Normalisation Tests Passed Successfully ---');
