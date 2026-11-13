export default function decorate(block) {
  block.innerHTML = `
<div class="we-footer">
  <div class="we-footer-container">
    <div class="we-footer-brand">we.<strong>Retail</strong></div>
    <div class="we-footer-links">
      <a href="/content/we-retail/us/en/experience.html">Experience</a>
      <a href="/content/we-retail/us/en/men.html">Men</a>
      <a href="/content/we-retail/us/en/women.html">Women</a>
      <a href="/content/we-retail/us/en/equipment.html">Equipment</a>
      <a href="/content/we-retail/us/en/about-us.html">About Us</a>
      <a href="/content/we-retail/us/en/products.html">Products</a>
      <a href="/content/we-retail/us/en/community.html">Community</a>
    </div>
    <div class="we-footer-copy">
      &copy; 2026 All rights reserved &bull; <a href="#">Terms of use &amp; privacy policy</a> &bull; <a href="#top" class="we-ride-top">Ride to the top</a>
    </div>
  </div>
</div>`;
}

