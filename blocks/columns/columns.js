/**
 * Columns block — We.Retail EDS
 * Used for service-feature rows (sitefeature: icon + title + description)
 * and multi-column photo/community rows.
 */
export default function decorate(block) {
  // Promote each child row and column
  [...block.children].forEach((row) => {
    row.classList.add('columns-row', 'columns-item');
    [...row.children].forEach((col) => {
      col.classList.add('columns-col');
      // If col contains picture/img AND text (h1-h6 or p) as direct siblings,
      // group the text elements into a .columns-text wrapper so heading and description
      // form a coherent vertical text unit alongside the icon
      const pic = col.querySelector('picture, img');
      if (pic) {
        const textElements = [...col.children].filter(
          (el) => el !== pic && !el.contains(pic) && !el.classList.contains('columns-text')
        );
        if (textElements.length > 0) {
          const textWrapper = document.createElement('div');
          textWrapper.className = 'columns-text';
          textElements.forEach((node) => textWrapper.appendChild(node));
          col.appendChild(textWrapper);
        }
      }
    });
  });
}

