/* Exact-match duplicate grouping, ported verbatim from the sibling Catalogue
   Health Checker's similarity.js. Only the exact-match grouping function is
   needed here (for duplicate title/handle detection) — the near-duplicate
   description engine in the original file isn't part of this tool's scope. */
(function (global) {
  'use strict';

  // keyFn(row) -> string key, empty string is ignored (not counted as a dup).
  function findExactDuplicateGroups(rows, keyFn) {
    var byKey = {};
    rows.forEach(function (r) {
      var key = keyFn(r);
      if (!key) return;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(r.index);
    });

    var result = new Map();
    Object.keys(byKey).forEach(function (key) {
      var members = byKey[key];
      if (members.length < 2) return;
      members.forEach(function (idx) {
        result.set(idx, { groupSize: members.length, key: key });
      });
    });
    return result;
  }

  global.CatalogueCleaner = global.CatalogueCleaner || {};
  global.CatalogueCleaner.findExactDuplicateGroups = findExactDuplicateGroups;
})(window);
