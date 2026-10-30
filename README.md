# NexaAnalog Explorer

Aplicação local, sem dependências externas, para comparar distribuições de declividade e rugosidade de recortes de modelos digitais de elevação. A versão atual é uma demonstração funcional do método: **não inclui nem declara resultados obtidos de dados planetários reais**.

## Abrir

Abra `index.html` em um navegador moderno. O aplicativo roda no próprio navegador; os arquivos selecionados não são enviados a um servidor. Não é necessário instalar Python ou pacotes JavaScript.

Use **Carregar exemplo sintético** para percorrer o fluxo e ver resultados gerados por fórmulas. O aviso de demonstração identifica esses números como sintéticos. Remova o aviso ou carregue dados reais somente depois de confirmar a origem e o processamento dos arquivos.

## Dados aceitos

- ESRI ASCII Grid (`.asc`) com cabeçalho padrão e valores de elevação em metros.
- CSV (`.csv`) com uma matriz retangular de números, sem cabeçalho; células vazias, `NaN` ou `NoData` são tratadas como ausentes.

O aplicativo **não abre GeoTIFF, arquivos HGT brutos nem imagens binárias PDS `.IMG`**. Antes do upload, recorte, reprojete, alinhe e reamostre os DEMs num SIG. Para comparação, cada arquivo precisa ter:

1. Mesmo número de linhas e colunas.
2. Mesma resolução horizontal em metros por célula (diferença máxima declarada de 2%).
3. Uma área física de mesma dimensão e projeção métrica local.
4. Elevações em metros e uma política explícita de NoData.

O controle de confirmação na interface registra que a pessoa responsável conferiu esses requisitos; ele não valida automaticamente a projeção nem a origem dos dados. Se a grade ASCII declarar `cellsize`, o valor também deve concordar com a resolução comum.

## Método implementado

- Declividade: diferenças Horn 3×3, em graus, calculadas a partir da elevação e do espaçamento de célula.
- Rugosidade local: desvio-padrão populacional dos resíduos após remover o plano de melhor ajuste nas nove elevações da janela 3×3, em metros. Isso reduz a contribuição da inclinação planar à medida de rugosidade.
- A janela cobre três células por lado; por exemplo, 1,5 km de largura quando cada célula mede 500 m.
- NoData: valores não finitos, `-9999` e o valor declarado em `NODATA_value` no cabeçalho ASCII são excluídos; janelas com qualquer célula inválida não são usadas.
- Estatísticas: média, mediana, percentis 10 e 90, IQR e desvio-padrão populacional.
- Distância entre distribuições: aproximação unidimensional Wasserstein-1 calculada em 256 quantis igualmente espaçados, mostrada nas unidades originais.
- Distância combinada exploratória: soma ponderada das distâncias por IQR da distribuição de referência. O controle de peso varia entre declividade e rugosidade. Se o IQR de uma métrica da referência é zero, a ordenação combinada fica indisponível, sem inventar uma escala substituta.
- Exportação: CSV contém os valores, distâncias, fontes e parâmetros da análise.

Não são estimados intervalos de confiança: células vizinhas têm dependência espacial e não são tratadas como observações independentes. A ferramenta não interpreta o resultado como probabilidade de sucesso ou equivalência geológica.

## Preparação científica ainda necessária

Para usar MOLA e NASADEM, produza AOIs com cobertura conferida, sistema de coordenadas adequado e resolução comum documentada. MOLA 128 pixels por grau tem aproximadamente 463 m por célula no equador; NASADEM tem aproximadamente 30 m. Uma comparação com grade próxima de 500 m perde detalhes terrestres mais finos e só sustenta conclusões nessa escala regional. Registre produto, versão, DOI/URL, recorte, transformação, método de reamostragem, unidades e data.

O aplicativo calcula métricas a partir dos valores recebidos. Ele não verifica automaticamente a licença, a versão científica, a precisão vertical, a cobertura espacial, nem se a área terrestre realmente é um análogo. Tais evidências devem acompanhar a análise e constar na apresentação.

## Verificação de desenvolvimento

O núcleo de cálculo tem testes determinísticos em `tests/analysis.test.cjs`. Com Node.js 18 ou superior:

```powershell
node --test tests/analysis.test.cjs
```

Os testes exercitam parsing, NoData, declividade de um plano de inclinação conhecida, entradas idênticas, pesos e dados inválidos. Eles verificam o código matemático; **não validam os produtos MOLA/NASADEM nem os resultados de qualquer AOI real**.

## Regras do evento e uso de IA

O protótipo foi escrito com assistência de IA antes do hackathon. A página pública de 2026 incentiva revisão dos desafios e exploração dos dados antes do evento, mas a pesquisa realizada até 29 de outubro de 2026 não encontrou uma regra pública específica que confirme ou proíba código prévio ou ferramentas generativas. Verifique essas condições com a organização e siga as instruções oficiais que forem publicadas. O registro do uso de IA também está em `docs/AI_USAGE.md`.

Fontes oficiais verificadas para o planejamento: [desafio 2026](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/), [termos de participação](https://www.spaceappschallenge.org/legal/), [arquivo MOLA](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html), [NASADEM](https://data.nasa.gov/dataset/nasadem-merged-dem-global-1-arc-second-v001).

