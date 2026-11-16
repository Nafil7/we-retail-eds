/**
 * Hero block decorator — We.Retail EDS
 *
 * The Cloud AEM raw HTML delivers the hero block as:
 *   <div class="hero">
 *     <div>  ← row 0: image cell
 *       <picture><img src="..." alt="..."></picture>
 *     </div>
 *     <div>  ← row 1: content cell with richtext `text` field
 *       <h1 data-richtext-prop="text">...</h1>
 *       <p   data-richtext-prop="text">subheading</p>
 *       <p   data-richtext-prop="text"><a href="...">CTA text</a></p>
 *     </div>
 *   </div>
 *
 * We must:
 *   1. Keep the picture absolute-positioned behind the content.
 *   2. Promote the existing content div as .hero-content (preserving h1, p, a).
 *   3. Turn the last <p><a> into a styled .button link.
 *   4. Be idempotent (skip if already decorated).
 *
 * First divergence proven: hero.js was destroying the second <div> by recreating
 * only an <h1> from textContent, losing the <p> eyebrow and the CTA <a>.
 */
/**
 * Hero block decorator — We.Retail EDS
 *
 * Handles all migrated hero block markup shapes:
 *   - 1 row with multiple cells (image, heading, subtitle, CTA)
 *   - Multiple rows (one cell each)
 *   - 2 rows (image row + content row)
 *
 * Guarantees:
 *   1. Background picture placed in .hero-image layer (absolute, z-index: 1).
 *   2. Contrast overlay (.hero::after, z-index: 2).
 *   3. Heading, subtitle, and CTA grouped into a unified .hero-content container (z-index: 3).
 *   4. Styled .button link for primary action.
 *   5. Idempotent against repeated execution.
 */
export default function decorate(block) {
  // Idempotency guard — skip if already decorated
  if (block.classList.contains('hero-decorated') || block.querySelector('.hero-content')) return;

  // Extract the picture element from anywhere within the block
  const pic = block.querySelector('picture') || block.querySelector('img');
  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'hero-image';
  if (pic) {
    const picContainer = pic.closest('picture') || pic;
    imageWrapper.appendChild(picContainer);
  }

  // Create unified content wrapper for all non-picture elements
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'hero-content';

  // Traverse the original block structure (rows and cells) and harvest all authored content
  // preserving every heading, paragraph, list, link, and text node verbatim
  const rows = [...block.children];
  rows.forEach((row) => {
    const cells = [...row.children];
    cells.forEach((cell) => {
      const nodes = [...cell.childNodes];
      nodes.forEach((node) => {
        if (node.nodeType === 1) { // ELEMENT_NODE
          if (node.tagName === 'PICTURE' || node.tagName === 'IMG') return;
          if (node.querySelector && node.querySelector('picture, img')) {
            const innerPic = node.querySelector('picture, img');
            if (innerPic) innerPic.remove();
          }
          if (node.textContent.trim() === '' && node.children.length === 0) return;
          contentWrapper.appendChild(node);
        } else if (node.nodeType === 3) { // TEXT_NODE
          if (node.textContent.trim()) {
            const p = document.createElement('p');
            p.textContent = node.textContent.trim();
            contentWrapper.appendChild(p);
          }
        }
      });
    });
  });

  // Style CTA button: find <p> containing an <a>
  const paras = [...contentWrapper.querySelectorAll('p')];
  paras.forEach((p) => {
    const anchors = [...p.querySelectorAll('a')];
    if (anchors.length === 1 && p.textContent.trim() === anchors[0].textContent.trim()) {
      anchors[0].classList.add('button', 'primary');
      p.classList.add('button-wrapper');
    }
  });

  // If there are standalone anchors in contentWrapper without button styling
  const standaloneAnchors = [...contentWrapper.querySelectorAll('a:not(.button)')];
  standaloneAnchors.forEach((a) => {
    if (!a.closest('p')) {
      a.classList.add('button', 'primary');
      const wrapper = document.createElement('p');
      wrapper.className = 'button-wrapper';
      a.replaceWith(wrapper);
      wrapper.appendChild(a);
    }
  });

  // Clean and rebuild block with exact two-child structure:
  // Child 0: hero-image (z-index 1 background)
  // Child 1: hero-content (z-index 3 lower-left content)
  block.innerHTML = '';
  block.appendChild(imageWrapper);
  block.appendChild(contentWrapper);
  block.classList.add('hero-decorated');
}
