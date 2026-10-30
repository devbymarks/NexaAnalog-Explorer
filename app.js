(function () {
  'use strict';
  const A = window.NexaAnalysis;
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const COLORS = ['#42b8ff', '#65e2dc', '#ff9c63', '#c69bff', '#f17eaa', '#a8df75'];
  let candidateSequence = 0;
  let analysisState = null;

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function nfmt(value, digits = 2) { return Number.isFinite(value) ? value.toLocaleString('pt-BR', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—'; }
  function pfmt(value) { return Number.isFinite(value) ? `${nfmt(value * 100, 1)}%` : '—'; }
  function validCandidateRows() { return $$('.candidate-row').filter(row => row._grid); }
  function setError(message) { const box = $('#input-error'); box.textContent = message; box.hidden = !message; }

  function setJourney(activeStep) {
    ['journey-data','journey-metrics','journey-explain'].forEach((id,index)=>{
      const step=$('#'+id), number=index+1;
      step.dataset.state=number<activeStep?'done':number===activeStep?'active':'upcoming';
      if(number===activeStep) step.setAttribute('aria-current','step'); else step.removeAttribute('aria-current');
    });
  }

  function addCandidate(name = '', source = '', resolution = '') {
    if ($$('.candidate-row').length >= 5) return;
    const id = ++candidateSequence;
    const row = document.createElement('div');
    row.className = 'candidate-row'; row.dataset.id = String(id);
    row.innerHTML = `<input class="candidate-name" aria-label="Nome do candidato ${id}" placeholder="Nome do local" value="${esc(name)}">
      <input class="candidate-source" aria-label="Fonte do candidato ${id}" placeholder="Fonte / produto / versão" value="${esc(source)}">
      <input class="candidate-resolution" aria-label="Resolução do candidato ${id}" type="number" min="0.001" step="any" placeholder="m/célula" value="${esc(resolution)}">
      <button type="button" class="remove-candidate" aria-label="Remover candidato">×</button>
      <label class="candidate-upload"><input type="file" accept=".asc,.txt,.csv" aria-label="Arquivo da grade do candidato ${id}"><span class="candidate-file-label">Selecionar arquivo de grade (.asc / .csv)</span></label>`;
    $('#candidates').append(row);
    $('.remove-candidate', row).addEventListener('click', () => { row.remove(); invalidateAnalysis(); setError(''); updateReadiness(); });
    $('input[type="file"]', row).addEventListener('change', event => loadGrid(event.target.files[0], row, $('.candidate-file-label', row)));
    $$('.candidate-name,.candidate-source,.candidate-resolution', row).forEach(input => input.addEventListener('input', updateReadiness));
    updateReadiness();
  }

  async function readGrid(file) {
    if (!file) return null;
    const text = await file.text();
    const ext = file.name.toLowerCase().split('.').pop();
    const grid = ext === 'csv' ? A.parseCsvGrid(text) : A.parseAsciiGrid(text);
    grid.filename = file.name;
    return grid;
  }

  async function loadGrid(file, container, label) {
    if (!file) return;
    $('#demo-banner').hidden = true;
    invalidateAnalysis();
    setError('');
    label.textContent = `Lendo ${file.name}…`;
    try {
      const grid = await readGrid(file);
      container._grid = grid;
      container.dataset.ready = 'true';
      label.textContent = `${file.name} · ${grid.cols} × ${grid.rows}`;
      if (container.id === 'reference-file') {
        $('#reference-status').classList.add('ready');
        $('#reference-status').innerHTML = `<span class="status-ring"></span>${grid.cols} × ${grid.rows} células · ${grid.format}`;
      }
    } catch (error) {
      container._grid = null; container.dataset.ready = 'false';
      label.textContent = 'Arquivo inválido · selecione outro';
      if (container.id === 'reference-file') {
        $('#reference-status').classList.remove('ready');
        $('#reference-status').innerHTML = '<span class="status-ring"></span>Falha ao ler grade';
      }
      setError(error.message || 'Não foi possível ler a grade.');
    }
    updateReadiness();
  }

  function getRecords() {
    const refGrid = $('#reference-file')._grid;
    const records = [{ name: $('#reference-name').value.trim(), source: $('#reference-source').value.trim(), resolution: Number($('#reference-resolution').value), grid: refGrid, reference: true }];
    for (const row of $$('.candidate-row')) {
      if (!row._grid) continue;
      records.push({ name: $('.candidate-name', row).value.trim(), source: $('.candidate-source', row).value.trim(), resolution: Number($('.candidate-resolution', row).value), grid: row._grid, reference: false });
    }
    return records;
  }

  function updateReadiness() {
    const ref = $('#reference-file')._grid;
    const candidates = validCandidateRows();
    const common = Number($('#cell-size').value);
    const refMetadata = $('#reference-name').value.trim() && $('#reference-source').value.trim() && Number($('#reference-resolution').value) > 0;
    const candidatesMetadata = candidates.every(row => $('.candidate-name', row).value.trim() && $('.candidate-source', row).value.trim() && Number($('.candidate-resolution', row).value) > 0);
    const confirmed = $('#projected-confirm').checked;
    const commonSet = Number.isFinite(common) && common > 0;
    const ready = Boolean(ref && refMetadata && candidates.length >= 2 && candidatesMetadata && confirmed && commonSet);
    $('#analyze-button').disabled = !ready;
    const message = !ref ? 'Comece carregando a grade de elevação da referência.'
      : candidates.length < 2 ? `Carregue pelo menos dois recortes terrestres (${candidates.length}/2 carregados).`
      : !refMetadata || !candidatesMetadata ? 'Complete o nome, a fonte com versão e a resolução de cada recorte carregado.'
      : !commonSet ? 'Informe a resolução da grade comum em metros por célula.'
      : !confirmed ? 'Confirme que os recortes estão alinhados e em projeção métrica local.'
      : 'Tudo pronto. A comparação será calculada localmente no navegador.';
    $('#readiness-message').textContent=message;
    $('#readiness-message').dataset.ready=String(ready);
  }

  function invalidateAnalysis() {
    analysisState = null;
    $('#results').hidden = true;
    setJourney(1);
  }

  function histogramSvg(series, title) {
    const width = 650, height = 190, ml = 42, mr = 12, mt = 13, mb = 28;
    const plotW = width - ml - mr, plotH = height - mt - mb;
    const all = series.flatMap(s => s.stats.values);
    let min = Infinity, max = -Infinity;
    for (const v of all) { if (v < min) min = v; if (v > max) max = v; }
    const span = max - min || 1, bins = 20;
    const lines = [];
    for (let i = 0; i <= 4; i++) {
      const y = mt + plotH * i / 4;
      lines.push(`<line x1="${ml}" y1="${y}" x2="${width-mr}" y2="${y}" stroke="#e1e8e5" stroke-width="1"/>`);
      lines.push(`<text x="${ml-7}" y="${y+3}" text-anchor="end" fill="#687b82" font-size="9" font-family="monospace">${(1-i/4).toFixed(2)}</text>`);
    }
    const paths = series.map((s, idx) => {
      const hist = A.histogram(s.stats.values, bins), maxCount = Math.max(...hist.counts, 1);
      const pts = hist.counts.map((count, i) => `${ml + (i+.5)*plotW/bins},${mt + plotH - count/maxCount*plotH}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${COLORS[idx%COLORS.length]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>`;
    }).join('');
    const xlabels = `<text x="${ml}" y="${height-6}" fill="#687b82" font-size="9" font-family="monospace">${nfmt(min,1)}</text><text x="${width-mr}" y="${height-6}" text-anchor="end" fill="#687b82" font-size="9" font-family="monospace">${nfmt(max,1)}</text>`;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}. Histogramas normalizados dos recortes.">${lines.join('')}${paths}${xlabels}</svg>`;
  }

  function renderCharts(series) {
    const slopeSeries = series.map(s => ({ name:s.record.name, stats:s.metrics.slope }));
    const roughSeries = series.map(s => ({ name:s.record.name, stats:s.metrics.roughness }));
    $('#slope-chart').innerHTML = histogramSvg(slopeSeries, 'Distribuição de declividade');
    $('#rough-chart').innerHTML = histogramSvg(roughSeries, 'Distribuição de rugosidade local');
    $('#slope-legend').innerHTML = series.map((s,i)=>`<span class="legend-item"><i class="legend-swatch" style="background:${COLORS[i%COLORS.length]}"></i>${esc(s.record.name)}</span>`).join('');
    $('#rough-legend').innerHTML = $('#slope-legend').innerHTML;
  }

  function renderTable(series) {
    const ref = series[0];
    const headers = ['RECORTE','JANELAS VÁLIDAS','COBERTURA ELEVAÇÃO','DECLIVIDADE MÉDIA','DECLIVIDADE P10–P90','RUGOSIDADE RESIDUAL MÉDIA','RUGOSIDADE P10–P90','W₁ DECLIVIDADE','W₁ RUGOSIDADE'];
    const head = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
    const body = series.map((s,i)=>`<tr><td>${esc(s.record.name)}${i===0?' · REF':''}</td><td>${s.metrics.slope.n.toLocaleString('pt-BR')}</td><td>${pfmt(s.metrics.validElevation/s.metrics.totalCells)}</td><td>${nfmt(s.metrics.slope.mean)}°</td><td>${nfmt(s.metrics.slope.p10)}° – ${nfmt(s.metrics.slope.p90)}°</td><td>${nfmt(s.metrics.roughness.mean)} m</td><td>${nfmt(s.metrics.roughness.p10)} – ${nfmt(s.metrics.roughness.p90)} m</td><td>${i===0?'—':`${nfmt(s.distance.slopeW1,3)}°`}</td><td>${i===0?'—':`${nfmt(s.distance.roughnessW1,3)} m`}</td></tr>`).join('');
    $('#metrics-table').innerHTML = `${head}<tbody>${body}</tbody>`;
  }

  function renderExplanation(series, weight) {
    const comparisons = series.slice(1).map(s=>({...s, score:A.scoreDistance(s.distance,weight)})).filter(s=>s.score != null).sort((a,b)=>a.score-b.score);
    if (!comparisons.length) {
      $('#result-callout').innerHTML = '<strong>Comparação descritiva concluída.</strong> Não foi possível normalizar a distância pelo intervalo interquartil da referência em ambas as métricas. Os dados e diferenças em unidades físicas continuam disponíveis, mas o ranking está desativado.';
      $('#why-content').innerHTML = '<p>Uma das distribuições da referência tem dispersão zero ou insuficiente para normalizar a distância. Isso impede a classificação combinada sem introduzir uma escala arbitrária. Consulte os valores brutos e os intervalos apresentados.</p>';
      return;
    }
    const best = comparisons[0], tied = comparisons.filter(x => Math.abs(x.score-best.score)<1e-9);
    const winners = tied.map(x=>`<strong>${esc(x.record.name)}</strong>`).join(' e ');
    $('#result-callout').innerHTML = tied.length > 1 ? `<strong>Menor distância normalizada nesta configuração:</strong> empate entre ${winners}. A ordem usa ${Math.round(weight*100)}% de peso para declividade e ${Math.round((1-weight)*100)}% para rugosidade; não é uma probabilidade.` : `<strong>Menor distância normalizada nesta configuração:</strong> ${winners}. O resultado usa ${Math.round(weight*100)}% de peso para declividade e ${Math.round((1-weight)*100)}% para rugosidade; não é uma probabilidade de sucesso.`;
    const slopeLabel = weight === 0 ? 'peso atual zero' : `${nfmt(best.distance.slopeW1,3)}° de W₁ bruto, equivalente a ${nfmt(best.distance.slopeNormalized,3)} IQR da referência`;
    const roughLabel = weight === 1 ? 'peso atual zero' : `${nfmt(best.distance.roughnessW1,3)} m de W₁ bruto, equivalente a ${nfmt(best.distance.roughnessNormalized,3)} IQR da referência`;
    $('#why-content').innerHTML = `<p>${winners} ${tied.length > 1?'ficaram empatados':'teve a menor distância combinada'} entre os candidatos carregados, com os pesos escolhidos.</p><ul><li><b>Declividade:</b> distância Wasserstein aproximada de ${slopeLabel}.</li><li><b>Rugosidade:</b> distância Wasserstein aproximada de ${roughLabel}.</li><li><b>Leitura correta:</b> ordenação relativa dentro dos recortes e métricas informados; não representa equivalência de terreno em outros aspectos.</li></ul>`;
  }

  function renderRanking(series, weight) {
    const comparisons = series.slice(1).map(s=>({...s, score:A.scoreDistance(s.distance,weight)}));
    const rankable = comparisons.filter(s=>s.score != null).sort((a,b)=>a.score-b.score);
    $('#ranking-list').innerHTML = rankable.length ? rankable.map((s,i)=>`<div class="rank-row ${i===0?'best':''}"><span class="rank-number">${String(i+1).padStart(2,'0')}</span><span class="rank-name">${esc(s.record.name)}</span><span class="rank-score">D = ${nfmt(s.score,3)}</span></div>`).join('') : '<div class="small-limit">Ranking indisponível: escala IQR nula ou insuficiente na referência.</div>';
    $('#sensitivity-note').textContent = 'D é a média ponderada das distâncias Wasserstein por IQR da referência. Variações de peso podem alterar a ordem; esse índice é exploratório, não probabilidade nem medida universal de analogia.';
    renderExplanation(series, weight);
  }

  function renderRepro(series, common, weight) {
    const lines = [
      'Método: declividade pelo operador de Horn 3×3; rugosidade local = desvio-padrão dos resíduos após remover o plano de melhor ajuste na janela 3×3.',
      `Resolução declarada: ${common} m/célula. Área aproximada por recorte: ${nfmt(series[0].metrics.areaKm2,2)} km².`,
      'Distâncias de distribuição: W₁ aproximado pela média da diferença absoluta em 256 quantis igualmente espaçados.',
      'Escala adimensional do ranking: W₁ dividido pelo IQR da distribuição da referência; ranking indisponível se o IQR for zero.',
      `Pesos no momento da exportação: declividade ${Math.round(weight*100)}%; rugosidade ${Math.round((1-weight)*100)}%.`,
      'NoData: células não finitas e -9999 são excluídas. Janelas 3×3 com qualquer vizinho inválido não entram nas métricas.',
      'As grades precisam estar em projeção métrica local, alinhadas em tamanho de célula e cobrir recortes da mesma dimensão física.',
      `Data da análise: ${new Date().toISOString()}.`,
      ...series.map(s=>`${s.record.reference?'REFERÊNCIA':'CANDIDATO'}: ${s.record.name} | arquivo=${s.record.grid.filename||'exemplo gerado'} | fonte=${s.record.source} | resolução declarada=${s.record.resolution} m/célula | grade=${s.record.grid.cols}×${s.record.grid.rows} | formato=${s.record.grid.format} | células de elevação válidas=${s.metrics.validElevation}/${s.metrics.totalCells} | janelas válidas=${s.metrics.slopeCells}`)
    ];
    $('#repro-content').innerHTML = lines.map(line=>`<div class="repro-line">${esc(line)}</div>`).join('');
  }

  function runAnalysis() {
    setError('');
    try {
      const records = getRecords(), common = Number($('#cell-size').value);
      if (!$('#projected-confirm').checked) throw new Error('Confirme a projeção métrica e a compatibilidade dos recortes antes de executar.');
      A.validateRecords(records, common);
      const series = records.map(record=>({record, metrics:A.computeTerrain(record.grid, common)}));
      for (let i=1;i<series.length;i++) series[i].distance = A.compare(series[0].metrics,series[i].metrics);
      analysisState = {series, common};
      $('#results').hidden = false;
      renderCharts(series); renderTable(series); renderRanking(series,Number($('#slope-weight').value)/100); renderRepro(series,common,Number($('#slope-weight').value)/100);
      setJourney(3);
      $('#results').scrollIntoView({behavior:'smooth',block:'start'});
      updateReadiness();
    } catch (error) { setError(error.message || 'Não foi possível executar a comparação.'); }
  }

  function exportCsv() {
    if (!analysisState) return;
    const {series,common}=analysisState, weight=Number($('#slope-weight').value)/100;
    const timestamp=new Date().toISOString();
    const blob=new Blob([A.buildCsv(series,common,weight,timestamp)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nexaanalog-comparison.csv';a.click();URL.revokeObjectURL(url);
  }

  function fillDemo() {
    $('#demo-banner').hidden=false;
    const demo=A.syntheticExample();
    $('#reference-name').value='Exemplo sintético · Marte (simulado)';
    $('#reference-source').value='Demonstração sintética · fórmula determinística';
    $('#reference-resolution').value='500'; $('#cell-size').value='500';
    $('#reference-file')._grid=demo.reference; $('#reference-file').dataset.ready='true';
    $('#reference-file-label').textContent='Matriz sintética carregada · 48 × 48';
    $('#reference-status').classList.add('ready');$('#reference-status').innerHTML='<span class="status-ring"></span>Exemplo sintético · sem dados reais';
    const defaults=[['Candidato A · sintético','Fórmula determinística · demonstração'],['Candidato B · sintético','Fórmula determinística · demonstração'],['Candidato C · sintético','Fórmula determinística · demonstração']];
    $('#candidates').innerHTML='';
    defaults.forEach((d,i)=>{addCandidate(d[0],d[1],'500');const row=$$('.candidate-row').at(-1);row._grid=demo.candidates[i];row.dataset.ready='true';$('.candidate-file-label',row).textContent='Matriz sintética carregada · 48 × 48';});
    $('#projected-confirm').checked=true;$('#demo-banner').hidden=false;
    analysisState=null;$('#results').hidden=true;updateReadiness();
  }

  $('#reference-file').addEventListener('change',event=>loadGrid(event.target.files[0],$('#reference-file'),$('#reference-file-label')));
  ['reference-name','reference-source','reference-resolution','cell-size'].forEach(id=>$('#'+id).addEventListener('input',()=>{invalidateAnalysis();updateReadiness();}));
  $('#projected-confirm').addEventListener('change',()=>{invalidateAnalysis();updateReadiness();});
  $('#candidates').addEventListener('input',()=>{invalidateAnalysis();updateReadiness();});
  $('#add-candidate').addEventListener('click',()=>addCandidate());
  $('#analyze-button').addEventListener('click',runAnalysis);
  $('#demo-button').addEventListener('click',fillDemo);
  $('#slope-weight').addEventListener('input',event=>{
    const v=Number(event.target.value)/100;$('#slope-weight-label').value=`${event.target.value}%`;
    if(analysisState){renderRanking(analysisState.series,v);renderRepro(analysisState.series,analysisState.common,v);}
  });
  $('#export-button').addEventListener('click',exportCsv);
  addCandidate('Atacama · recorte a verificar','','');
  addCandidate('Candidato 2 · a selecionar','','');
  addCandidate('Candidato 3 · a selecionar','','');
  setJourney(1);
})();

