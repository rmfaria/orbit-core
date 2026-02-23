(() => {
  const $ = (id) => document.getElementById(id);

  // Same-origin under prod.nesecurity.com.br, orbit-core is served at /orbit-core
  const ORBIT_BASE = '/orbit-core';
  const API = `${ORBIT_BASE}/api/v1`;

  const elAsset = $('asset');
  const elName = $('name');
  const elPrompt = $('prompt');
  const elSpec = $('spec');
  const elOut = $('out');
  const elStatus = $('status');

  function setStatus(s) {
    elStatus.textContent = s;
  }

  function uuid() {
    return 'dsh_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  async function jget(url) {
    const res = await fetch(url, { headers: { 'accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
    return res.json();
  }

  async function jpost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  function baselineSpec(assetId, name, prompt) {
    const now = Date.now();
    const id = uuid();

    // Deterministic baseline widgets for Nagios-style metrics.
    // These should match Orbit conventions: metric label, service in dimensions.
    const widgets = [
      {
        id: id + '_cpu',
        title: 'CPU load — load1/load5/load15',
        kind: 'timeseries_multi',
        layout: { x: 0, y: 0, w: 6, h: 4 },
        query: {
          kind: 'timeseries_multi',
          from: new Date(now - 60 * 60 * 1000).toISOString(),
          to: new Date(now).toISOString(),
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'load1', dimensions: { service: 'CPU Load' }, label: 'load1' },
            { asset_id: assetId, namespace: 'nagios', metric: 'load5', dimensions: { service: 'CPU Load' }, label: 'load5' },
            { asset_id: assetId, namespace: 'nagios', metric: 'load15', dimensions: { service: 'CPU Load' }, label: 'load15' },
          ],
          limit: 2000,
        },
      },
      {
        id: id + '_disk',
        title: 'Disk queue — aqu/util',
        kind: 'timeseries_multi',
        layout: { x: 6, y: 0, w: 6, h: 4 },
        query: {
          kind: 'timeseries_multi',
          from: new Date(now - 60 * 60 * 1000).toISOString(),
          to: new Date(now).toISOString(),
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'aqu', dimensions: { service: 'Disk_Queue_sda' }, label: 'aqu' },
            { asset_id: assetId, namespace: 'nagios', metric: 'util', dimensions: { service: 'Disk_Queue_sda' }, label: 'util' },
          ],
          limit: 2000,
        },
      },
      {
        id: id + '_net',
        title: 'Network traffic — rx/tx (Mbps)',
        kind: 'timeseries_multi',
        layout: { x: 0, y: 4, w: 6, h: 4 },
        query: {
          kind: 'timeseries_multi',
          from: new Date(now - 60 * 60 * 1000).toISOString(),
          to: new Date(now).toISOString(),
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'rx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'rx_mbps' },
            { asset_id: assetId, namespace: 'nagios', metric: 'tx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'tx_mbps' },
          ],
          limit: 2000,
        },
      },
      {
        id: id + '_suri',
        title: 'Suricata alerts — 5m window',
        kind: 'timeseries',
        layout: { x: 6, y: 4, w: 6, h: 4 },
        query: {
          kind: 'timeseries',
          asset_id: assetId,
          namespace: 'nagios',
          metric: 'alerts',
          from: new Date(now - 60 * 60 * 1000).toISOString(),
          to: new Date(now).toISOString(),
          agg: 'sum',
          dimensions: { service: 'Suricata_Alerts_5m' },
          limit: 2000,
        },
      },
      {
        id: id + '_events',
        title: 'Events feed — last 60m',
        kind: 'events',
        layout: { x: 0, y: 8, w: 12, h: 4 },
        query: {
          kind: 'events',
          asset_id: assetId,
          from: new Date(now - 60 * 60 * 1000).toISOString(),
          to: new Date(now).toISOString(),
          limit: 200,
        },
      },
    ];

    return {
      id,
      name: name || 'New dashboard',
      description: prompt ? `Prompt: ${prompt}` : undefined,
      version: 'v1',
      time: { preset: '60m' },
      tags: ['studio'],
      widgets,
    };
  }

  function pretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  async function loadAssets() {
    setStatus('loading assets…');
    const data = await jget(`${API}/catalog/assets?limit=200`);
    const assets = data.assets ?? data; // API returns {ok,assets} in orbit-core

    elAsset.innerHTML = '';
    (assets || []).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.asset_id;
      opt.textContent = `${a.asset_id}${a.name ? ` — ${a.name}` : ''}`;
      elAsset.appendChild(opt);
    });

    // prefer a host:portn8n if present
    const prefer = (assets || []).find(a => a.asset_id === 'host:portn8n');
    if (prefer) elAsset.value = prefer.asset_id;

    if (!elName.value) {
      const aid = elAsset.value || '';
      elName.value = aid ? `${aid} — Core Health` : 'Core Health';
    }

    setStatus('idle');
  }

  async function onGenerate() {
    const assetId = elAsset.value;
    const spec = baselineSpec(assetId, elName.value.trim(), elPrompt.value.trim());
    elSpec.value = pretty(spec);
    elOut.textContent = '(generated — validate to confirm)';
    setStatus('generated');
  }

  async function onValidate() {
    setStatus('validating…');
    let spec;
    try {
      spec = JSON.parse(elSpec.value || '{}');
    } catch (e) {
      elOut.textContent = `Invalid JSON: ${String(e)}`;
      setStatus('error');
      return;
    }

    const r = await jpost(`${API}/dashboards/validate`, spec);
    elOut.textContent = pretty(r);
    setStatus(r.ok ? 'valid' : 'invalid');
  }

  async function onCopy() {
    const t = elSpec.value.trim();
    if (!t) return;
    await navigator.clipboard.writeText(t);
    setStatus('copied');
    setTimeout(() => setStatus('idle'), 700);
  }

  $('btn-generate').addEventListener('click', onGenerate);
  $('btn-validate').addEventListener('click', onValidate);
  $('btn-copy').addEventListener('click', onCopy);

  loadAssets().catch(e => {
    elOut.textContent = String(e);
    setStatus('error');
  });
})();
