/**
 * Columns block — We.Retail EDS
 * Used for service-feature rows (sitefeature: icon + title + description).
 * No JS transformation needed; CSS handles layout.
 * This file exists to satisfy block auto-discovery by aem.js.
 */
export default function decorate(block) {
  // Promote each child div to .columns-item for targeted CSS
  [...block.children].forEach((item) => {
    item.classList.add('columns-item');
  });
}

