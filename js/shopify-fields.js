/* Destination field definitions for Shopify's product CSV import format, plus
   auto-detection aliases for common supplier/CSV export column names.
   Same normalize-and-score matching algorithm as the sibling Catalogue Health
   Checker's fields.js, retargeted at Shopify's column names as the destination
   instead of a generic canonical set. Used to pre-fill the column mapping step. */
(function (global) {
  'use strict';

  // Order matches the order columns are written in the exported CSV.
  var FIELDS = [
    {
      key: 'title',
      label: 'Title',
      shopifyColumn: 'Title',
      required: true,
      hint: 'Product name. Required — rows with no title can’t be imported.',
      aliases: ['title', 'name', 'product name', 'post_title']
    },
    {
      key: 'handle',
      label: 'Handle',
      shopifyColumn: 'Handle',
      required: false,
      hint: 'Unique URL slug. Leave unmapped to auto-generate one from the title for every row.',
      aliases: ['handle', 'url handle', 'slug']
    },
    {
      key: 'bodyHtml',
      label: 'Body (HTML)',
      shopifyColumn: 'Body (HTML)',
      required: false,
      hint: 'Product description, can include HTML.',
      aliases: ['body (html)', 'body', 'description', 'product description', 'long description', 'post_content']
    },
    {
      key: 'vendor',
      label: 'Vendor',
      shopifyColumn: 'Vendor',
      required: false,
      hint: 'Brand or manufacturer name.',
      aliases: ['vendor', 'brand', 'manufacturer', 'supplier']
    },
    {
      key: 'type',
      label: 'Type',
      shopifyColumn: 'Type',
      required: false,
      hint: 'Product type / category, used for Shopify’s automated collections.',
      aliases: ['type', 'product type', 'product category', 'category', 'categories']
    },
    {
      key: 'tags',
      label: 'Tags',
      shopifyColumn: 'Tags',
      required: false,
      hint: 'Comma-separated tags.',
      aliases: ['tags', 'keywords', 'labels']
    },
    {
      key: 'published',
      label: 'Published',
      shopifyColumn: 'Published',
      required: false,
      hint: 'Whether the product should be visible in the store. Leave unmapped to publish every row by default.',
      aliases: ['published', 'status', 'active', 'visibility', 'state']
    },
    {
      key: 'sku',
      label: 'Variant SKU',
      shopifyColumn: 'Variant SKU',
      required: false,
      hint: 'Unique product/variant identifier.',
      aliases: ['variant sku', 'sku', 'reference', 'ref', 'product id', 'item number']
    },
    {
      key: 'price',
      label: 'Variant Price',
      shopifyColumn: 'Variant Price',
      required: false,
      hint: 'The price the customer pays. Currency symbols and comma decimals are normalised automatically.',
      aliases: ['variant price', 'price', 'sale price', 'special price', 'selling price', 'cost', 'unit cost', 'wholesale price', 'wholesale cost', 'supplier price', 'trade price']
    },
    {
      key: 'inventoryQty',
      label: 'Variant Inventory Qty',
      shopifyColumn: 'Variant Inventory Qty',
      required: false,
      hint: 'Units currently in stock. Must be a whole number.',
      aliases: ['variant inventory qty', 'stock', 'quantity', 'inventory quantity', 'inventory', 'qty']
    },
    {
      key: 'imageSrc',
      label: 'Image Src',
      shopifyColumn: 'Image Src',
      required: false,
      hint: 'Main product image URL.',
      aliases: ['image src', 'image url', 'image', 'images', 'main image', 'featured image']
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

  // Header names for columns that are almost never a price even when their
  // values happen to be numeric (plain integer quantities, IDs, barcodes),
  // so they're excluded from the content-based price heuristic below.
  var NEVER_PRICE_HEADER_WORDS = ['qty', 'quantity', 'stock', 'inventory', 'sku', 'handle', 'id', 'barcode', 'upc', 'ean', 'weight', 'grams', 'year'];

  // Catches a price column an alias match missed (any header name a supplier
  // might use) by looking at what the values actually look like, rather than
  // what the column is called. Real prices are written with a currency
  // symbol or a decimal fraction ("$45.00", "19,90"); plain integer counts
  // (stock, quantities) are not, which keeps this from flagging those.
  function looksMonetary(raw) {
    return /[$€£]|[.,]\d{1,2}\b/.test(String(raw));
  }

  function findUnmappedPriceLikeColumns(headers, rows, mapping) {
    var usedHeaders = {};
    Object.keys(mapping).forEach(function (k) { if (mapping[k]) usedHeaders[mapping[k]] = true; });

    var sampleSize = Math.min(rows.length, 25);
    var found = [];

    headers.forEach(function (header) {
      if (usedHeaders[header]) return;
      var norm = normalizeHeader(header);
      if (NEVER_PRICE_HEADER_WORDS.some(function (w) { return norm.indexOf(w) !== -1; })) return;

      var sampled = 0;
      var monetary = 0;
      for (var i = 0; i < rows.length && sampled < sampleSize; i++) {
        var v = rows[i][header];
        if (v === null || v === undefined || String(v).trim() === '') continue;
        sampled++;
        var n = global.CatalogueCleaner.parsePrice(v);
        if (isFinite(n) && n > 0 && looksMonetary(v)) monetary++;
      }
      if (sampled > 0 && monetary / sampled >= 0.7) found.push(header);
    });

    return found;
  }

  global.CatalogueCleaner = global.CatalogueCleaner || {};
  global.CatalogueCleaner.FIELDS = FIELDS;
  global.CatalogueCleaner.autoDetectMapping = autoDetectMapping;
  global.CatalogueCleaner.normalizeHeader = normalizeHeader;
  global.CatalogueCleaner.findUnmappedPriceLikeColumns = findUnmappedPriceLikeColumns;
})(window);
