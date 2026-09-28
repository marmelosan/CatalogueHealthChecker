(function () {
  'use strict';

  var CC = window.CatalogueCleaner;

  var state = {
    headers: [],
    rows: [],
    fileBaseName: 'catalogue',
    mapping: {},
    result: null
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', function () {
    cacheEls();
    initDropzone();
    initMappingControls();
    initResultsControls();
  });

  function cacheEls() {
    els.steps = {
      upload: document.getElementById('step-upload'),
      mapping: document.getElementById('step-mapping'),
      progress: document.getElementById('step-progress'),
      results: document.getElementById('step-results')
    };
    els.dropzone = document.getElementById('dropzone');
    els.fileInput = document.getElementById('file-input');
    els.uploadError = document.getElementById('upload-error');
    els.mappingTable = document.getElementById('mapping-table');
    els.priceWarning = document.getElementById('price-warning');
    els.mappingError = document.getElementById('mapping-error');
    els.backToUpload = document.getElementById('back-to-upload');
    els.cleanBtn = document.getElementById('clean-btn');
    els.progressLabel = document.getElementById('progress-label');
    els.progressFill = document.getElementById('progress-fill');
    els.resultsSummary = document.getElementById('results-summary');
    els.flagList = document.getElementById('flag-list');
    els.downloadBtn = document.getElementById('download-btn');
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
      showUploadError('"' + file.name + '" doesn\'t look like a CSV file. Please export your supplier catalogue as CSV and try again.');
      return;
    }

    showStep('progress');
    updateProgress(0, 'Reading file…');

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
        updateProgress(pct, 'Reading file… (' + rows.length.toLocaleString() + ' rows so far)');
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
        state.fileBaseName = file.name.replace(/\.[^.]+$/, '') || 'catalogue';
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
    els.mappingError.hidden = true;

    CC.FIELDS.forEach(function (field) {
      var row = document.createElement('div');
      row.className = 'mapping-row';

      var label = document.createElement('div');
      label.innerHTML = '<div class="mapping-row__label">' + escapeHtml(field.label) +
        (field.required ? ' <span class="mapping-row__required">Required</span>' : '') + '</div>' +
        '<div class="mapping-row__hint">' + escapeHtml(field.hint) + '</div>';

      var select = document.createElement('select');
      select.dataset.field = field.key;

      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = field.key === 'handle' ? '— Auto-generate from Title —' : '— Not mapped —';
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
        updatePriceWarning();
      });

      row.appendChild(label);
      row.appendChild(select);
      els.mappingTable.appendChild(row);
    });

    updatePriceWarning();
    showStep('mapping');
  }

  function updatePriceWarning() {
    var mapping = readMapping();
    if (mapping.price) {
      els.priceWarning.hidden = true;
      return;
    }
    var candidates = CC.findUnmappedPriceLikeColumns(state.headers, state.rows, mapping);
    if (!candidates.length) {
      els.priceWarning.hidden = true;
      return;
    }
    els.priceWarning.textContent = 'This file has an unmapped column that looks like it contains prices (' +
      candidates.map(function (c) { return '"' + c + '"'; }).join(', ') +
      '). If that\'s your price column, map it to Variant Price above — otherwise every row will export with no price.';
    els.priceWarning.hidden = false;
  }

  function initMappingControls() {
    els.backToUpload.addEventListener('click', function () {
      showStep('upload');
    });
    els.cleanBtn.addEventListener('click', runClean);
  }

  function readMapping() {
    var mapping = {};
    els.mappingTable.querySelectorAll('select').forEach(function (sel) {
      mapping[sel.dataset.field] = sel.value;
    });
    return mapping;
  }

  /* ---------- Step 3: clean ---------- */

  function runClean() {
    var mapping = readMapping();
    if (!mapping.title) {
      els.mappingError.textContent = 'Map the Title column before cleaning — every Shopify product needs one.';
      els.mappingError.hidden = false;
      return;
    }
    els.mappingError.hidden = true;
    state.mapping = mapping;

    showStep('progress');
    updateProgress(0, 'Cleaning catalogue…');

    setTimeout(function () {
      CC.run({
        data: state.rows,
        mapping: mapping,
        onProgress: function (fraction) {
          updateProgress(fraction, 'Cleaning catalogue… (' + Math.round(fraction * 100) + '%)');
        },
        onComplete: function (result) {
          state.result = result;
          renderResults();
          showStep('results');
        }
      });
    }, 20);
  }

  /* ---------- Step 4: results ---------- */

  var FLAG_LABELS = {
    missing_title: 'Missing title',
    missing_image: 'Missing image',
    invalid_price: 'Invalid price',
    duplicate_title: 'Duplicate title',
    duplicate_handle: 'Duplicate handle'
  };

  function renderResults() {
    var r = state.result;
    var ready = r.totalRows - r.flaggedRowCount;

    els.resultsSummary.innerHTML =
      '<div class="summary-card summary-card--good"><div class="summary-card__value">' + r.totalRows.toLocaleString() + '</div><div class="summary-card__label">Rows in file</div></div>' +
      '<div class="summary-card summary-card--good"><div class="summary-card__value">' + ready.toLocaleString() + '</div><div class="summary-card__label">Ready to import</div></div>' +
      '<div class="summary-card' + (r.flaggedRowCount ? ' summary-card--high' : '') + '"><div class="summary-card__value">' + r.flaggedRowCount.toLocaleString() + '</div><div class="summary-card__label">Flagged for review</div></div>';

    var flagIds = Object.keys(r.flagCounts).filter(function (id) { return r.flagCounts[id] > 0; });
    if (!flagIds.length) {
      els.flagList.innerHTML = '<div class="empty-state">No rows were flagged. Every row cleaned and mapped straight to Shopify\'s format.</div>';
    } else {
      els.flagList.innerHTML = flagIds.map(function (id) {
        return '<div class="flag-row"><span class="flag-row__label">' + escapeHtml(FLAG_LABELS[id] || id) + '</span>' +
          '<span class="flag-row__count">' + r.flagCounts[id].toLocaleString() + '</span></div>';
      }).join('');
    }
  }

  function initResultsControls() {
    els.downloadBtn.addEventListener('click', function () {
      CC.exportCsv(state.result, state.fileBaseName + '-shopify-import.csv');
    });
    els.startOverBtn.addEventListener('click', function () {
      state.headers = [];
      state.rows = [];
      state.mapping = {};
      state.result = null;
      showStep('upload');
    });
  }

  /* ---------- utils ---------- */

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str === null || str === undefined ? '' : String(str);
    return div.innerHTML;
  }
})();
