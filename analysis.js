(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NO_DATA = -9999;

  function parseAsciiGrid(source) {
    const lines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const header = {};
    let i = 0;
    while (i < lines.length && Object.keys(header).length < 6) {
      const parts = lines[i].split(/\s+/);
      const key = parts[0].toLowerCase();
      if (!['ncols', 'nrows', 'xllcorner', 'xllcenter', 'yllcorner', 'yllcenter', 'cellsize', 'nodata_value'].includes(key)) break;
      if (parts.length < 2 || !Number.isFinite(Number(parts[1]))) throw new Error(`Cabeçalho ASCII inválido na linha ${i + 1}.`);
      header[key] = Number(parts[1]);
      i++;
    }
    const cols = header.ncols, rows = header.nrows;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 3 || rows < 3) throw new Error('A grade precisa ter ncols e nrows inteiros, ambos ≥ 3.');
    const cell = header.cellsize;
    if (!Number.isFinite(cell) || cell <= 0) throw new Error('O cabeçalho precisa declarar cellsize positivo.');
    const values = parseGridRows(lines.slice(i), cols, rows, null, header.nodata_value ?? NO_DATA);
    return { rows, cols, values, cellX: cell, cellY: cell, nodata: header.nodata_value ?? NO_DATA,
      xll: header.xllcorner ?? header.xllcenter ?? null, yll: header.yllcorner ?? header.yllcenter ?? null,
      header, format: 'ESRI ASCII Grid' };
  }

  function parseCsvGrid(source) {
    const lines = String(source).replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < 3) throw new Error('CSV precisa ter ao menos 3 linhas e 3 colunas.');
    const delimiter = lines[0].includes(';') ? ';' : ',';
    const first = lines[0].split(delimiter);
    const cols = first.length;
    if (cols < 3) throw new Error('CSV precisa ter ao menos 3 colunas numéricas, sem cabeçalho.');
    const values = parseGridRows(lines, cols, lines.length, delimiter);
    return { rows: lines.length, cols, values, cellX: null, cellY: null, nodata: NaN, xll: null, yll: null, header: {}, format: 'CSV' };
  }

  function parseGridRows(lines, cols, rows, delimiter, nodata = NO_DATA) {
    if (lines.length !== rows) throw new Error(`A grade declara ${rows} linhas, mas contém ${lines.length}.`);
    const values = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const cells = delimiter ? lines[r].split(delimiter).map(v => v.trim()) : lines[r].split(/\s+/);
      if (cells.length !== cols) throw new Error(`Linha ${r + 1} tem ${cells.length} colunas; eram esperadas ${cols}.`);
      for (let c = 0; c < cols; c++) {
        const token = cells[c];
        const value = token === '' || /^(nan|null|nodata)$/i.test(token) ? NaN : Number(token);
        values[r * cols + c] = Number.isFinite(value) && value !== nodata && value !== NO_DATA ? value : NaN;
      }
    }
    return values;
  }

  function summarize(values) {
    const a = Array.from(values).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) throw new Error('Não há células válidas para resumir.');
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
    return { n: a.length, mean, median: quantileSorted(a, .5), p10: quantileSorted(a, .1), p90: quantileSorted(a, .9), iqr: quantileSorted(a, .75) - quantileSorted(a, .25), std: Math.sqrt(variance), values: a };
  }

  function quantileSorted(sorted, p) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function computeTerrain(grid, cellMeters) {
    if (!Number.isFinite(cellMeters) || cellMeters <= 0) throw new Error('Informe a resolução comum em metros por célula.');
    const slope = [], roughness = [];
    let validElevation = 0;
    for (const z of grid.values) if (Number.isFinite(z)) validElevation++;
    for (let r = 1; r < grid.rows - 1; r++) {
      for (let c = 1; c < grid.cols - 1; c++) {
        const ix = r * grid.cols + c;
        const ids = [ix-grid.cols-1, ix-grid.cols, ix-grid.cols+1, ix-1, ix, ix+1, ix+grid.cols-1, ix+grid.cols, ix+grid.cols+1];
        const w = ids.map(id => grid.values[id]);
        if (w.some(v => !Number.isFinite(v))) continue;
        const dx = ((w[2] + 2*w[5] + w[8]) - (w[0] + 2*w[3] + w[6])) / (8 * cellMeters);
        const dy = ((w[6] + 2*w[7] + w[8]) - (w[0] + 2*w[1] + w[2])) / (8 * cellMeters);
        slope.push(Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI);
        const avg = w.reduce((s, v) => s + v, 0) / 9;
        // Remove the best-fit local plane so roughness is not simply slope
        // expressed as elevation dispersion. Coordinates are cell offsets.
        let bx = 0, by = 0;
        for (let k = 0; k < 9; k++) {
          const dr = Math.floor(k / 3) - 1, dc = (k % 3) - 1;
          bx += dc * w[k]; by += dr * w[k];
        }
        bx /= 6; by /= 6;
        let residualSS = 0;
        for (let k = 0; k < 9; k++) {
          const dr = Math.floor(k / 3) - 1, dc = (k % 3) - 1;
          const residual = w[k] - (avg + bx * dc + by * dr);
          residualSS += residual * residual;
        }
        roughness.push(Math.sqrt(residualSS / 9));
      }
    }
    if (slope.length < 1) throw new Error('Não há janelas 3×3 completas. Verifique tamanho e NoData.');
    return { slope: summarize(slope), roughness: summarize(roughness), totalCells: grid.rows * grid.cols,
      validElevation, validWindowFraction: slope.length / Math.max(1, (grid.rows - 2) * (grid.cols - 2)),
      slopeCells: slope.length, cellMeters, areaKm2: grid.rows * grid.cols * cellMeters * cellMeters / 1e6 };
  }

  // Approximate 1-D Wasserstein-1 distance by the mean absolute gap at 256
  // equally spaced quantile midpoints. Raw metric units are preserved.
  function wasserstein1(a, b, slices = 256) {
    const sa = a.values || summarize(a).values, sb = b.values || summarize(b).values;
    let sum = 0;
    for (let i = 0; i < slices; i++) {
      const p = (i + .5) / slices;
      sum += Math.abs(quantileSorted(sa, p) - quantileSorted(sb, p));
    }
    return sum / slices;
  }

  function compare(reference, candidate) {
    const slopeW1 = wasserstein1(reference.slope, candidate.slope);
    const roughnessW1 = wasserstein1(reference.roughness, candidate.roughness);
    const slopeNormalized = reference.slope.iqr > 0 ? slopeW1 / reference.slope.iqr : null;
    const roughnessNormalized = reference.roughness.iqr > 0 ? roughnessW1 / reference.roughness.iqr : null;
    return { slopeW1, roughnessW1, slopeNormalized, roughnessNormalized };
  }

  function scoreDistance(distance, slopeWeight) {
    if (distance.slopeNormalized == null || distance.roughnessNormalized == null) return null;
    return (slopeWeight * distance.slopeNormalized) + ((1 - slopeWeight) * distance.roughnessNormalized);
  }

  function validateRecords(records, common) {
    if (!Array.isArray(records) || records.length < 3) throw new Error('Carregue a referência e pelo menos dois candidatos para comparar.');
    if (!Number.isFinite(common) || common <= 0) throw new Error('Informe a resolução comum em metros por célula.');
    const ref = records[0], tol = Math.max(common * .02, .01);
    for (const rec of records) {
      if (!rec.name || !rec.source || !rec.grid) throw new Error('Preencha nome, fonte/produto e arquivo para todos os recortes.');
      if (!Number.isInteger(rec.grid.rows) || !Number.isInteger(rec.grid.cols) || rec.grid.rows < 3 || rec.grid.cols < 3) throw new Error(`A grade de “${rec.name}” precisa ter ao menos 3 linhas e 3 colunas.`);
      if (rec.grid.rows !== ref.grid.rows || rec.grid.cols !== ref.grid.cols) throw new Error('As grades precisam ter o mesmo número de linhas e colunas. Recorte e alinhe os arquivos antes de carregar.');
      if (!Number.isFinite(rec.resolution) || Math.abs(rec.resolution - common) > tol) throw new Error(`A resolução declarada de “${rec.name}” difere da resolução comum em mais de 2%.`);
      if (rec.grid.cellX != null && Math.abs(rec.grid.cellX - common) > tol) throw new Error(`O cellsize do arquivo de “${rec.name}” não coincide com a resolução comum. Confira a projeção e o arquivo.`);
    }
    return true;
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function buildCsv(series, common, slopeWeight, timestamp = new Date().toISOString()) {
    if (!Array.isArray(series) || !series.length) throw new Error('Não há resultados para exportar.');
    if (!Number.isFinite(common) || common <= 0 || !Number.isFinite(slopeWeight) || slopeWeight < 0 || slopeWeight > 1) throw new Error('Parâmetros inválidos para exportação.');
    const head=['record_type','name','source_product','filename','format','rows','columns','resolution_m_per_cell','area_km2','elevation_valid_cells','elevation_coverage_fraction','slope_valid_cells','slope_mean_deg','slope_median_deg','slope_p10_deg','slope_p90_deg','slope_iqr_deg','detrended_roughness_mean_m','detrended_roughness_median_m','detrended_roughness_p10_m','detrended_roughness_p90_m','detrended_roughness_iqr_m','slope_wasserstein1_deg','roughness_wasserstein1_m','slope_normalized_by_reference_iqr','roughness_normalized_by_reference_iqr','slope_weight','roughness_weight','exploratory_distance','common_cell_size_m','analysis_date_utc'];
    const rows = series.map((s,i) => {
      const d=s.distance||{},m=s.metrics;
      if (!m || !s.record || !m.slope || !m.roughness) throw new Error('Resultados incompletos para exportação.');
      const score=i?scoreDistance(d,slopeWeight):null;
      return [i?'candidate':'reference',s.record.name,s.record.source,s.record.grid.filename||'synthetic_formula',s.record.grid.format,s.record.grid.rows,s.record.grid.cols,s.record.resolution,m.areaKm2,m.validElevation,m.validElevation/m.totalCells,m.slopeCells,m.slope.mean,m.slope.median,m.slope.p10,m.slope.p90,m.slope.iqr,m.roughness.mean,m.roughness.median,m.roughness.p10,m.roughness.p90,m.roughness.iqr,d.slopeW1,d.roughnessW1,d.slopeNormalized,d.roughnessNormalized,slopeWeight,1-slopeWeight,score,common,timestamp].map(csvCell).join(',');
    });
    return [head.map(csvCell).join(','), ...rows].join('\r\n');
  }

  function histogram(values, bins = 18) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return { edges: [], counts: [] };
    const min = valid[0], max = valid[valid.length - 1];
    const width = max === min ? 1 : (max - min) / bins;
    const counts = Array(bins).fill(0);
    for (const v of valid) counts[Math.min(bins - 1, Math.floor((v - min) / width))]++;
    return { edges: Array.from({length: bins + 1}, (_, i) => min + i * width), counts };
  }

  function syntheticExample() {
    const rows = 48, cols = 48, cellX = 500, cellY = 500;
    const make = (fn) => {
      const values = new Float64Array(rows * cols);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = fn(r, c);
      return { rows, cols, values, cellX, cellY, nodata: NaN, xll: null, yll: null, format: 'Exemplo sintético (fórmula)' };
    };
    const ref = make((r,c) => 210 + 34*Math.sin(c/5.7) + 25*Math.cos(r/7.4) + 14*Math.sin((r+c)/3.1) + 8*Math.cos((r-2*c)/2.8));
    const candA = make((r,c) => 195 + 31*Math.sin(c/5.9) + 23*Math.cos(r/7.2) + 13*Math.sin((r+c)/3.15) + 8*Math.cos((r-2*c)/2.9));
    const candB = make((r,c) => 190 + 50*Math.sin(c/4.3) + 33*Math.cos(r/5.4) + 20*Math.sin((r+c)/2.2) + 13*Math.cos((r-2*c)/1.9));
    const candC = make((r,c) => 180 + 12*Math.sin(c/9.1) + 9*Math.cos(r/8.3) + 6*Math.sin((r+c)/5.9) + 3*Math.cos((r-2*c)/4.8));
    return { reference: ref, candidates: [candA, candB, candC] };
  }

  return { parseAsciiGrid, parseCsvGrid, parseGridRows, summarize, quantileSorted, computeTerrain, wasserstein1, compare, scoreDistance, validateRecords, buildCsv, histogram, syntheticExample, NO_DATA };
});

