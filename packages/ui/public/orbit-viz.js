/**
 * orbit-viz.js — Standalone Visualization Engine for orbit-core Smart Dashboards
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Usage:
 *   OrbitViz.init({ baseUrl, apiKey, from, to });
 *   OrbitViz.line('#el', { metric, asset, namespace, title });
 */
(function () {
  'use strict';

  /* ─── Theme ─── */
  var theme = {
    bg: '#040713', card: '#0d1528', border: '#1a2540',
    text: '#e2e8f0', textMuted: '#8892b0',
    cyan: '#55f3ff', purple: '#9b7cff', green: '#34d399',
    red: '#f87171', orange: '#fb923c', yellow: '#fbbf24',
    severity: { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399', info: '#55f3ff' },
    font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    palette: ['#55f3ff', '#9b7cff', '#34d399', '#f87171', '#fb923c', '#fbbf24', '#a78bfa', '#f472b6']
  };

  /* ─── Config ─── */
  var _cfg = { baseUrl: '', apiKey: '', from: '', to: '', refreshInterval: 30000 };
  var _refreshTimers = [];

  function init(cfg) {
    _cfg.baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
    _cfg.apiKey = cfg.apiKey || '';
    _cfg.from = cfg.from || new Date(Date.now() - 86400000).toISOString();
    _cfg.to = cfg.to || new Date().toISOString();
    _cfg.refreshInterval = cfg.refreshInterval || 30000;
    console.log('[orbit-viz] init', _cfg.baseUrl, 'from=' + _cfg.from);
  }

  /* ─── Query Helpers ─── */
  function _headers() {
    var h = { 'Content-Type': 'application/json' };
    if (_cfg.apiKey) h['x-api-key'] = _cfg.apiKey;
    return h;
  }

  function _query(body) {
    if (!_cfg.baseUrl) {
      // Auto-init from window globals injected by SmartDashboardIframe
      if (window.__ORBIT_BASE_URL__) {
        init({
          baseUrl: window.__ORBIT_BASE_URL__ + '/api/v1',
          apiKey:  window.__ORBIT_API_KEY__  || '',
          from:    window.__ORBIT_FROM__     || '',
          to:      window.__ORBIT_TO__       || '',
        });
      }
      if (!_cfg.baseUrl) {
        return Promise.reject(new Error('OrbitViz not initialized — baseUrl is empty'));
      }
    }
    return fetch(_cfg.baseUrl + '/query', {
      method: 'POST', headers: _headers(), body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function _timeseries(opts) {
    return _query({
      language: 'orbitql',
      query: {
        kind: 'timeseries',
        asset_id: opts.asset || opts.asset_id || '',
        namespace: opts.namespace || 'nagios',
        metric: opts.metric || '',
        from: opts.from || _cfg.from,
        to: opts.to || _cfg.to,
        agg: opts.agg || 'avg'
      }
    });
  }

  function _timeseriesMulti(opts) {
    return _query({
      language: 'orbitql',
      query: {
        kind: 'timeseries_multi',
        from: opts.from || _cfg.from,
        to: opts.to || _cfg.to,
        agg: opts.agg || 'avg',
        series: opts.series || []
      }
    });
  }

  function _events(opts) {
    var q = {
      kind: 'events',
      from: opts.from || _cfg.from,
      to: opts.to || _cfg.to,
      limit: opts.limit || 50
    };
    if (opts.namespace) q.namespace = opts.namespace;
    if (opts.asset || opts.asset_id) q.asset_id = opts.asset || opts.asset_id;
    if (opts.severities) q.severities = opts.severities;
    if (opts.kinds) q.kinds = opts.kinds;
    return _query({ language: 'orbitql', query: q });
  }

  function _eventCount(opts) {
    var q = {
      kind: 'event_count',
      from: opts.from || _cfg.from,
      to: opts.to || _cfg.to
    };
    if (opts.namespace) q.namespace = opts.namespace;
    if (opts.asset || opts.asset_id) q.asset_id = opts.asset || opts.asset_id;
    if (opts.severities) q.severities = opts.severities;
    return _query({ language: 'orbitql', query: q });
  }

  /* ─── DOM Helpers ─── */
  function _el(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  function _card(container, opts) {
    container.style.background = theme.card;
    container.style.border = '1px solid ' + theme.border;
    container.style.borderRadius = '12px';
    container.style.padding = '16px';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    if (opts.title && !container.querySelector('.oviz-header')) {
      var h = document.createElement('div');
      h.className = 'oviz-header';
      h.style.cssText = 'color:' + theme.text + ';font-family:' + theme.font + ';font-size:13px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;';
      h.textContent = opts.title;
      if (opts.unit) {
        var u = document.createElement('span');
        u.style.cssText = 'color:' + theme.textMuted + ';font-size:11px;font-weight:400;';
        u.textContent = opts.unit;
        h.appendChild(u);
      }
      container.appendChild(h);
    }
    // Create or reuse a body wrapper for chart content (cleared on refresh)
    var body = container.querySelector('.oviz-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'oviz-body';
      container.appendChild(body);
    }
    return body;
  }

  function _loading(container) {
    var d = document.createElement('div');
    d.className = 'oviz-loading';
    d.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:32px 0;color:' + theme.textMuted + ';font-family:' + theme.font + ';font-size:12px;';
    d.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" style="animation:oviz-spin 1s linear infinite;margin-right:8px"><circle cx="12" cy="12" r="10" stroke="' + theme.cyan + '" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-linecap="round"/></svg>Loading...';
    container.appendChild(d);
    // inject spin keyframes once
    if (!document.getElementById('oviz-css')) {
      var s = document.createElement('style');
      s.id = 'oviz-css';
      s.textContent = '@keyframes oviz-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    return d;
  }

  function _error(container, msg) {
    var d = document.createElement('div');
    d.style.cssText = 'padding:16px;color:' + theme.red + ';font-family:' + theme.font + ';font-size:12px;text-align:center;';
    d.textContent = msg || 'Failed to load data';
    container.appendChild(d);
  }

  function _clearContent(container) {
    // Remove everything except the title header
    var children = Array.from(container.children);
    for (var i = 0; i < children.length; i++) {
      if (children[i].tagName !== 'DIV' || children[i].style.fontWeight !== '600') {
        // Keep the title div (first div with fontWeight 600)
        if (i === 0 && children[i].style.fontSize === '13px') continue;
        container.removeChild(children[i]);
      }
    }
  }

  /* ─── Canvas Helpers ─── */
  function _setupCanvas(container, w, h) {
    var c = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.style.display = 'block';
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    container.appendChild(c);
    return ctx;
  }

  function _fmtVal(v, unit) {
    if (v == null || isNaN(v)) return '—';
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    if (Math.abs(v) >= 100) return Math.round(v).toString();
    if (Math.abs(v) >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function _fmtTime(iso) {
    var d = new Date(iso);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function _fmtDate(iso) {
    var d = new Date(iso);
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    return (mo < 10 ? '0' : '') + mo + '/' + (da < 10 ? '0' : '') + da + ' ' + _fmtTime(iso);
  }

  /* ─── Auto-Refresh ─── */
  function _autoRefresh(fn, interval) {
    var ms = interval || _cfg.refreshInterval;
    if (!ms || ms < 5000) return;
    var timer = null;
    function start() { if (!timer) timer = setInterval(fn, ms); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else { fn(); start(); }
    });
    _refreshTimers.push({ stop: stop });
  }

  /* ─── LINE CHART (Canvas 2D) ─── */
  function _drawLineChart(ctx, w, h, rows, opts) {
    var color = opts.color || theme.cyan;
    var pad = { top: 8, right: 12, bottom: 28, left: 48 };
    var cw = w - pad.left - pad.right;
    var ch = h - pad.top - pad.bottom;

    if (!rows || !rows.length) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = '12px ' + theme.font;
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    var vals = rows.map(function (r) { return r.value != null ? +r.value : null; });
    var times = rows.map(function (r) { return new Date(r.ts).getTime(); });

    var validVals = vals.filter(function (v) { return v !== null; });
    var minV = Math.min.apply(null, validVals);
    var maxV = Math.max.apply(null, validVals);
    if (minV === maxV) { minV -= 1; maxV += 1; }
    var minT = times[0], maxT = times[times.length - 1];
    if (minT === maxT) { minT -= 1000; maxT += 1000; }

    function x(t) { return pad.left + ((t - minT) / (maxT - minT)) * cw; }
    function y(v) { return pad.top + ch - ((v - minV) / (maxV - minV)) * ch; }

    // Grid lines
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
      var gy = pad.top + (ch / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke();
    }

    // Y labels
    ctx.fillStyle = theme.textMuted;
    ctx.font = '10px ' + theme.font;
    ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
      var val = maxV - ((maxV - minV) / 4) * i;
      ctx.fillText(_fmtVal(val, opts.unit), pad.left - 4, pad.top + (ch / 4) * i + 3);
    }

    // X labels
    ctx.textAlign = 'center';
    var labelCount = Math.min(6, rows.length);
    var step = Math.max(1, Math.floor(rows.length / labelCount));
    for (var i = 0; i < rows.length; i += step) {
      ctx.fillText(_fmtTime(rows[i].ts), x(times[i]), h - 4);
    }

    // Area fill
    if (opts.fill !== false) {
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < rows.length; i++) {
        if (vals[i] === null) continue;
        if (!started) { ctx.moveTo(x(times[i]), y(vals[i])); started = true; }
        else ctx.lineTo(x(times[i]), y(vals[i]));
      }
      // Close the area
      if (started) {
        ctx.lineTo(x(times[rows.length - 1]), pad.top + ch);
        ctx.lineTo(x(times[0]), pad.top + ch);
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        grad.addColorStop(0, color + '33');
        grad.addColorStop(1, color + '05');
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    var started = false;
    for (var i = 0; i < rows.length; i++) {
      if (vals[i] === null) { started = false; continue; }
      if (!started) { ctx.moveTo(x(times[i]), y(vals[i])); started = true; }
      else ctx.lineTo(x(times[i]), y(vals[i]));
    }
    ctx.stroke();

    // Glow effect
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
  }

  /* ─── MULTI-LINE CHART (Canvas 2D) ─── */
  function _drawMultiLineChart(ctx, w, h, seriesData, opts) {
    var colors = opts.colors || theme.palette;
    var pad = { top: 8, right: 12, bottom: 28, left: 48 };
    var cw = w - pad.left - pad.right;
    var ch = h - pad.top - pad.bottom;

    if (!seriesData || !Object.keys(seriesData).length) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = '12px ' + theme.font;
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    // Collect all values and times
    var allVals = [], allTimes = [];
    var names = Object.keys(seriesData);
    names.forEach(function (name) {
      seriesData[name].forEach(function (r) {
        if (r.value != null) allVals.push(+r.value);
        allTimes.push(new Date(r.ts).getTime());
      });
    });

    var minV = Math.min.apply(null, allVals);
    var maxV = Math.max.apply(null, allVals);
    if (minV === maxV) { minV -= 1; maxV += 1; }
    var minT = Math.min.apply(null, allTimes);
    var maxT = Math.max.apply(null, allTimes);
    if (minT === maxT) { minT -= 1000; maxT += 1000; }

    function x(t) { return pad.left + ((t - minT) / (maxT - minT)) * cw; }
    function y(v) { return pad.top + ch - ((v - minV) / (maxV - minV)) * ch; }

    // Grid
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
      var gy = pad.top + (ch / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke();
    }

    // Y labels
    ctx.fillStyle = theme.textMuted;
    ctx.font = '10px ' + theme.font;
    ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
      var val = maxV - ((maxV - minV) / 4) * i;
      ctx.fillText(_fmtVal(val, opts.unit), pad.left - 4, pad.top + (ch / 4) * i + 3);
    }

    // Draw each series
    names.forEach(function (name, idx) {
      var rows = seriesData[name];
      var color = colors[idx % colors.length];
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      var started = false;
      rows.forEach(function (r) {
        if (r.value == null) { started = false; return; }
        var px = x(new Date(r.ts).getTime());
        var py = y(+r.value);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    // Legend
    var legendY = h - 2;
    ctx.font = '9px ' + theme.font;
    ctx.textAlign = 'left';
    var lx = pad.left;
    names.forEach(function (name, idx) {
      var color = colors[idx % colors.length];
      ctx.fillStyle = color;
      ctx.fillRect(lx, legendY - 6, 8, 3);
      ctx.fillStyle = theme.textMuted;
      var label = name.length > 20 ? name.substring(0, 18) + '..' : name;
      ctx.fillText(label, lx + 10, legendY);
      lx += ctx.measureText(label).width + 20;
    });
  }

  /* ─── BAR CHART (Canvas 2D) ─── */
  function _drawBarChart(ctx, w, h, items, opts) {
    var colors = opts.colors || theme.palette;
    var pad = { top: 8, right: 12, bottom: 40, left: 48 };
    var cw = w - pad.left - pad.right;
    var ch = h - pad.top - pad.bottom;

    if (!items || !items.length) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = '12px ' + theme.font;
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    var maxV = Math.max.apply(null, items.map(function (it) { return it.value; }));
    if (maxV === 0) maxV = 1;

    var barW = Math.min(40, (cw / items.length) * 0.7);
    var gap = (cw - barW * items.length) / (items.length + 1);

    items.forEach(function (it, i) {
      var bx = pad.left + gap + i * (barW + gap);
      var bh = (it.value / maxV) * ch;
      var by = pad.top + ch - bh;
      var color = colors[i % colors.length];

      // Bar
      ctx.fillStyle = color;
      _roundRect(ctx, bx, by, barW, bh, 4);
      ctx.fill();

      // Value on top
      ctx.fillStyle = theme.text;
      ctx.font = '10px ' + theme.font;
      ctx.textAlign = 'center';
      ctx.fillText(_fmtVal(it.value, opts.unit), bx + barW / 2, by - 4);

      // Label below
      ctx.fillStyle = theme.textMuted;
      ctx.font = '9px ' + theme.font;
      ctx.save();
      ctx.translate(bx + barW / 2, h - 4);
      ctx.rotate(-0.4);
      var label = (it.label || '').length > 12 ? (it.label || '').substring(0, 10) + '..' : (it.label || '');
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ─── GAUGE (SVG Arc) ─── */
  function _renderGauge(container, value, opts) {
    var max = opts.max || 100;
    var pct = Math.min(1, Math.max(0, value / max));
    var color = opts.color || theme.cyan;
    // Auto color for percentage gauges
    if (opts.unit === '%') {
      if (pct > 0.9) color = theme.red;
      else if (pct > 0.75) color = theme.orange;
      else if (pct > 0.5) color = theme.yellow;
      else color = theme.green;
    }

    var size = opts.size || 120;
    var r = size / 2 - 10;
    var cx = size / 2, cy = size / 2 + 10;
    var startAngle = Math.PI * 0.8;
    var endAngle = Math.PI * 2.2;
    var sweep = (endAngle - startAngle) * pct;

    function arc(angle) {
      return (cx + r * Math.cos(angle)) + ',' + (cy + r * Math.sin(angle));
    }

    var bgEnd = endAngle;
    var valEnd = startAngle + sweep;
    var largeArcBg = (bgEnd - startAngle) > Math.PI ? 1 : 0;
    var largeArcVal = sweep > Math.PI ? 1 : 0;

    var svg = '<svg width="' + size + '" height="' + (size - 10) + '" viewBox="0 0 ' + size + ' ' + (size - 10) + '">';
    svg += '<path d="M' + arc(startAngle) + ' A' + r + ',' + r + ' 0 ' + largeArcBg + ',1 ' + arc(bgEnd) + '" fill="none" stroke="' + theme.border + '" stroke-width="8" stroke-linecap="round"/>';
    svg += '<path d="M' + arc(startAngle) + ' A' + r + ',' + r + ' 0 ' + largeArcVal + ',1 ' + arc(valEnd) + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>';
    svg += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" fill="' + theme.text + '" font-family="' + theme.font + '" font-size="22" font-weight="700">' + _fmtVal(value, opts.unit) + (opts.unit || '') + '</text>';
    svg += '</svg>';

    var d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:center;align-items:center;';
    d.innerHTML = svg;
    container.appendChild(d);
  }

  /* ─── DONUT (SVG) ─── */
  function _renderDonut(container, items, opts) {
    var size = opts.size || 140;
    var r = size / 2 - 20;
    var cx = size / 2, cy = size / 2;
    var colors = opts.colors || theme.palette;

    var total = 0;
    items.forEach(function (it) { total += it.value; });
    if (total === 0) {
      container.innerHTML += '<div style="text-align:center;color:' + theme.textMuted + ';font:12px ' + theme.font + ';padding:20px">No data</div>';
      return;
    }

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    var angle = -Math.PI / 2;

    items.forEach(function (it, i) {
      var pct = it.value / total;
      var sweep = pct * Math.PI * 2;
      if (sweep < 0.01) return;
      var x1 = cx + r * Math.cos(angle);
      var y1 = cy + r * Math.sin(angle);
      angle += sweep;
      var x2 = cx + r * Math.cos(angle);
      var y2 = cy + r * Math.sin(angle);
      var large = sweep > Math.PI ? 1 : 0;
      var color = it.color || colors[i % colors.length];
      svg += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + large + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '" opacity="0.85"/>';
    });

    // Center hole
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.55) + '" fill="' + theme.card + '"/>';
    svg += '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" fill="' + theme.text + '" font-family="' + theme.font + '" font-size="16" font-weight="700">' + total + '</text>';
    svg += '</svg>';

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;';
    var svgDiv = document.createElement('div');
    svgDiv.innerHTML = svg;
    wrap.appendChild(svgDiv);

    // Legend
    var legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    items.forEach(function (it, i) {
      var color = it.color || colors[i % colors.length];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font:11px ' + theme.font + ';color:' + theme.text + ';';
      row.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
        '<span>' + (it.label || 'Unknown') + '</span>' +
        '<span style="color:' + theme.textMuted + ';margin-left:auto">' + it.value + '</span>';
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    container.appendChild(wrap);
  }

  /* ─── PUBLIC RENDERERS ─── */
  // Each renderer uses a single dedicated div (body) for its content.
  // On every render cycle the body is fully replaced via innerHTML.
  // A monotonic render-version prevents stale async results from painting.

  function _nodata(body) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:' + theme.textMuted + ';font:12px ' + theme.font + '">No data available</div>';
  }

  // Generic renderer factory: handles card setup, loading, async fetch, body swap, auto-refresh.
  function _renderer(sel, opts, fetchFn, paintFn) {
    opts = opts || {};
    var container = _el(sel);
    if (!container) return console.error('[orbit-viz] element not found:', sel);
    var body = _card(container, opts);
    body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:32px 0;color:' + theme.textMuted + ';font-family:' + theme.font + ';font-size:12px;"><svg width="20" height="20" viewBox="0 0 24 24" style="animation:oviz-spin 1s linear infinite;margin-right:8px"><circle cx="12" cy="12" r="10" stroke="' + theme.cyan + '" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-linecap="round"/></svg>Loading...</div>';
    if (!document.getElementById('oviz-css')) {
      var s = document.createElement('style'); s.id = 'oviz-css';
      s.textContent = '@keyframes oviz-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    var ver = 0;
    function render() {
      var myVer = ++ver;
      fetchFn(opts).then(function (j) {
        if (myVer !== ver) return; // stale — a newer render is in flight
        body.innerHTML = '';
        paintFn(container, body, j, opts);
      }).catch(function (err) {
        if (myVer !== ver) return;
        body.innerHTML = '<div style="padding:16px;color:' + theme.red + ';font-family:' + theme.font + ';font-size:12px;text-align:center;">Query failed: ' + (err.message || err) + '</div>';
      });
    }
    render();
    _autoRefresh(render, opts.refreshInterval);
  }

  /** OrbitViz.line / area */
  function line(sel, opts) {
    opts = opts || {};
    var h = opts.height || 200;
    _renderer(sel, opts, _timeseries, function (container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) { _nodata(body); return; }
      var w = container.clientWidth - 32;
      var ctx = _setupCanvas(body, w, h);
      _drawLineChart(ctx, w, h, j.result.rows, opts);
    });
  }
  function area(sel, opts) { opts = opts || {}; opts.fill = true; line(sel, opts); }

  /** OrbitViz.multiLine */
  function multiLine(sel, opts) {
    opts = opts || {};
    var h = opts.height || 200;
    _renderer(sel, opts, _timeseriesMulti, function (container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) { _nodata(body); return; }
      var seriesData = {};
      j.result.rows.forEach(function (r) {
        var name = r.series || 'default';
        if (!seriesData[name]) seriesData[name] = [];
        seriesData[name].push(r);
      });
      var w = container.clientWidth - 32;
      var ctx = _setupCanvas(body, w, h);
      _drawMultiLineChart(ctx, w, h, seriesData, opts);
    });
  }

  /** OrbitViz.bar */
  function bar(sel, opts) {
    opts = opts || {};
    var h = opts.height || 200;

    if (opts.items && opts.items.length) {
      // Static items — no fetch needed
      var container = _el(sel);
      if (!container) return;
      var body = _card(container, opts);
      body.innerHTML = '';
      var w = container.clientWidth - 32;
      var ctx = _setupCanvas(body, w, h);
      _drawBarChart(ctx, w, h, opts.items, opts);
      return;
    }

    var metrics = opts.metrics || [];
    if (!metrics.length) return;

    var series = metrics.map(function (m) {
      var obj = typeof m === 'string' ? { metric: m } : m;
      return {
        asset_id: obj.asset || obj.asset_id || opts.asset || opts.asset_id || '',
        namespace: obj.namespace || opts.namespace || 'nagios',
        metric: obj.metric || obj.name || '',
        label: obj.label || obj.metric || obj.name || ''
      };
    });

    var fetchOpts = { series: series, agg: opts.agg || 'avg' };
    _renderer(sel, opts, function () { return _timeseriesMulti(fetchOpts); }, function (container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) { _nodata(body); return; }
      var lastVals = {};
      j.result.rows.forEach(function (r) { lastVals[r.series] = r.value; });
      var items = series.map(function (s) { return { label: s.label, value: lastVals[s.label] || 0 }; });
      var w = container.clientWidth - 32;
      var ctx = _setupCanvas(body, w, h);
      _drawBarChart(ctx, w, h, items, opts);
    });
  }

  /** OrbitViz.gauge */
  function gauge(sel, opts) {
    opts = opts || {};
    _renderer(sel, opts, _timeseries, function (_container, body, j) {
      var lastVal = 0;
      if (j.ok && j.result && j.result.rows.length) {
        lastVal = +j.result.rows[j.result.rows.length - 1].value;
      }
      _renderGauge(body, lastVal, opts);
    });
  }

  /** OrbitViz.kpi */
  function kpi(sel, opts) {
    opts = opts || {};
    var queryFn = opts.queryKind === 'event_count' ? _eventCount : _timeseries;
    _renderer(sel, opts, queryFn, function (_container, body, j) {
      var value = 0;
      if (j.ok && j.result && j.result.rows.length) {
        if (opts.aggregate === 'sum') {
          j.result.rows.forEach(function (r) { value += +(r.value || 0); });
        } else {
          value = +j.result.rows[j.result.rows.length - 1].value;
        }
      }
      body.innerHTML = '<div style="text-align:center;padding:12px 0;"><div style="font-size:36px;font-weight:700;color:' + (opts.color || theme.cyan) + ';font-family:' + theme.font + '">' +
        _fmtVal(value, opts.unit) + '<span style="font-size:14px;color:' + theme.textMuted + ';margin-left:4px">' + (opts.unit || '') + '</span></div>' +
        (opts.subtitle ? '<div style="font-size:11px;color:' + theme.textMuted + ';margin-top:4px;font-family:' + theme.font + '">' + opts.subtitle + '</div>' : '') +
        '</div>';
    });
  }

  /** OrbitViz.events / table */
  function events(sel, opts) {
    opts = opts || {};
    _renderer(sel, opts, _events, function (_container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) {
        body.innerHTML = '<div style="padding:16px;text-align:center;color:' + theme.textMuted + ';font:12px ' + theme.font + '">No events</div>';
        return;
      }
      var html = '<div style="overflow-y:auto;max-height:' + (opts.height || 300) + 'px;">';
      html += '<table style="width:100%;border-collapse:collapse;font:11px ' + theme.font + ';">';
      html += '<thead><tr style="border-bottom:1px solid ' + theme.border + ';">';
      html += '<th style="padding:6px 8px;text-align:left;color:' + theme.textMuted + ';font-weight:500">Time</th>';
      html += '<th style="padding:6px 8px;text-align:left;color:' + theme.textMuted + ';font-weight:500">Severity</th>';
      html += '<th style="padding:6px 8px;text-align:left;color:' + theme.textMuted + ';font-weight:500">Asset</th>';
      html += '<th style="padding:6px 8px;text-align:left;color:' + theme.textMuted + ';font-weight:500">Title</th>';
      html += '</tr></thead><tbody>';
      j.result.rows.forEach(function (r) {
        var sevColor = theme.severity[r.severity] || theme.textMuted;
        html += '<tr style="border-bottom:1px solid ' + theme.border + '22;">';
        html += '<td style="padding:5px 8px;color:' + theme.textMuted + ';white-space:nowrap">' + _fmtDate(r.ts) + '</td>';
        html += '<td style="padding:5px 8px"><span style="background:' + sevColor + '22;color:' + sevColor + ';padding:2px 6px;border-radius:4px;font-size:10px;text-transform:uppercase">' + (r.severity || 'info') + '</span></td>';
        html += '<td style="padding:5px 8px;color:' + theme.text + '">' + (r.asset_id || '—') + '</td>';
        html += '<td style="padding:5px 8px;color:' + theme.text + '">' + (r.title || r.message || '—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      body.innerHTML = html;
    });
  }

  /** OrbitViz.eps */
  function eps(sel, opts) {
    opts = opts || {};
    opts.unit = opts.unit || 'eps';
    opts.color = opts.color || theme.purple;
    var h = opts.height || 200;
    _renderer(sel, opts, _eventCount, function (container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) { _nodata(body); return; }
      var w = container.clientWidth - 32;
      var ctx = _setupCanvas(body, w, h);
      _drawLineChart(ctx, w, h, j.result.rows, opts);
    });
  }

  /** OrbitViz.donut */
  function donut(sel, opts) {
    opts = opts || {};
    if (opts.items && opts.items.length) {
      var container = _el(sel);
      if (!container) return;
      var body = _card(container, opts);
      body.innerHTML = '';
      _renderDonut(body, opts.items, opts);
      return;
    }

    _renderer(sel, opts, function (o) {
      return _events({ namespace: o.namespace, asset: o.asset, limit: o.limit || 1000 });
    }, function (_container, body, j) {
      if (!j.ok || !j.result || !j.result.rows.length) {
        _renderDonut(body, [], opts);
        return;
      }
      var groupBy = opts.groupBy || 'severity';
      var counts = {};
      j.result.rows.forEach(function (r) {
        var key = r[groupBy] || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
      });
      var items = Object.keys(counts).map(function (key) {
        return {
          label: key,
          value: counts[key],
          color: groupBy === 'severity' ? (theme.severity[key] || theme.textMuted) : undefined
        };
      }).sort(function (a, b) { return b.value - a.value; });
      _renderDonut(body, items, opts);
    });
  }

  /** OrbitViz.table(selector, opts) — Raw events table (alias for events) */
  function table(sel, opts) {
    events(sel, opts);
  }

  /** OrbitViz.layout(selector, opts) — Apply responsive grid layout */
  function layout(sel, opts) {
    opts = opts || {};
    var container = _el(sel);
    if (!container) return;
    var cols = opts.cols || 3;
    var gap = opts.gap || 16;
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    container.style.gap = gap + 'px';
    // Responsive
    if (!document.getElementById('oviz-grid-css')) {
      var s = document.createElement('style');
      s.id = 'oviz-grid-css';
      s.textContent = '@media(max-width:900px){[data-oviz-grid]{grid-template-columns:repeat(2,1fr)!important}}@media(max-width:600px){[data-oviz-grid]{grid-template-columns:1fr!important}}';
      document.head.appendChild(s);
    }
    container.setAttribute('data-oviz-grid', '');
  }

  /** OrbitViz.destroy() — Stop all auto-refresh timers */
  function destroy() {
    _refreshTimers.forEach(function (t) { t.stop(); });
    _refreshTimers = [];
  }

  /* ─── Expose ─── */
  window.OrbitViz = {
    init: init,
    theme: theme,
    line: line,
    area: area,
    multiLine: multiLine,
    bar: bar,
    gauge: gauge,
    kpi: kpi,
    events: events,
    eps: eps,
    donut: donut,
    table: table,
    layout: layout,
    destroy: destroy,
    // Low-level (for advanced use in AI-generated HTML)
    _query: _query,
    _timeseries: _timeseries,
    _timeseriesMulti: _timeseriesMulti,
    _events: _events,
    _eventCount: _eventCount
  };

  console.log('[orbit-viz] v1.0 loaded');
})();
