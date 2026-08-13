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
    els.breakdownList = document.getElementById('breakdown-list');
    els.exportBtn = document.getElementById('export-btn');
    els.filterSeverity = document.getElementById('filter-severity');
    els.filterCheck = document.getElementById('filter-check');
    els.filterSearch = document.getElementById('filter-search');
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
    renderBreakdown();
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

    els.breakdownList.innerHTML = ids.map(function (id) {
      var check = CC.CHECKS[id];
      var count = r.checkCounts[id];
      var extra = id === 'duplicate_description' ? ' across ' + r.descriptionDuplicateGroups + ' group(s)' : '';
      return '<details class="breakdown-item" data-severity="' + check.severity + '">' +
        '<summary>' +
        '<span class="breakdown-item__badge">' + check.severity + '</span>' +
        '<span class="breakdown-item__title">' + escapeHtml(check.title) + '</span>' +
        '<span class="breakdown-item__count">' + count.toLocaleString() + extra + '</span>' +
        '<span class="breakdown-item__why">' + escapeHtml(truncate(check.explain, 90)) + '</span>' +
        '</summary>' +
        '<div class="breakdown-item__body">' + escapeHtml(check.explain) + '</div>' +
        '</details>';
    }).join('');
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
    els.exportBtn.addEventListener('click', exportCsv);
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

  function getFilteredFindings() {
    var f = state.filters;
    return state.result.findings.filter(function (row) {
      if (f.severity && row.severity !== f.severity) return false;
      if (f.checkId && row.checkId !== f.checkId) return false;
      if (f.search) {
        var hay = (row.sku + ' ' + row.title).toLowerCase();
        if (hay.indexOf(f.search) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    var filtered = getFilteredFindings();
    var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageRows = filtered.slice(start, start + PAGE_SIZE);

    if (!pageRows.length) {
      els.tableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No issues match these filters.</td></tr>';
    } else {
      els.tableBody.innerHTML = pageRows.map(function (row) {
        return '<tr>' +
          '<td>' + escapeHtml(row.sku || '—') + '</td>' +
          '<td>' + escapeHtml(truncate(row.title || '—', 60)) + '</td>' +
          '<td>' + escapeHtml(row.message) + '</td>' +
          '<td><span class="severity-tag severity-tag--' + row.severity + '">' + row.severity + '</span></td>' +
          '</tr>';
      }).join('');
    }

    els.pagination.innerHTML = '';
    if (filtered.length > PAGE_SIZE) {
      var info = document.createElement('span');
      info.textContent = 'Page ' + state.page + ' of ' + totalPages + ' (' + filtered.length.toLocaleString() + ' issues)';
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
