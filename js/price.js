/* Price parsing, ported verbatim from the sibling Catalogue Health Checker's
   checks.js — same currency-symbol stripping and comma/decimal-separator
   disambiguation logic, reused here to normalise supplier prices into the
   plain decimal format Shopify's CSV import expects. */
(function (global) {
  'use strict';

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

  // Shopify's Variant Price column expects a plain decimal, always with two
  // decimal places (e.g. "19.90", not "19.9" or "19").
  function formatPrice(n) {
    return n.toFixed(2);
  }

  global.CatalogueCleaner = global.CatalogueCleaner || {};
  global.CatalogueCleaner.parsePrice = parsePrice;
  global.CatalogueCleaner.formatPrice = formatPrice;
})(window);
