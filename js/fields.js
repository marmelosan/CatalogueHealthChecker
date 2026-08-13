/* Canonical field definitions + auto-detection aliases for common CSV exports
   (Shopify, WooCommerce, PrestaShop). Used to pre-fill the column mapping step. */
(function (global) {
  'use strict';

  var FIELDS = [
    {
      key: 'sku',
      label: 'SKU',
      hint: 'Unique product identifier',
      aliases: ['sku', 'variant sku', 'reference', 'ref', 'product id', 'id', 'item number']
    },
    {
      key: 'title',
      label: 'Title',
      hint: 'Product name',
      aliases: ['title', 'name', 'product name', 'post_title']
    },
    {
      key: 'description',
      label: 'Description',
      hint: 'Product description / body copy',
      aliases: ['description', 'body (html)', 'body', 'post_content', 'product description', 'long description', 'description_short']
    },
    {
      key: 'price',
      label: 'Price (regular)',
      hint: 'The normal, non-discounted price. In Shopify exports this is usually "Variant Compare At Price"; in WooCommerce, "Regular price".',
      aliases: ['regular price', 'compare at price', 'variant compare at price', 'price', 'msrp', 'base price']
    },
    {
      key: 'salePrice',
      label: 'Sale price',
      hint: 'The discounted price the customer actually pays, if different from the regular price. In Shopify exports this is usually just "Variant Price"; in WooCommerce, "Sale price". Leave unmapped if your catalogue has no separate sale price.',
      aliases: ['sale price', 'variant price', 'special price', 'discount price', 'promo price']
    },
    {
      key: 'imageUrl',
      label: 'Image URL',
      hint: 'Main product image link',
      aliases: ['image src', 'image url', 'image', 'images', 'main image', 'featured image']
    },
    {
      key: 'category',
      label: 'Category',
      hint: 'Product category / type',
      aliases: ['product category', 'category', 'categories', 'type', 'product type', 'collection']
    },
    {
      key: 'stock',
      label: 'Stock quantity',
      hint: 'Units currently in stock',
      aliases: ['variant inventory qty', 'stock', 'quantity', 'inventory quantity', 'inventory', 'qty']
    },
    {
      key: 'status',
      label: 'Status',
      hint: 'Whether the product is active/published',
      aliases: ['status', 'published', 'active', 'visibility', 'state']
    }
  ];

  function normalizeHeader(h) {
    return String(h || '')
      .toLowerCase()
      .replace(/[_\-]+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Greedy best-match assignment: each field claims its best-scoring unused header.
  function autoDetectMapping(headers) {
    var normalized = headers.map(normalizeHeader);
    var used = new Array(headers.length).fill(false);
    var mapping = {};

    FIELDS.forEach(function (field) {
      var bestIdx = -1;
      var bestScore = 0;
      normalized.forEach(function (norm, idx) {
        if (used[idx]) return;
        var score = 0;
        for (var i = 0; i < field.aliases.length; i++) {
          var alias = field.aliases[i];
          if (norm === alias) { score = 100 - i; break; }
          if (norm.indexOf(alias) !== -1) { score = Math.max(score, 50 - i); }
        }
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      });
      if (bestIdx !== -1 && bestScore > 0) {
        mapping[field.key] = headers[bestIdx];
        used[bestIdx] = true;
      } else {
        mapping[field.key] = '';
      }
    });

    return mapping;
  }

  global.CatalogueChecker = global.CatalogueChecker || {};
  global.CatalogueChecker.FIELDS = FIELDS;
  global.CatalogueChecker.autoDetectMapping = autoDetectMapping;
  global.CatalogueChecker.normalizeHeader = normalizeHeader;
})(window);
