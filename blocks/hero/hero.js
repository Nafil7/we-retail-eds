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
export default function decorate(block) {
  // Idempotency guard — skip if already decorated
  if (block.querySelector('.hero-content')) return;

  // Row 0 → picture/image; Row 1 → richtext content (h1 + p + CTA p)
  const rows = [...block.children];
  const imgRow = rows[0];
  const contentRow = rows[1];

  if (!imgRow || !contentRow) return;

  // Extract the picture element from row 0
  const pic = imgRow.querySelector('picture') || imgRow.querySelector('img');
  if (pic) {
    // Move picture to be first child of block (absolute cover layer via CSS)
    block.prepend(pic.closest('picture') || pic);
  }

  // Promote the content row to .hero-content
  contentRow.classList.add('hero-content');

  // Find the last <p> that contains only an <a> → make it a CTA button
  const paras = [...contentRow.querySelectorAll('p')];
  paras.forEach((p) => {
    const anchors = [...p.querySelectorAll('a')];
    if (anchors.length === 1 && p.textContent.trim() === anchors[0].textContent.trim()) {
      anchors[0].classList.add('button', 'primary');
      p.classList.add('button-wrapper');
    }
  });

  // Remove the now-empty image row (picture already moved above)
  if (imgRow !== pic?.closest('picture')) {
    imgRow.remove();
  } else {
    // imgRow contains non-picture content — just remove if empty
    if (!imgRow.children.length) imgRow.remove();
  }
}
