(function () {
  'use strict';

  var CC = window.CatalogueChecker;
  var PAGE_SIZE = 100;

  var state = {
    headers: [],
    rows: [],
    mapping: {},
    result: null,
    filters: { severity: '', checkId: '', search: '' },
    page: 1
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', function () {
    cacheEls();
    initDropzone();
    initMappingControls();
    initReportControls();
  });

  function cacheEls() {
    els.steps = {
      upload: document.getElementById('step-upload'),
      mapping: document.getElementById('step-mapping'),
      progress: document.getElementById('step-progress'),
      report: document.getElementById('step-report')
    };
    els.dropzone = document.getElementById('dropzone');
    els.fileInput = document.getElementById('file-input');
    els.uploadError = document.getElementById('upload-error');
    els.mappingTable = document.getElementById('mapping-table');
    els.similaritySlider = document.getElementById('similarity-threshold');
    els.similarityValue = document.getElementById('similarity-threshold-value');
    els.backToUpload = document.getElementById('back-to-upload');
    els.analyseBtn = document.getElementById('analyse-btn');
    els.progressLabel = document.getElementById('progress-label');
    els.progressFill = document.getElementById('progress-fill');
    els.summaryHeadline = document.getElementById('summary-headline');
    els.summaryCards = document.getElementById('summary-cards');
    els.scoreCard = document.getElementById('score-card');
    els.scoreValue = document.getElementById('score-value');
    els.scoreLabel = document.getElementById('score-label');
    els.printBtn = document.getElementById('print-btn');
    els.prioritiesList = document.getElementById('priorities-list');
    els.categorySection = document.getElementById('category-section');
    els.categoryList = document.getElementById('category-list');
    els.breakdownList = document.getElementById('breakdown-list');
    els.exportBtn = document.getElementById('export-btn');
    els.filterSeverity = document.getElementById('filter-severity');
    els.filterCheck = document.getElementById('filter-check');
    els.filterSearch = document.getElementById('filter-search');
    els.groupSeverity = document.getElementById('group-severity');
    els.tableBody = document.getElementById('detail-table-body');
    els.pagination = document.getElementById('table-pagination');
    els.startOverBtn = document.getElementById('start-over-btn');
  }

  function showStep(name) {
    Object.keys(els.steps).forEach(function (key) {
      els.steps[key].hidden = key !== name;
    });
  }

  /* ---------- Step 1: upload ---------- */

  function initDropzone() {
    els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
    els.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.remove('is-dragover');
      });
    });
    els.dropzone.addEventListener('drop', function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  function showUploadError(message) {
    els.uploadError.textContent = message;
    els.uploadError.hidden = false;
  }

  function handleFile(file) {
    els.uploadError.hidden = true;
    els.fileInput.value = '';

    var nameOk = /\.(csv|txt)$/i.test(file.name);
    if (!nameOk && file.type && file.type.indexOf('csv') === -1 && file.type !== 'text/plain' && file.type !== '') {
      showUploadError('"' + file.name + '" doesn\'t look like a CSV file. Please export your catalogue as CSV and try again.');
      return;
    }

    showStep('progress');
    updateProgress(0, 'Parsing file…');

    var rows = [];
    var headerFields = null;
    var fatalError = null;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      chunkSize: 1024 * 512,
      chunk: function (results) {
        if (!headerFields) headerFields = results.meta.fields || [];
        rows = rows.concat(results.data);
        var pct = file.size ? Math.min(1, results.meta.cursor / file.size) : 0.5;
        updateProgress(pct, 'Parsing file… (' + rows.length.toLocaleString() + ' rows so far)');
      },
      error: function (err) {
        fatalError = err;
      },
      complete: function () {
        if (fatalError) {
          showStep('upload');
          showUploadError('Could not read this file: ' + fatalError.message);
          return;
        }
        var looksInvalid = !headerFields || headerFields.length === 0 ||
          (headerFields.length === 1 && headerFields[0].length > 300) ||
          headerFields.some(hasBinaryGarbage) ||
          headerFields.every(function (h) { return !h || !h.trim(); });
        if (looksInvalid) {
          showStep('upload');
          showUploadError('This doesn\'t look like a valid CSV file. Make sure you exported a plain CSV (comma or semicolon separated), not Excel, PDF or another format.');
          return;
        }
        if (rows.length === 0) {
          showStep('upload');
          showUploadError('The file was read but no product rows were found. Check that it isn\'t empty.');
          return;
        }
        state.headers = headerFields;
        state.rows = rows;
        proceedToMapping();
      }
    });
  }

  function updateProgress(fraction, label) {
    els.progressFill.style.width = Math.round(fraction * 100) + '%';
    if (label) els.progressLabel.textContent = label;
  }

  /* ---------- Step 2: mapping ---------- */

  function proceedToMapping() {
    var auto = CC.autoDetectMapping(state.headers);
    els.mappingTable.innerHTML = '';

    CC.FIELDS.forEach(function (field) {
      var row = document.createElement('div');
      row.className = 'mapping-row';

      var label = document.createElement('div');
      label.innerHTML = '<div class="mapping-row__label">' + escapeHtml(field.label) + '</div>' +
        '<div class="mapping-row__hint">' + escapeHtml(field.hint) + '</div>';

      var select = document.createElement('select');
      select.dataset.field = field.key;

      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '— Not mapped —';
      select.appendChild(noneOpt);

      state.headers.forEach(function (h) {
        var opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        select.appendChild(opt);
      });

      select.value = auto[field.key] || '';
      row.classList.toggle('is-unmapped', !select.value);
      select.addEventListener('change', function () {
        row.classList.toggle('is-unmapped', !select.value);
      });

      row.appendChild(label);
      row.appendChild(select);
      els.mappingTable.appendChild(row);
    });

    showStep('mapping');
  }

  function initMappingControls() {
    els.similaritySlider.addEventListener('input', function () {
      els.similarityValue.textContent = els.similaritySlider.value + '%';
    });
    els.backToUpload.addEventListener('click', function () {
      showStep('upload');
    });
    els.analyseBtn.addEventListener('click', runAnalysis);
  }

  function readMapping() {
    var mapping = {};
    els.mappingTable.querySelectorAll('select').forEach(function (sel) {
      mapping[sel.dataset.field] = sel.value;
    });
    return mapping;
  }

  /* ---------- Step 3: analysis ---------- */

  function runAnalysis() {
    var mapping = readMapping();
    var anyMapped = Object.keys(mapping).some(function (k) { return mapping[k]; });
    if (!anyMapped) {
      alert('Map at least one column before analysing.');
      return;
    }
    state.mapping = mapping;

    showStep('progress');
    updateProgress(0, 'Analysing catalogue…');

    setTimeout(function () {
      CC.runChecks({
        data: state.rows,
        mapping: mapping,
        similarityThreshold: parseInt(els.similaritySlider.value, 10),
        onProgress: function (fraction) {
          updateProgress(fraction, 'Analysing catalogue… (' + Math.round(fraction * 100) + '%)');
        },
        onComplete: function (result) {
          state.result = result;
          state.filters = { severity: '', checkId: '', search: '' };
          state.page = 1;
          renderReport();
          showStep('report');
        }
      });
    }, 20);
  }

  /* ---------- Step 4: report ---------- */

  function renderReport() {
    renderSummary();
    renderScore();
    renderPriorities();
    renderBreakdown();
    renderCategoryBreakdown();
    populateCheckFilter();
    renderTable();
  }

  function affectedSets(findings) {
    var sets = { critical: new Set(), high: new Set(), medium: new Set() };
    findings.forEach(function (f) { sets[f.severity].add(f.rowIndex); });
    return sets;
  }

  function renderSummary() {
    var r = state.result;
    var sets = affectedSets(r.findings);
    var total = r.totalProducts;
    var criticalPct = total ? Math.round((sets.critical.size / total) * 100) : 0;

    els.summaryHeadline.textContent = sets.critical.size + ' of ' + total.toLocaleString() +
      ' products (' + criticalPct + '%) have at least one critical issue.';

    var cards = [
      { label: 'Products analysed', value: total.toLocaleString(), cls: '' },
      { label: 'Critical issues', value: sets.critical.size.toLocaleString(), cls: 'critical' },
      { label: 'High issues', value: sets.high.size.toLocaleString(), cls: 'high' },
      { label: 'Medium issues', value: sets.medium.size.toLocaleString(), cls: 'medium' }
    ];

    els.summaryCards.innerHTML = cards.map(function (c) {
      return '<div class="summary-card' + (c.cls ? ' summary-card--' + c.cls : '') + '">' +
        '<div class="summary-card__value">' + c.value + '</div>' +
        '<div class="summary-card__label">' + c.label + '</div></div>';
    }).join('');
  }

  // Weighted by how much of the catalogue each severity touches, not raw
  // finding counts — a catalogue where every product has one medium issue
  // is healthier than one where a third of products have a critical issue.
  function computeHealthScore(sets, total) {
    if (!total) return { score: 100, band: 'good' };
    var criticalFrac = sets.critical.size / total;
    var highFrac = sets.high.size / total;
    var mediumFrac = sets.medium.size / total;
    var penalty = Math.min(100, (criticalFrac * 60) + (highFrac * 30) + (mediumFrac * 15));
    var score = Math.round(100 - penalty);
    var band = score >= 80 ? 'good' : score >= 50 ? 'caution' : 'poor';
    return { score: score, band: band };
  }

  function renderScore() {
    var r = state.result;
    var sets = affectedSets(r.findings);
    var result = computeHealthScore(sets, r.totalProducts);
    var labels = { good: 'Healthy catalogue', caution: 'Needs attention', poor: 'Urgent attention needed' };

    els.scoreValue.textContent = result.score;
    els.scoreLabel.textContent = labels[result.band];
    els.scoreCard.className = 'score-card score-card--' + result.band;
  }

  function renderPriorities() {
    var r = state.result;
    var weight = { critical: 3, high: 2, medium: 1 };
    var ids = Object.keys(r.checkCounts).filter(function (id) { return r.checkCounts[id] > 0; });
    ids.sort(function (a, b) {
      var scoreA = weight[CC.CHECKS[a].severity] * r.checkCounts[a];
      var scoreB = weight[CC.CHECKS[b].severity] * r.checkCounts[b];
      return scoreB - scoreA;
    });
    var top = ids.slice(0, 5);

    if (!top.length) {
      document.getElementById('priorities-section').hidden = true;
      return;
    }
    document.getElementById('priorities-section').hidden = false;

    els.prioritiesList.innerHTML = top.map(function (id) {
      var check = CC.CHECKS[id];
      var count = r.checkCounts[id];
      return '<li class="priorities-list__item" data-check-id="' + id + '">' +
        '<span class="severity-tag severity-tag--' + check.severity + '">' + check.severity + '</span>' +
        '<span class="priorities-list__title">' + escapeHtml(check.title) + '</span>' +
        '<span class="priorities-list__count">' + count.toLocaleString() + '</span>' +
        '</li>';
    }).join('');

    els.prioritiesList.querySelectorAll('.priorities-list__item').forEach(function (li) {
      li.addEventListener('click', function () {
        els.filterCheck.value = li.dataset.checkId;
        els.filterSeverity.value = '';
        state.filters.checkId = li.dataset.checkId;
        state.filters.severity = '';
        state.page = 1;
        renderTable();
        document.querySelector('.table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderCategoryBreakdown() {
    var r = state.result;
    var totals = r.categoryTotals || {};
    var categories = Object.keys(totals);
    if (!categories.length) {
      els.categorySection.hidden = true;
      return;
    }

    var affectedByCategory = {};
    var seenRows = {};
    r.findings.forEach(function (f) {
      if (!f.category) return;
      var key = f.category + '::' + f.rowIndex;
      if (seenRows[key]) return;
      seenRows[key] = true;
      affectedByCategory[f.category] = (affectedByCategory[f.category] || 0) + 1;
    });

    // Categories smaller than 3 products are excluded from the ranking:
    // a single flagged product in a 1-item category is trivially "100%
    // affected" and would drown out categories with real, larger-scale
    // problems (e.g. "6 of 12 Chairs" is more actionable than "1 of 1
    // Storage"). Anything that small still shows up in the main table.
    var rowsData = categories
      .map(function (cat) {
        return { category: cat, affected: affectedByCategory[cat] || 0, total: totals[cat] };
      })
      .filter(function (d) { return d.affected > 0 && d.total >= 3; })
      .sort(function (a, b) { return (b.affected / b.total) - (a.affected / a.total); });

    if (!rowsData.length) {
      els.categorySection.hidden = true;
      return;
    }
    els.categorySection.hidden = false;

    var shown = rowsData.slice(0, 8);
    var maxPct = Math.max.apply(null, shown.map(function (d) { return d.affected / d.total; }));

    els.categoryList.innerHTML = shown.map(function (d) {
      var pct = Math.round((d.affected / d.total) * 100);
      var barPct = maxPct ? Math.round((d.affected / d.total) / maxPct * 100) : 0;
      return '<div class="category-row">' +
        '<div class="category-row__label">' + escapeHtml(d.category) + '</div>' +
        '<div class="category-row__bar-track"><div class="category-row__bar" style="width:' + barPct + '%"></div></div>' +
        '<div class="category-row__stat">' + d.affected + ' of ' + d.total + ' (' + pct + '%)</div>' +
        '</div>';
    }).join('');

    if (rowsData.length > shown.length) {
      els.categoryList.innerHTML += '<div class="category-row__more">+ ' + (rowsData.length - shown.length) + ' more categories</div>';
    }
  }

  function renderBreakdown() {
    var r = state.result;
    var ids = Object.keys(r.checkCounts).filter(function (id) { return r.checkCounts[id] > 0; });
    var order = { critical: 0, high: 1, medium: 2 };
    ids.sort(function (a, b) {
      var sa = CC.CHECKS[a].severity, sb = CC.CHECKS[b].severity;
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return r.checkCounts[b] - r.checkCounts[a];
    });

    if (!ids.length) {
      els.breakdownList.innerHTML = '<div class="empty-state">No issues found with the fields you mapped. Nicely kept catalogue.</div>';
      return;
    }

    var groupCountByCheck = {
      duplicate_description: r.descriptionDuplicateGroups,
      duplicate_sku: r.skuDuplicateGroups,
      duplicate_title: r.titleDuplicateGroups
    };

    els.breakdownList.innerHTML = ids.map(function (id) {
      var check = CC.CHECKS[id];
      var count = r.checkCounts[id];
      var groupCount = groupCountByCheck[id];
      var extra = groupCount ? ' across ' + groupCount + ' group(s)' : '';
      var skuList = affectedSkusForCheck(id);
      return '<details class="breakdown-item" data-severity="' + check.severity + '">' +
        '<summary>' +
        '<span class="breakdown-item__badge">' + check.severity + '</span>' +
        '<span class="breakdown-item__title">' + escapeHtml(check.title) + '</span>' +
        '<span class="breakdown-item__count">' + count.toLocaleString() + extra + '</span>' +
        '<span class="breakdown-item__why">' + escapeHtml(truncate(check.explain, 90)) + '</span>' +
        '</summary>' +
        '<div class="breakdown-item__body">' +
        '<p>' + escapeHtml(check.explain) + '</p>' +
        '<p class="breakdown-item__skus">' + escapeHtml(skuList) + '</p>' +
        '</div>' +
        '</details>';
    }).join('');
  }

  function affectedSkusForCheck(checkId) {
    var seen = new Set();
    var list = [];
    state.result.findings.forEach(function (f) {
      if (f.checkId !== checkId) return;
      var label = f.sku || f.title || '(no SKU)';
      if (seen.has(label)) return;
      seen.add(label);
      list.push(label);
    });
    var shown = list.slice(0, 20);
    var suffix = list.length > shown.length ? ' + ' + (list.length - shown.length) + ' more' : '';
    return shown.join(' · ') + suffix;
  }

  function populateCheckFilter() {
    var r = state.result;
    var ids = Object.keys(r.checkCounts).filter(function (id) { return r.checkCounts[id] > 0; });
    els.filterCheck.innerHTML = '<option value="">All</option>' + ids.map(function (id) {
      return '<option value="' + id + '">' + escapeHtml(CC.CHECKS[id].title) + '</option>';
    }).join('');
  }

  function initReportControls() {
    els.filterSeverity.addEventListener('change', function () {
      state.filters.severity = els.filterSeverity.value;
      state.page = 1;
      renderTable();
    });
    els.filterCheck.addEventListener('change', function () {
      state.filters.checkId = els.filterCheck.value;
      state.page = 1;
      renderTable();
    });
    els.filterSearch.addEventListener('input', debounce(function () {
      state.filters.search = els.filterSearch.value.trim().toLowerCase();
      state.page = 1;
      renderTable();
    }, 200));
    els.groupSeverity.addEventListener('change', function () { renderTable(); });
    els.exportBtn.addEventListener('click', exportCsv);
    els.printBtn.addEventListener('click', printReport);
    els.startOverBtn.addEventListener('click', function () {
      state.headers = [];
      state.rows = [];
      state.mapping = {};
      state.result = null;
      els.filterSeverity.value = '';
      els.filterCheck.value = '';
      els.filterSearch.value = '';
      showStep('upload');
    });
  }

  var SEVERITY_ORDER = { critical: 0, high: 1, medium: 2 };

  function getFilteredFindings() {
    var f = state.filters;
    var filtered = state.result.findings.filter(function (row) {
      if (f.severity && row.severity !== f.severity) return false;
      if (f.checkId && row.checkId !== f.checkId) return false;
      if (f.search) {
        var hay = (row.sku + ' ' + row.title).toLowerCase();
        if (hay.indexOf(f.search) === -1) return false;
      }
      return true;
    });
    // Stable sort: severity first (critical → high → medium), original
    // order preserved within each severity so it still reads sensibly.
    return filtered
      .map(function (row, i) { return { row: row, i: i }; })
      .sort(function (a, b) {
        var d = SEVERITY_ORDER[a.row.severity] - SEVERITY_ORDER[b.row.severity];
        return d !== 0 ? d : a.i - b.i;
      })
      .map(function (x) { return x.row; });
  }

  // Findings that share a groupKey (duplicate SKU/title/description groups)
  // collapse into a single display row on screen — a client seeing "12
  // duplicate description rows" panics; seeing "1 row, 12 affected SKUs"
  // reads the actual scope correctly. The CSV export stays ungrouped (one
  // row per product) so every SKU is still individually actionable there.
  function buildDisplayRows(findings) {
    var rows = [];
    var groupIndex = {};
    findings.forEach(function (f) {
      if (!f.groupKey) {
        rows.push({ skus: [f.sku], titles: [f.title], message: f.message, severity: f.severity });
        return;
      }
      if (groupIndex[f.groupKey] === undefined) {
        groupIndex[f.groupKey] = rows.length;
        rows.push({ skus: [], titles: [], message: f.message, severity: f.severity, memberCount: 0 });
      }
      var row = rows[groupIndex[f.groupKey]];
      if (f.sku && row.skus.indexOf(f.sku) === -1) row.skus.push(f.sku);
      if (f.title && row.titles.indexOf(f.title) === -1) row.titles.push(f.title);
      row.memberCount++;
    });
    return rows;
  }

  function joinTruncated(list, max) {
    if (!list.length) return '—';
    var shown = list.slice(0, max);
    var suffix = list.length > max ? ' +' + (list.length - max) + ' more' : '';
    return shown.join(', ') + suffix;
  }

  var SEVERITY_HEADER_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium' };

  function renderTable(options) {
    var forceAll = options && options.forceAll;
    var filtered = getFilteredFindings();
    var displayRows = buildDisplayRows(filtered);
    var totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = forceAll ? 0 : (state.page - 1) * PAGE_SIZE;
    var pageRows = forceAll ? displayRows : displayRows.slice(start, start + PAGE_SIZE);
    var grouped = !!(els.groupSeverity && els.groupSeverity.checked);

    if (!pageRows.length) {
      els.tableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No issues match these filters.</td></tr>';
    } else {
      var html = '';
      var lastSeverity = null;
      pageRows.forEach(function (row) {
        if (grouped && row.severity !== lastSeverity) {
          html += '<tr class="severity-header-row"><td colspan="4">' + SEVERITY_HEADER_LABEL[row.severity] + '</td></tr>';
          lastSeverity = row.severity;
        }
        var skuText = joinTruncated(row.skus, 5);
        var titleText = row.titles.length <= 1
          ? truncate(row.titles[0] || '', 60) || '—'
          : joinTruncated(row.titles.map(function (t) { return truncate(t, 40); }), 3);
        var message = row.memberCount ? row.memberCount + ' products — ' + row.message : row.message;
        html += '<tr>' +
          '<td>' + escapeHtml(skuText) + '</td>' +
          '<td>' + escapeHtml(titleText) + '</td>' +
          '<td>' + escapeHtml(message) + '</td>' +
          '<td><span class="severity-tag severity-tag--' + row.severity + '">' + row.severity + '</span></td>' +
          '</tr>';
      });
      els.tableBody.innerHTML = html;
    }

    els.pagination.innerHTML = '';
    if (!forceAll && displayRows.length > PAGE_SIZE) {
      var info = document.createElement('span');
      info.textContent = 'Page ' + state.page + ' of ' + totalPages + ' (' + displayRows.length.toLocaleString() + ' rows)';
      var prev = document.createElement('button');
      prev.textContent = 'Previous';
      prev.disabled = state.page <= 1;
      prev.addEventListener('click', function () { state.page--; renderTable(); });
      var next = document.createElement('button');
      next.textContent = 'Next';
      next.disabled = state.page >= totalPages;
      next.addEventListener('click', function () { state.page++; renderTable(); });
      els.pagination.appendChild(prev);
      els.pagination.appendChild(info);
      els.pagination.appendChild(next);
    }
  }

  function printReport() {
    renderTable({ forceAll: true });
    document.body.classList.add('is-printing');

    var restored = false;
    var fallbackTimer;
    function restore() {
      if (restored) return;
      restored = true;
      clearTimeout(fallbackTimer);
      window.removeEventListener('afterprint', restore);
      document.body.classList.remove('is-printing');
      renderTable();
    }
    window.addEventListener('afterprint', restore);
    window.print();
    // Safari doesn't reliably fire afterprint in all cases — fall back to a timeout.
    fallbackTimer = setTimeout(restore, 2000);
  }

  function exportCsv() {
    var rows = state.result.findings.map(function (f) {
      return {
        SKU: f.sku,
        Title: f.title,
        Check: CC.CHECKS[f.checkId].title,
        Severity: f.severity,
        Value: f.value
      };
    });
    var csv = Papa.unparse(rows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'catalogue-findings.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- utils ---------- */

  function hasBinaryGarbage(str) {
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0e-\x1f�]/.test(str || '');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str === null || str === undefined ? '' : String(str);
    return div.innerHTML;
  }

  function truncate(str, len) {
    str = String(str || '');
    return str.length > len ? str.slice(0, len - 1) + '…' : str;
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }
})();
