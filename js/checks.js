/* Check definitions (id -> severity, title, plain-English commercial explanation)
   and the batched analysis engine. Checks whose required field(s) were not
   mapped are skipped entirely rather than reported as broken. */
(function (global) {
  'use strict';

  var CHECKS = {
    missing_image: {
      severity: 'critical',
      title: 'Missing image',
      explain: 'Products without a photo rarely get clicked, let alone bought. Shoppers scroll straight past them, and on marketplaces they may be excluded from listings entirely.'
    },
    missing_title: {
      severity: 'critical',
      title: 'Missing title',
      explain: "A product with no title can't be found in search or browsed in a category page. It is effectively invisible to customers."
    },
    invalid_price: {
      severity: 'critical',
      title: 'Invalid price',
      explain: 'A missing, zero, negative or non-numeric price usually means the product cannot be purchased at all, or can be added to cart for free.'
    },
    inverted_sale_price: {
      severity: 'critical',
      title: 'Inverted sale price',
      explain: "When the ‘sale’ price is not actually lower than the regular price, customers feel misled — and in several regions this kind of pricing display is regulated."
    },
    duplicate_sku: {
      severity: 'critical',
      title: 'Duplicate SKU',
      explain: 'The same SKU on multiple products breaks inventory sync, sales reporting, and can cause the wrong item to ship.'
    },
    missing_description: {
      severity: 'high',
      title: 'Missing description',
      explain: 'No description means shoppers have no answer to "what is this and why should I buy it", and search engines have nothing to index.'
    },
    thin_description: {
      severity: 'high',
      title: 'Thin description',
      explain: 'Very short descriptions under-inform buyers and give search engines little to work with, which hurts organic ranking.'
    },
    duplicate_description: {
      severity: 'high',
      title: 'Duplicate description',
      explain: 'Near-identical copy across unrelated products reads as low effort to shoppers and can be treated as duplicate content by search engines, hurting rankings for all of the affected pages.'
    },
    missing_category: {
      severity: 'high',
      title: 'Missing category',
      explain: 'Uncategorised products are hard to browse to and often missing from navigation and filters, so shoppers never find them.'
    },
    duplicate_title: {
      severity: 'high',
      title: 'Duplicate title',
      explain: 'Identical titles make it hard for shoppers to tell products apart, and can dilute or confuse search results between listings.'
    },
    title_too_long: {
      severity: 'medium',
      title: 'Title too long',
      explain: 'Titles over about 70 characters get truncated in Google search results, cutting off the part meant to sell the click.'
    },
    title_too_short: {
      severity: 'medium',
      title: 'Title too short',
      explain: "Very short titles usually lack the descriptive detail (brand, material, size) shoppers search for, hurting discoverability."
    },
    active_out_of_stock: {
      severity: 'medium',
      title: 'Active but out of stock',
      explain: 'The product is live and being promoted but cannot actually be bought — wasted traffic and a poor experience for shoppers who reach it.'
    },
    suspicious_price: {
      severity: 'medium',
      title: 'Suspicious price',
      explain: "This price is far outside the normal range for its category. It may be a genuine premium or clearance item, or it may be a data error (misplaced decimal, wrong currency, copy-paste mistake) — worth a quick manual check."
    },
    unrounded_price: {
      severity: 'medium',
      title: 'Unrounded price',
      explain: "Prices that don't end in a typical price point (like .99, .95 or .00) often come from automated percentage-discount rules. Inconsistent-looking prices next to hand-set ones can make a store feel less trustworthy. This is an observation, not necessarily an error."
    }
  };

  var SEVERITY_ORDER = ['critical', 'high', 'medium'];
  var ACTIVE_STATUS_VALUES = ['active', 'published', 'publish', 'enabled', 'enable', 'yes', 'true', '1', 'in stock', 'visible'];
  var COMMON_CENT_ENDINGS = [0, 95, 99, 49, 50];

  function parsePrice(raw) {
    if (raw === null || raw === undefined) return NaN;
    var s = String(raw).trim();
    if (s === '') return NaN;
    var negative = /^-/.test(s.replace(/[^0-9,.\-]/g, ''));
    s = s.replace(/[^0-9.,]/g, '');
    if (s === '') return NaN;

    var lastDot = s.lastIndexOf('.');
    var lastComma = s.lastIndexOf(',');

    if (lastDot !== -1 && lastComma !== -1) {
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastComma !== -1) {
      var afterComma = s.length - lastComma - 1;
      var commaCount = s.split(',').length - 1;
      if (commaCount === 1 && afterComma <= 2) {
        s = s.replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastDot !== -1) {
      var afterDot = s.length - lastDot - 1;
      var dotCount = s.split('.').length - 1;
      if (dotCount > 1 || afterDot === 3) {
        s = s.replace(/\./g, '');
      }
    }

    var n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return negative ? -n : n;
  }

  function get(rawRow, headerName) {
    if (!headerName) return '';
    var v = rawRow[headerName];
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function buildNormalizedRows(data, mapping) {
    return data.map(function (raw, index) {
      var priceRaw = get(raw, mapping.price);
      var salePriceRaw = get(raw, mapping.salePrice);
      var stockRaw = get(raw, mapping.stock);
      return {
        index: index,
        sku: get(raw, mapping.sku),
        title: get(raw, mapping.title),
        description: get(raw, mapping.description),
        priceRaw: priceRaw,
        price: parsePrice(priceRaw),
        salePriceRaw: salePriceRaw,
        salePrice: parsePrice(salePriceRaw),
        // The price actually charged: the sale price when one is set,
        // otherwise the regular price. Needed because which of the two
        // fields is "always populated" is platform-dependent — Shopify
        // exports typically leave Compare At Price (our "price") blank for
        // non-sale products and always populate Price (our "salePrice"),
        // while WooCommerce is the other way around. Checks that care about
        // "is this product's price valid/sane" should look at whatever the
        // customer would actually pay, not assume either field is populated.
        effectivePriceRaw: salePriceRaw !== '' ? salePriceRaw : priceRaw,
        effectivePrice: salePriceRaw !== '' ? parsePrice(salePriceRaw) : parsePrice(priceRaw),
        imageUrl: get(raw, mapping.imageUrl),
        category: get(raw, mapping.category),
        stockRaw: stockRaw,
        stock: stockRaw === '' ? NaN : parseFloat(stockRaw.replace(',', '.')),
        status: get(raw, mapping.status)
      };
    });
  }

  function isActiveStatus(status) {
    return ACTIVE_STATUS_VALUES.indexOf(String(status).toLowerCase().trim()) !== -1;
  }

  function computeCategoryMedians(rows, mappedAnyPrice, mappedCategory) {
    if (!mappedAnyPrice || !mappedCategory) return {};
    var byCategory = {};
    rows.forEach(function (r) {
      if (!r.category || !isFinite(r.effectivePrice) || r.effectivePrice <= 0) return;
      if (!byCategory[r.category]) byCategory[r.category] = [];
      byCategory[r.category].push(r.effectivePrice);
    });
    var medians = {};
    Object.keys(byCategory).forEach(function (cat) {
      var prices = byCategory[cat];
      if (prices.length >= 5) {
        medians[cat] = global.CatalogueChecker.similarity.median(prices);
      }
    });
    return medians;
  }

  function runChecks(config) {
    var data = config.data;
    var mapping = config.mapping;
    var similarityThreshold = config.similarityThreshold || 90;
    var onProgress = config.onProgress || function () {};
    var onComplete = config.onComplete || function () {};

    var mapped = {};
    Object.keys(mapping).forEach(function (k) { mapped[k] = !!mapping[k]; });

    var rows = buildNormalizedRows(data, mapping);
    var mappedAnyPrice = mapped.price || mapped.salePrice;

    var skuDupes = mapped.sku
      ? global.CatalogueChecker.similarity.findExactDuplicateGroups(rows, function (r) { return r.sku.toLowerCase(); })
      : new Map();
    var titleDupes = mapped.title
      ? global.CatalogueChecker.similarity.findExactDuplicateGroups(rows, function (r) { return r.title; })
      : new Map();
    var categoryMedians = computeCategoryMedians(rows, mappedAnyPrice, mapped.category);

    function distinctGroupCount(dupMap) {
      var keys = new Set();
      dupMap.forEach(function (v) { keys.add(v.key); });
      return keys.size;
    }
    var skuDuplicateGroups = distinctGroupCount(skuDupes);
    var titleDuplicateGroups = distinctGroupCount(titleDupes);

    var findings = [];
    var checkCounts = {};

    function addFinding(row, checkId, message, value, groupKey) {
      findings.push({
        rowIndex: row.index,
        sku: row.sku,
        title: row.title,
        category: row.category,
        checkId: checkId,
        severity: CHECKS[checkId].severity,
        message: message,
        value: value,
        groupKey: groupKey || null
      });
      checkCounts[checkId] = (checkCounts[checkId] || 0) + 1;
    }

    var categoryTotals = {};
    if (mapped.category) {
      rows.forEach(function (r) {
        if (!r.category) return;
        categoryTotals[r.category] = (categoryTotals[r.category] || 0) + 1;
      });
    }

    function processRow(row) {
      if (mapped.imageUrl && !row.imageUrl) {
        addFinding(row, 'missing_image', 'Image URL is empty', '');
      }
      if (mapped.title && !row.title) {
        addFinding(row, 'missing_title', 'Title is empty', '');
      }
      if (mappedAnyPrice) {
        if (row.effectivePriceRaw === '' || !isFinite(row.effectivePrice) || row.effectivePrice <= 0) {
          addFinding(row, 'invalid_price', 'Price is missing, zero, negative or not a number', row.effectivePriceRaw);
        }
      }
      if (mapped.price && mapped.salePrice && row.salePriceRaw !== '' && isFinite(row.salePrice) && isFinite(row.price) && row.price > 0) {
        if (row.salePrice >= row.price) {
          var priceMsg = row.salePrice > row.price
            ? 'Sale price (' + row.salePriceRaw + ') is higher than regular price (' + row.priceRaw + ')'
            : 'Sale price (' + row.salePriceRaw + ') equals regular price (' + row.priceRaw + ') — no actual discount';
          addFinding(row, 'inverted_sale_price', priceMsg, row.salePriceRaw);
        }
      }
      if (mapped.sku && skuDupes.has(row.index)) {
        var skuGroup = skuDupes.get(row.index);
        addFinding(row, 'duplicate_sku', 'SKU "' + row.sku + '" is used by ' + skuGroup.groupSize + ' products', row.sku, 'sku:' + skuGroup.key);
      }

      if (mapped.description) {
        var wc = global.CatalogueChecker.similarity.wordCount(row.description);
        if (wc === 0) {
          addFinding(row, 'missing_description', 'Description is empty', '');
        } else if (wc < 50) {
          addFinding(row, 'thin_description', 'Description is only ' + wc + ' words', wc);
        }
        if (descDupResult.rowGroups.has(row.index)) {
          var dg = descDupResult.rowGroups.get(row.index);
          addFinding(row, 'duplicate_description', 'Matches ' + (dg.groupSize - 1) + ' other product(s) (group #' + dg.groupId + ', ~' + dg.bestMatchPercent + '% similar)', dg.bestMatchPercent + '%', 'desc:' + dg.groupId);
        }
      }

      if (mapped.category && !row.category) {
        addFinding(row, 'missing_category', 'Category is empty', '');
      }

      if (mapped.title && row.title) {
        if (titleDupes.has(row.index)) {
          var tg = titleDupes.get(row.index);
          addFinding(row, 'duplicate_title', 'Title matches ' + (tg.groupSize - 1) + ' other product(s) exactly', row.title, 'title:' + tg.key);
        }
        if (row.title.length > 70) {
          addFinding(row, 'title_too_long', 'Title is ' + row.title.length + ' characters (over 70)', row.title.length);
        } else if (row.title.length < 10) {
          addFinding(row, 'title_too_short', 'Title is only ' + row.title.length + ' characters (under 10)', row.title.length);
        }
      }

      if (mapped.status && mapped.stock) {
        if (isActiveStatus(row.status) && isFinite(row.stock) && row.stock === 0) {
          addFinding(row, 'active_out_of_stock', 'Status is "' + row.status + '" with 0 units in stock', 0);
        }
      }

      if (mappedAnyPrice && mapped.category && row.category && isFinite(row.effectivePrice) && row.effectivePrice > 0 && categoryMedians[row.category] != null) {
        var med = categoryMedians[row.category];
        var ratio = row.effectivePrice / med;
        if (ratio >= 4 || ratio <= 0.25) {
          var comparison = ratio >= 1
            ? ratio.toFixed(1) + 'x higher than'
            : (1 / ratio).toFixed(1) + 'x lower than';
          addFinding(row, 'suspicious_price', 'Price ' + row.effectivePriceRaw + ' is ' + comparison + ' the category median (' + med.toFixed(2) + ')', row.effectivePriceRaw);
        }
      }

      if (mappedAnyPrice && isFinite(row.effectivePrice) && row.effectivePrice > 0) {
        var cents = Math.round((row.effectivePrice - Math.floor(row.effectivePrice)) * 100);
        if (COMMON_CENT_ENDINGS.indexOf(cents) === -1) {
          addFinding(row, 'unrounded_price', 'Price ends in .' + (cents < 10 ? '0' + cents : cents), row.effectivePriceRaw);
        }
      }
    }

    var descDupResult = { rowGroups: new Map(), groupCount: 0 };
    var i = 0;
    var chunkSize = 2000;

    function runRowPass() {
      function step() {
        var end = Math.min(i + chunkSize, rows.length);
        for (; i < end; i++) {
          processRow(rows[i]);
        }
        onProgress(0.5 + 0.5 * (i / rows.length));
        if (i < rows.length) {
          setTimeout(step, 0);
        } else {
          onComplete({
            findings: findings,
            checkCounts: checkCounts,
            totalProducts: rows.length,
            descriptionDuplicateGroups: descDupResult.groupCount,
            skuDuplicateGroups: skuDuplicateGroups,
            titleDuplicateGroups: titleDuplicateGroups,
            categoryTotals: categoryTotals
          });
        }
      }
      step();
    }

    if (mapped.description) {
      global.CatalogueChecker.similarity.findDuplicateDescriptionGroupsAsync(
        rows,
        similarityThreshold,
        function (fraction) { onProgress(0.5 * fraction); },
        function (result) {
          descDupResult = result;
          runRowPass();
        }
      );
    } else {
      onProgress(0.5);
      runRowPass();
    }
  }

  global.CatalogueChecker = global.CatalogueChecker || {};
  global.CatalogueChecker.CHECKS = CHECKS;
  global.CatalogueChecker.SEVERITY_ORDER = SEVERITY_ORDER;
  global.CatalogueChecker.parsePrice = parsePrice;
  global.CatalogueChecker.runChecks = runChecks;
})(window);
