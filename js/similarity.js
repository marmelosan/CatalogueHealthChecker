/* Text similarity + duplicate grouping.
   Near-duplicate description detection is bucketed before comparing pairs:
   comparing every row against every other row is O(n^2), which is 400M+
   comparisons at 20,000 rows and freezes the tab. Bucketing by category and
   description length keeps candidate pairs to a manageable number while
   still catching true near-duplicates (variants of the same product almost
   always share both category and roughly the same description length). */
(function (global) {
  'use strict';

  function wordCount(text) {
    var t = String(text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function wordShingles(text, n) {
    var words = normalizeText(text).split(' ').filter(Boolean);
    var shingles = new Set();
    if (words.length < n) {
      if (words.length) shingles.add(words.join(' '));
      return shingles;
    }
    for (var i = 0; i <= words.length - n; i++) {
      shingles.add(words.slice(i, i + n).join(' '));
    }
    return shingles;
  }

  function diceCoefficient(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;
    var intersection = 0;
    setA.forEach(function (v) { if (setB.has(v)) intersection++; });
    return (2 * intersection) / (setA.size + setB.size);
  }

  function UnionFind(n) {
    this.parent = new Array(n);
    for (var i = 0; i < n; i++) this.parent[i] = i;
  }
  UnionFind.prototype.find = function (x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  };
  UnionFind.prototype.union = function (a, b) {
    var ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  };

  // Bucket key: category + length band + the description's opening 3 words.
  // Real near-duplicates (copy-pasted variant descriptions with one word
  // swapped) always share the same opening, so this loses no real matches
  // while keeping buckets small when a catalogue has many unrelated
  // products crammed into a single category — the case that otherwise
  // blows up into millions of pairwise comparisons.
  function bucketKeyFor(r) {
    var norm = normalizeText(r.description);
    var words = norm.split(' ').filter(Boolean);
    var lenBand = Math.floor(words.length / 8);
    var prefix = words.slice(0, 3).join(' ');
    return (r.category || '').toLowerCase().trim() + '::' + lenBand + '::' + prefix;
  }

  // rows: array of { index, category, description }
  // Async/chunked so a large catalogue never blocks the main thread for
  // more than one comparison budget's worth of work at a time.
  // onProgress(fraction), onDone({ rowGroups: Map<rowIndex, {...}>, groupCount })
  function findDuplicateDescriptionGroupsAsync(rows, thresholdPercent, onProgress, onDone) {
    var threshold = thresholdPercent / 100;
    var candidates = rows.filter(function (r) { return wordCount(r.description) > 0; });

    var buckets = {};
    candidates.forEach(function (r) {
      var key = bucketKeyFor(r);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(r);
    });
    var bucketList = Object.keys(buckets).map(function (k) { return buckets[k]; }).filter(function (b) { return b.length > 1; });
    var totalPairs = bucketList.reduce(function (sum, b) { return sum + (b.length * (b.length - 1)) / 2; }, 0);

    var uf = new UnionFind(rows.length);
    var bestMatch = {};
    var shingleCache = {};
    function shinglesFor(r) {
      if (!shingleCache[r.index]) shingleCache[r.index] = wordShingles(r.description, 3);
      return shingleCache[r.index];
    }

    var bi = 0, i = 0, j = 0;
    var pairsDone = 0;
    var OPS_BUDGET = 150000;

    function finish() {
      var groupMembers = {};
      candidates.forEach(function (r) {
        var root = uf.find(r.index);
        if (!groupMembers[root]) groupMembers[root] = [];
        groupMembers[root].push(r.index);
      });
      var result = new Map();
      var groupCounter = 0;
      Object.keys(groupMembers).forEach(function (root) {
        var members = groupMembers[root];
        if (members.length < 2) return;
        groupCounter++;
        members.forEach(function (idx) {
          result.set(idx, {
            groupId: groupCounter,
            groupSize: members.length,
            bestMatchPercent: bestMatch[idx] || 100
          });
        });
      });
      onDone({ rowGroups: result, groupCount: groupCounter });
    }

    function step() {
      var ops = 0;
      while (bi < bucketList.length) {
        var bucket = bucketList[bi];
        if (i === 0 && j === 0) j = 1;
        while (i < bucket.length) {
          while (j < bucket.length) {
            var a = bucket[i], b = bucket[j];
            var sim = diceCoefficient(shinglesFor(a), shinglesFor(b));
            if (sim >= threshold) {
              uf.union(a.index, b.index);
              var pct = Math.round(sim * 100);
              if (!bestMatch[a.index] || pct > bestMatch[a.index]) bestMatch[a.index] = pct;
              if (!bestMatch[b.index] || pct > bestMatch[b.index]) bestMatch[b.index] = pct;
            }
            j++;
            ops++;
            pairsDone++;
            if (ops >= OPS_BUDGET) {
              onProgress(totalPairs ? pairsDone / totalPairs : 1);
              setTimeout(step, 0);
              return;
            }
          }
          i++;
          j = i + 1;
        }
        bi++;
        i = 0;
        j = 0;
      }
      onProgress(1);
      finish();
    }

    if (!bucketList.length) {
      onProgress(1);
      finish();
      return;
    }
    step();
  }

  // Exact-match grouping for SKU / title duplicates.
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

  function median(numbers) {
    if (!numbers.length) return null;
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  global.CatalogueChecker = global.CatalogueChecker || {};
  global.CatalogueChecker.similarity = {
    wordCount: wordCount,
    normalizeText: normalizeText,
    wordShingles: wordShingles,
    diceCoefficient: diceCoefficient,
    findDuplicateDescriptionGroupsAsync: findDuplicateDescriptionGroupsAsync,
    findExactDuplicateGroups: findExactDuplicateGroups,
    median: median
  };
})(window);
