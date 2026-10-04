// Placeholder: shows the original URL that the DNR redirect rule stored in the hash
// (`<page>.html#https://…`, unencoded). Replaced by the real page in Phase 3c.
const target = document.getElementById('target');
target.textContent = location.hash.slice(1);
