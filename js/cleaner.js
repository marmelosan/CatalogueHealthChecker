/* Cleanup + Shopify-format export engine.
   Reuses the sibling Catalogue Health Checker's field-mapping (shopify-fields.js),
   price normalisation (price.js) and exact-duplicate grouping (duplicates.js) as
   its base, then adds what's new for this tool: generating valid handles,
   deduping them, and assembling output rows in Shopify's product CSV format —
   flagging problem rows instead of dropping them. */
(function (global) {
  'use strict';

  var CC = global.CatalogueCleaner;

  var ACTIVE_STATUS_VALUES = ['active', 'published', 'publish', 'enabled', 'enable', 'yes', 'true', '1', 'in stock', 'visible'];

  // Fixed values applied to every row so the file behaves as a single set of
  // simple, single-variant products and Shopify actually applies the stock
  // quantities we write (a tracked variant needs a tracker service and an
  // out-of-stock policy, or Shopify's import ignores Variant Inventory Qty).
  var FIXED = {
    option1Name: 'Title',
    option1Value: 'Default Title',
    inventoryTracker: 'shopify',
    inventoryPolicy: 'deny'
  };

  var OUTPUT_COLUMNS = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Price',
    'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
    'Image Src', 'Needs Review', 'Review Notes'
  ];

  var FLAG_MESSAGES = {
    missing_title: 'Title is empty',
    missing_image: 'Image is missing',
    invalid_price: 'Price could not be read as a valid number',
    duplicate_title: 'Title is used by more than one row',
    duplicate_handle: 'Handle is used by more than one row (would merge these into one product\'s variants on import)'
  };

  function get(raw, headerName) {
    if (!headerName) return '';
    var v = raw[headerName];
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function cleanText(v) {
    return String(v || '').trim().replace(/[ \t]+/g, ' ');
  }

  function cleanTags(v) {
    return String(v || '')
      .split(',')
      .map(function (t) { return t.trim(); })
      .filter(Boolean)
      .join(', ');
  }

  function slugify(str) {
    return String(str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents: "Caf\u00e9" -> "Cafe"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function parseQty(raw) {
    if (raw === '') return '';
    var n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(n)) return '';
    return String(Math.round(n));
  }

  function isActiveStatus(status) {
    return ACTIVE_STATUS_VALUES.indexOf(String(status).toLowerCase().trim()) !== -1;
  }

  function buildNormalizedRows(data, mapping) {
    return data.map(function (raw, index) {
      return {
        index: index,
        title: cleanText(get(raw, mapping.title)),
        handleRaw: slugify(get(raw, mapping.handle)),
        bodyHtml: cleanText(get(raw, mapping.bodyHtml)),
        vendor: cleanText(get(raw, mapping.vendor)),
        type: cleanText(get(raw, mapping.type)),
        tags: cleanTags(get(raw, mapping.tags)),
        publishedRaw: get(raw, mapping.published),
        sku: cleanText(get(raw, mapping.sku)),
        priceRaw: get(raw, mapping.price),
        inventoryRaw: get(raw, mapping.inventoryQty),
        imageSrc: cleanText(get(raw, mapping.imageSrc))
      };
    });
  }

  function run(config) {
    var data = config.data;
    var mapping = config.mapping;
    var onProgress = config.onProgress || function () {};
    var onComplete = config.onComplete || function () {};

    var mapped = {};
    Object.keys(mapping).forEach(function (k) { mapped[k] = !!mapping[k]; });

    var rows = buildNormalizedRows(data, mapping);

    var titleDupes = CC.findExactDuplicateGroups(rows, function (r) { return r.title; });
    var userHandleDupes = mapped.handle
      ? CC.findExactDuplicateGroups(rows, function (r) { return r.handleRaw; })
      : new Map();

    // Handles already taken, so generated ones never collide with a
    // user-supplied handle or with one another. User-supplied handles are
    // flagged (never rewritten) if they collide with each other.
    var takenHandles = {};
    rows.forEach(function (r) { if (r.handleRaw) takenHandles[r.handleRaw] = true; });

    var outputRows = [];
    var flagCounts = {};
    var flaggedRowCount = 0;

    function uniqueGeneratedHandle(base) {
      if (!base) return '';
      var candidate = base;
      var n = 2;
      while (takenHandles[candidate]) {
        candidate = base + '-' + n;
        n++;
      }
      takenHandles[candidate] = true;
      return candidate;
    }

    function processRow(r) {
      var flags = [];

      if (!r.title) flags.push('missing_title');
      if (mapped.title && titleDupes.has(r.index)) flags.push('duplicate_title');

      var handle;
      if (r.handleRaw) {
        handle = r.handleRaw;
        if (userHandleDupes.has(r.index)) flags.push('duplicate_handle');
      } else {
        handle = uniqueGeneratedHandle(slugify(r.title));
      }

      var bodyHtml = r.bodyHtml;
      var vendor = r.vendor;
      var type = r.type;
      var tags = r.tags;

      var published = mapped.published ? (isActiveStatus(r.publishedRaw) ? 'TRUE' : 'FALSE') : 'TRUE';

      var sku = r.sku;

      var price = '';
      if (mapped.price) {
        var parsedPrice = CC.parsePrice(r.priceRaw);
        if (r.priceRaw === '' || !isFinite(parsedPrice) || parsedPrice <= 0) {
          flags.push('invalid_price');
        } else {
          price = CC.formatPrice(parsedPrice);
        }
      }

      var inventoryQty = mapped.inventoryQty ? parseQty(r.inventoryRaw) : '';

      var imageSrc = r.imageSrc;
      if (mapped.imageSrc && !imageSrc) flags.push('missing_image');

      flags.forEach(function (f) { flagCounts[f] = (flagCounts[f] || 0) + 1; });
      if (flags.length) flaggedRowCount++;

      outputRows.push([
        handle,
        r.title,
        bodyHtml,
        vendor,
        type,
        tags,
        published,
        FIXED.option1Name,
        FIXED.option1Value,
        sku,
        price,
        FIXED.inventoryTracker,
        inventoryQty,
        FIXED.inventoryPolicy,
        imageSrc,
        flags.length ? 'TRUE' : 'FALSE',
        flags.map(function (f) { return FLAG_MESSAGES[f]; }).join('; ')
      ]);
    }

    var i = 0;
    var chunkSize = 2000;
    function step() {
      var end = Math.min(i + chunkSize, rows.length);
      for (; i < end; i++) processRow(rows[i]);
      onProgress(i / rows.length);
      if (i < rows.length) {
        setTimeout(step, 0);
      } else {
        onComplete({
          columns: OUTPUT_COLUMNS,
          rows: outputRows,
          totalRows: rows.length,
          flaggedRowCount: flaggedRowCount,
          flagCounts: flagCounts
        });
      }
    }
    step();
  }

  function exportCsv(result, filename) {
    var csv = Papa.unparse({ fields: result.columns, data: result.rows });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'cleaned-catalogue-shopify.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  CC.FLAG_MESSAGES = FLAG_MESSAGES;
  CC.OUTPUT_COLUMNS = OUTPUT_COLUMNS;
  CC.run = run;
  CC.exportCsv = exportCsv;
})(window);
