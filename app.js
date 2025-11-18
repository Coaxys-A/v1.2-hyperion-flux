const state = {
  data: null,
  modules: [],
  allModules: [],
  activeStageIndex: 0,
  activeModule: null,
  filters: {
    query: '',
    domain: 'all',
  },
};

const selectors = {
  summary: document.querySelector('[data-summary]'),
  pillarsCount: document.querySelector('[data-pillars-count]'),
  modulesCount: document.querySelector('[data-modules-count]'),
  roadmapCount: document.querySelector('[data-roadmap-count]'),
  stageCount: document.querySelector('[data-stage-count]'),
  pillarGrid: document.getElementById('pillarGrid'),
  moduleGrid: document.getElementById('moduleGrid'),
  moduleEmpty: document.getElementById('moduleEmpty'),
  roadmapTimeline: document.getElementById('roadmapTimeline'),
  riskList: document.getElementById('riskList'),
  insightOutput: document.getElementById('insightOutput'),
  stageNumber: document.querySelector('[data-stage-number]'),
  stageDetail: document.querySelector('[data-stage-detail]'),
  stageProgressValue: document.querySelector('[data-stage-progress]'),
  stageProgressFill: document.querySelector('[data-stage-progress-fill]'),
  stageRange: document.getElementById('stageRange'),
  patternGrid: document.getElementById('patternGrid'),
  domainFilters: document.getElementById('domainFilters'),
  assetGrid: document.getElementById('assetGrid'),
  stackGrid: document.getElementById('stackGrid'),
  serviceGrid: document.getElementById('serviceGrid'),
  scriptList: document.getElementById('scriptList'),
  labMetrics: document.getElementById('labMetrics'),
  matrixTable: document.getElementById('matrixTable'),
  repoGrid: document.getElementById('repoGrid'),
  fusionGrid: document.getElementById('fusionGrid'),
  moduleDrawer: document.getElementById('moduleDrawer'),
  moduleDrawerTitle: document.querySelector('[data-module-title]'),
  moduleDrawerDomain: document.querySelector('[data-module-domain]'),
  moduleDrawerSummary: document.querySelector('[data-module-summary]'),
  moduleDrawerInterfaces: document.querySelector('[data-module-interfaces]'),
  moduleDrawerKpis: document.querySelector('[data-module-kpis]'),
  moduleDrawerMitigations: document.querySelector('[data-module-mitigations]'),
  moduleDrawerTags: document.querySelector('[data-module-tags]'),
  moduleDrawerSources: document.querySelector('[data-module-sources]'),
  moduleDrawerClose: document.querySelector('[data-module-close]'),
};

async function bootstrap() {
  try {
    const response = await fetch('data/hyperionFluxData.json');
    if (!response.ok) throw new Error('Unable to load Hyperion‑Flux data');
    const data = await response.json();
    state.data = data;
    state.allModules = data.modules;
    state.modules = data.modules;
    hydrateHero();
    renderPillars();
    renderDomainFilters();
    applyModuleFilters();
    renderPatterns();
    renderAssets();
    renderStackLayers();
    renderMissionServices();
    renderMissionScripts();
    renderRoadmap();
    renderRisks();
    renderStages();
    renderLabMetrics();
    renderMatrix();
    renderRepoStreams();
    renderFusionThreads();
    bindSearch();
    bindInsights();
    bindModuleDrawer();
  } catch (error) {
    selectors.summary.textContent = error.message;
    console.error(error);
  }
}

function hydrateHero() {
  const { summary, architecture_pillars, modules, roadmap_phases, stages } = state.data;
  selectors.summary.textContent = summary;
  selectors.pillarsCount.textContent = architecture_pillars.length;
  selectors.modulesCount.textContent = modules.length;
  selectors.roadmapCount.textContent = roadmap_phases.length;
  selectors.stageCount.textContent = stages.length;
}

function renderPillars() {
  const fragment = document.createDocumentFragment();
  state.data.architecture_pillars.forEach((pillar) => {
    const card = document.createElement('article');
    card.className = 'pillar-card';
    card.innerHTML = `
      <span class="badge">Pillar</span>
      <h3>${pillar}</h3>
      <p>Reinforces distributed autonomy, secure execution, and verifiable telemetry across the swarm.</p>
    `;
    fragment.appendChild(card);
  });
  selectors.pillarGrid.replaceChildren(fragment);
}

function renderModules() {
  const fragment = document.createDocumentFragment();
  state.modules.forEach((module, index) => {
    const card = document.createElement('article');
    card.className = 'module-card';
    card.innerHTML = `
      <div class="module-card__header">
        <span class="badge">${module.name}</span>
        <small>${module.domain}</small>
      </div>
      <h3>${module.purpose}</h3>
      <p>${module.security}</p>
      <small>Module ${index + 1} of ${state.data.modules.length}</small>
    `;

    const chips = document.createElement('ul');
    chips.className = 'chip-list';
    module.tags.forEach((tag) => {
      const chip = document.createElement('li');
      chip.textContent = tag;
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    if (module.sources?.length) {
      const sourceList = document.createElement('ul');
      sourceList.className = 'code-list';
      module.sources.forEach((source) => {
        const item = document.createElement('li');
        item.textContent = source;
        sourceList.appendChild(item);
      });
      card.appendChild(sourceList);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open forge brief';
    button.addEventListener('click', () => openModuleDrawer(module));
    card.appendChild(button);
    fragment.appendChild(card);
  });
  selectors.moduleGrid.replaceChildren(fragment);
  if (selectors.moduleEmpty) {
    selectors.moduleEmpty.hidden = state.modules.length > 0;
  }
}

function renderDomainFilters() {
  if (!selectors.domainFilters) return;
  const filters = ['all', ...new Set(state.data.modules.map((module) => module.domain))];
  selectors.domainFilters.replaceChildren();
  filters.forEach((domain) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = domain;
    button.dataset.domain = domain;
    if (state.filters.domain === domain) {
      button.classList.add('is-active');
    }
    button.addEventListener('click', () => {
      state.filters.domain = domain;
      renderDomainFilters();
      applyModuleFilters();
    });
    selectors.domainFilters.appendChild(button);
  });
}

function applyModuleFilters() {
  const query = state.filters.query.trim().toLowerCase();
  const domain = state.filters.domain;
  state.modules = state.allModules.filter((module) => {
    const matchesDomain = domain === 'all' || module.domain === domain;
    if (!matchesDomain) return false;
    if (!query) return true;
    const haystack = [
      module.name,
      module.domain,
      module.purpose,
      module.security,
      module.tags.join(' '),
      module.interfaces.join(' '),
      module.kpis.join(' '),
      module.mitigations.join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
  renderModules();
}

function renderPatterns() {
  if (!selectors.patternGrid) return;
  const fragment = document.createDocumentFragment();
  state.data.forge_patterns.forEach((pattern) => {
    const card = document.createElement('article');
    card.className = 'pattern-card';
    card.innerHTML = `
      <span class="badge">Blueprint</span>
      <h3>${pattern.name}</h3>
      <p>${pattern.focus}</p>
      <strong>${pattern.value}</strong>
      <p class="eyebrow">Components</p>
      <ul>${pattern.components.map((item) => `<li>${item}</li>`).join('')}</ul>
      <small>${pattern.signal}</small>
    `;
    fragment.appendChild(card);
  });
  selectors.patternGrid.replaceChildren(fragment);
}

function renderStackLayers() {
  if (!selectors.stackGrid || !state.data.stack_layers) return;
  const fragment = document.createDocumentFragment();
  state.data.stack_layers.forEach((layer) => {
    const card = document.createElement('article');
    card.className = 'stack-card';
    card.innerHTML = `
      <div class="stack-card__header">
        <span class="badge">${layer.segment}</span>
        <h3>${layer.focus}</h3>
      </div>
      <p>${layer.description}</p>
      <p class="eyebrow">Artifacts</p>
      <ul class="stack-card__artifacts">${layer.artifacts
        .map((artifact) => `<li>${artifact}</li>`)
        .join('')}</ul>
      <small>${layer.signal}</small>
    `;
    fragment.appendChild(card);
  });
  selectors.stackGrid.replaceChildren(fragment);
}

function renderMissionServices() {
  if (!selectors.serviceGrid || !state.data.mission_services) return;
  const fragment = document.createDocumentFragment();
  state.data.mission_services.forEach((service) => {
    const card = document.createElement('article');
    card.className = 'service-card';
    card.innerHTML = `
      <div class="service-card__header">
        <h3>${service.name}</h3>
        <span class="badge">${service.status}</span>
      </div>
      <p>${service.description}</p>
      <p class="eyebrow">Touchpoints</p>
      <ul>${service.touchpoints.map((file) => `<li>${file}</li>`).join('')}</ul>
      <strong>${service.kpi}</strong>
    `;
    fragment.appendChild(card);
  });
  selectors.serviceGrid.replaceChildren(fragment);
}

function renderAssets() {
  if (!selectors.assetGrid) return;
  const fragment = document.createDocumentFragment();
  state.data.forge_assets.forEach((asset) => {
    const card = document.createElement('article');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-card__header">
        <span class="badge">${asset.type}</span>
        <strong>${asset.name}</strong>
      </div>
      <p>${asset.description}</p>
      <p class="asset-origin">${asset.origin}</p>
      <p class="eyebrow">Linked modules</p>
      <ul class="chip-list">${asset.linked_modules.map((module) => `<li>${module}</li>`).join('')}</ul>
    `;
    fragment.appendChild(card);
  });
  selectors.assetGrid.replaceChildren(fragment);
}

function renderRepoStreams() {
  if (!selectors.repoGrid || !state.data.repository_streams) return;
  const fragment = document.createDocumentFragment();
  state.data.repository_streams.forEach((repo) => {
    const card = document.createElement('article');
    card.className = 'repo-card';
    card.innerHTML = `
      <span class="badge">${repo.role}</span>
      <h3>${repo.name}</h3>
      <p>${repo.notes}</p>
      <a href="${repo.url}" target="_blank" rel="noreferrer">View repository</a>
    `;

    if (repo.files?.length) {
      const list = document.createElement('ul');
      list.className = 'code-list';
      repo.files.forEach((file) => {
        const item = document.createElement('li');
        item.textContent = file;
        list.appendChild(item);
      });
      card.appendChild(list);
    }
    fragment.appendChild(card);
  });
  selectors.repoGrid.replaceChildren(fragment);
}

function renderFusionThreads() {
  if (!selectors.fusionGrid || !state.data.fusion_threads) return;
  const fragment = document.createDocumentFragment();
  state.data.fusion_threads.forEach((thread) => {
    const card = document.createElement('article');
    card.className = 'thread-card';
    card.innerHTML = `
      <h3>${thread.title}</h3>
      <p>${thread.description}</p>
    `;

    const grids = [
      { label: 'v1.2 files', items: thread.hyperion_files },
      { label: 'v0 files', items: thread.v0_files },
      { label: 'Quantum forge files', items: thread.quantum_files },
    ];

    const listWrapper = document.createElement('div');
    listWrapper.className = 'thread-columns';

    grids.forEach((grid) => {
      const column = document.createElement('article');
      column.innerHTML = `<p class="eyebrow">${grid.label}</p>`;
      const list = document.createElement('ul');
      list.className = 'code-list';
      (grid.items || []).forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      column.appendChild(list);
      listWrapper.appendChild(column);
    });

    card.appendChild(listWrapper);
    fragment.appendChild(card);
  });
  selectors.fusionGrid.replaceChildren(fragment);
}

function renderMissionScripts() {
  if (!selectors.scriptList) return;
  const fragment = document.createDocumentFragment();
  state.data.mission_scripts.forEach((script) => {
    const card = document.createElement('article');
    card.className = 'script-card';
    card.innerHTML = `
      <header>
        <span class="badge">${script.linked_pattern}</span>
        <h3>${script.name}</h3>
        <p>${script.context}</p>
      </header>
    `;
    const steps = document.createElement('ol');
    script.steps.forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      steps.appendChild(li);
    });
    card.appendChild(steps);
    fragment.appendChild(card);
  });
  selectors.scriptList.replaceChildren(fragment);
}

function renderRoadmap() {
  const fragment = document.createDocumentFragment();
  state.data.roadmap_phases.forEach((phase, idx) => {
    const completion = phase.percent;
    const card = document.createElement('article');
    card.className = 'roadmap-card';
    card.innerHTML = `
      <div class="badge">Phase ${phase.phase}</div>
      <h3>${phase.title}</h3>
      <p>Milestones:</p>
      <ul>${phase.milestones.map((milestone) => `<li>${milestone}</li>`).join('')}</ul>
      <p>Deliverables:</p>
      <ul>${phase.deliverables.map((item) => `<li>${item}</li>`).join('')}</ul>
      <div class="progress-meter"><span style="width:${completion}%"></span></div>
      <small>${completion}% of the macro roadmap complete.</small>
    `;
    fragment.appendChild(card);
  });
  selectors.roadmapTimeline.replaceChildren(fragment);
}

function renderRisks() {
  const fragment = document.createDocumentFragment();
  state.data.risks.forEach((risk, idx) => {
    const item = document.createElement('li');
    item.innerHTML = `
      <strong>Risk ${idx + 1}: ${risk.name}</strong>
      <span class="severity-badge" data-level="${risk.severity}">${risk.severity}</span>
      <p>${risk.threat}</p>
      <p><strong>Owner:</strong> ${risk.owner}</p>
      <p>Mitigations:</p>
      <ul>${risk.mitigation.map((line) => `<li>${line}</li>`).join('')}</ul>
    `;
    fragment.appendChild(item);
  });
  selectors.riskList.replaceChildren(fragment);
}

function renderStages() {
  const total = state.data.stages.length - 1;
  selectors.stageRange.max = total;
  selectors.stageRange.value = state.activeStageIndex;
  const updateStage = (nextIndex) => {
    state.activeStageIndex = nextIndex;
    const stage = state.data.stages[nextIndex];
    selectors.stageNumber.textContent = `Stage ${stage.stage} · ${stage.signal}`;
    selectors.stageDetail.textContent = stage.detail;
    const completion = stage.percent;
    selectors.stageProgressValue.textContent = `${completion}%`;
    selectors.stageProgressFill.style.width = `${completion}%`;
  };
  selectors.stageRange.addEventListener('input', (event) => {
    updateStage(Number(event.target.value));
  });
  updateStage(state.activeStageIndex);
}

function bindSearch() {
  const input = document.getElementById('moduleSearch');
  input.addEventListener('input', (event) => {
    state.filters.query = event.target.value;
    applyModuleFilters();
  });
}

function bindInsights() {
  const button = document.getElementById('insightButton');
  const insightPhrases = [
    () => `Stage ${state.data.stages[state.activeStageIndex].stage} stays synchronized with ${state.modules.length} forge-ready modules.`,
    () => {
      const pattern = state.data.forge_patterns[Math.floor(Math.random() * state.data.forge_patterns.length)];
      return `${pattern.name} touches ${pattern.components.length} components for a ${pattern.value.toLowerCase()}`;
    },
    () => `Roadmap velocity: ${state.data.roadmap_phases[state.data.roadmap_phases.length - 1].percent}% completion target.`,
    () => `${state.data.architecture_pillars[0]} anchors both confidential workloads and swarm telemetry.`,
    () => {
      const asset = state.data.forge_assets[Math.floor(Math.random() * state.data.forge_assets.length)];
      return `${asset.name} from ${asset.origin} fuels ${asset.linked_modules.length} Hyperion modules.`;
    },
    () => {
      const metric = state.data.lab_metrics[Math.floor(Math.random() * state.data.lab_metrics.length)];
      return `Forge health pulse: ${metric.label} sits at ${metric.value}.`;
    },
  ];

  button.addEventListener('click', () => {
    const generator = insightPhrases[Math.floor(Math.random() * insightPhrases.length)];
    selectors.insightOutput.textContent = generator();
  });
}

function bindModuleDrawer() {
  const closeDrawer = () => {
    selectors.moduleDrawer.classList.remove('is-open');
    selectors.moduleDrawer.setAttribute('aria-hidden', 'true');
    state.activeModule = null;
  };

  selectors.moduleDrawerClose.addEventListener('click', closeDrawer);
  selectors.moduleDrawer.addEventListener('click', (event) => {
    if (event.target === selectors.moduleDrawer) {
      closeDrawer();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectors.moduleDrawer.classList.contains('is-open')) {
      closeDrawer();
    }
  });

  state.closeDrawer = closeDrawer;
}

function openModuleDrawer(module) {
  state.activeModule = module;
  selectors.moduleDrawerDomain.textContent = module.domain;
  selectors.moduleDrawerTitle.textContent = module.name;
  selectors.moduleDrawerSummary.textContent = module.purpose;
  selectors.moduleDrawerInterfaces.innerHTML = module.interfaces.map((item) => `<li>${item}</li>`).join('');
  selectors.moduleDrawerKpis.innerHTML = module.kpis.map((item) => `<li>${item}</li>`).join('');
  selectors.moduleDrawerMitigations.innerHTML = module.mitigations.map((item) => `<li>${item}</li>`).join('');
  selectors.moduleDrawerTags.textContent = `Tags: ${module.tags.join(', ')}`;
  if (selectors.moduleDrawerSources) {
    selectors.moduleDrawerSources.innerHTML = module.sources
      ? module.sources.map((item) => `<li>${item}</li>`).join('')
      : '<li>No linked files</li>';
  }
  selectors.moduleDrawer.classList.add('is-open');
  selectors.moduleDrawer.setAttribute('aria-hidden', 'false');
}

function renderLabMetrics() {
  if (!selectors.labMetrics) return;
  const fragment = document.createDocumentFragment();
  state.data.lab_metrics.forEach((metric) => {
    const card = document.createElement('article');
    card.className = 'metric-card';
    card.innerHTML = `
      <p class="eyebrow">${metric.label}</p>
      <h3>${metric.value}</h3>
      <p>${metric.detail}</p>
      ${metric.trend ? `<span class="metric-trend">${metric.trend}</span>` : ''}
    `;
    fragment.appendChild(card);
  });
  selectors.labMetrics.replaceChildren(fragment);
}

function renderMatrix() {
  if (!selectors.matrixTable) return;
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Module</th>
        <th scope="col">Blueprints</th>
      </tr>
    </thead>
  `;
  const body = document.createElement('tbody');
  state.data.modules.forEach((module) => {
    const linkedPatterns = state.data.forge_patterns.filter((pattern) => pattern.components.includes(module.name));
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${module.name}</td>
      <td>${linkedPatterns.length ? linkedPatterns.map((pattern) => `<span class="matrix-chip">${pattern.name}</span>`).join('') : '<span class="matrix-chip matrix-chip--empty">No direct blueprint</span>'}</td>
    `;
    body.appendChild(row);
  });
  table.appendChild(body);
  selectors.matrixTable.replaceChildren(table);
}

bootstrap();
