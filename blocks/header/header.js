export default function decorate(block) {
  // Ensure top anchor exists for footer "Ride to the top" link
  const headerParent = block.closest('header') || block;
  if (!headerParent.id) {
    headerParent.id = 'top';
  }

  block.innerHTML = `
<div class="we-header-utility">
  <div class="we-header-container">
    <div class="we-lang">
      <button class="we-lang-btn" id="we-lang-btn" type="button" aria-expanded="false" aria-haspopup="true" aria-controls="we-lang-menu" aria-label="Select Language">
        <span class="we-flag">&#x1f1fa;&#x1f1f8;</span> EN <span class="we-lang-arrow" aria-hidden="true">&#x25be;</span>
      </button>
      <div class="we-lang-dropdown" id="we-lang-menu" role="menu" aria-labelledby="we-lang-btn">
        <a href="/content/we-retail/us/en.html" class="active" role="menuitem" tabindex="-1">United States (EN)</a>
        <a href="/content/we-retail/us/es.html" role="menuitem" tabindex="-1">United States (ES)</a>
        <a href="/content/we-retail/ca/en.html" role="menuitem" tabindex="-1">Canada (EN)</a>
        <a href="/content/we-retail/ca/fr.html" role="menuitem" tabindex="-1">Canada (FR)</a>
        <a href="/content/we-retail/de/de.html" role="menuitem" tabindex="-1">Germany (DE)</a>
        <a href="/content/we-retail/fr/fr.html" role="menuitem" tabindex="-1">France (FR)</a>
      </div>
    </div>
    <div class="we-user-nav">
      <a href="/content/we-retail/us/en/user/account.html">ACCOUNT</a>
      <a href="/content/we-retail/us/en/user/profile.html">PROFILE</a>
      <a href="/content/we-retail/us/en/user/wishlist.html">&#x2661; WISHLIST</a>
      <a href="/content/we-retail/us/en/user/cart.html" class="we-cart">&#x1f6d2; MY CART</a>
    </div>
  </div>
</div>
<div class="we-header-main">
  <div class="we-header-container">
    <div class="we-logo">
      <a href="/content/we-retail/us/en.html">
        <span class="we-logo-we">WE</span><span class="we-logo-dot">.</span><span class="we-logo-retail">RETAIL</span>
      </a>
    </div>
    <nav class="we-nav">
      <a href="/content/we-retail/us/en/experience.html">EXPERIENCE</a>
      <a href="/content/we-retail/us/en/men.html">MEN</a>
      <a href="/content/we-retail/us/en/women.html">WOMEN</a>
      <a href="/content/we-retail/us/en/equipment.html">EQUIPMENT</a>
      <a href="/content/we-retail/us/en/about-us.html">ABOUT US</a>
      <a href="/content/we-retail/us/en/products.html">PRODUCTS</a>
      <a href="/content/we-retail/us/en/community.html">COMMUNITY</a>
    </nav>
    <div class="we-actions">
      <form class="we-search-form" action="/content/we-retail/us/en/search.html" method="get" role="search">
        <input class="we-search-input" type="search" name="fulltext" placeholder="Search" aria-label="Search">
        <button class="we-search-btn" aria-label="Search" type="submit">&#x1f50d;</button>
      </form>
    </div>
  </div>
</div>`;

  // Item C: Accessible Language Selector (APG Menu Button Pattern)
  const langContainer = block.querySelector('.we-lang');
  const langBtn = block.querySelector('.we-lang-btn');
  const langDropdown = block.querySelector('.we-lang-dropdown');
  const menuItems = langDropdown ? [...langDropdown.querySelectorAll('a')] : [];

  if (langBtn && langContainer && langDropdown) {
    const toggleDropdown = (open, focusFirst = false) => {
      const shouldOpen = open !== undefined ? open : !langContainer.classList.contains('open');
      langContainer.classList.toggle('open', shouldOpen);
      langBtn.setAttribute('aria-expanded', String(shouldOpen));
      if (shouldOpen && focusFirst && menuItems.length > 0) {
        menuItems[0].focus();
      }
    };

    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    langBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDropdown(undefined, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        toggleDropdown(true, true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        toggleDropdown(true);
        if (menuItems.length > 0) menuItems[menuItems.length - 1].focus();
      } else if (e.key === 'Escape' && langContainer.classList.contains('open')) {
        e.preventDefault();
        toggleDropdown(false);
        langBtn.focus();
      }
    });

    // Keyboard navigation within menu items
    menuItems.forEach((item, index) => {
      item.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIndex = (index + 1) % menuItems.length;
          menuItems[nextIndex].focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIndex = (index - 1 + menuItems.length) % menuItems.length;
          menuItems[prevIndex].focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          menuItems[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          menuItems[menuItems.length - 1].focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          toggleDropdown(false);
          langBtn.focus();
        } else if (e.key === 'Tab') {
          // Allow tab to close menu and proceed
          toggleDropdown(false);
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!langContainer.contains(e.target)) {
        toggleDropdown(false);
      }
    });
  }

  // Item D: Accessible Search Form (Enter submit, focus, toggle, parameter preservation)
  const searchForm = block.querySelector('.we-search-form');
  const searchBtn = block.querySelector('.we-search-btn');
  const searchInput = block.querySelector('.we-search-input');

  if (searchForm && searchBtn && searchInput) {
    const openSearch = () => {
      searchForm.classList.add('active');
      searchInput.classList.add('active');
      searchInput.focus();
    };

    const closeSearch = () => {
      searchForm.classList.remove('active');
      searchInput.classList.remove('active');
    };

    searchBtn.addEventListener('click', (e) => {
      if (!searchForm.classList.contains('active')) {
        e.preventDefault();
        openSearch();
      } else if (!searchInput.value.trim()) {
        e.preventDefault();
        closeSearch();
      }
      // If active and has value, form submits natively with name="fulltext"
    });

    searchForm.addEventListener('submit', (e) => {
      if (!searchInput.value.trim()) {
        e.preventDefault();
        closeSearch();
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSearch();
        searchBtn.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchForm.contains(e.target)) {
        if (!searchInput.value.trim()) {
          closeSearch();
        }
      }
    });
  }
}

