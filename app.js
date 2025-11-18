const state = {
  auth: {
    user: null,
    accessToken: null,
    refreshToken: null,
  },
  filters: {
    query: '',
    domain: '',
    status: '',
  },
  modules: [],
  stages: [],
  architecture: { nodes: [], edges: [] },
  security: { risks: [], controls: [], summary: null },
  ws: null,
};

const selectors = {
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  authStatus: document.getElementById('authStatus'),
  logoutButton: document.getElementById('logoutButton'),
  currentUser: document.getElementById('currentUser'),
  statModules: document.querySelector('[data-stat-modules]'),
  statStages: document.querySelector('[data-stat-stages]'),
  statRisks: document.querySelector('[data-stat-risks]'),
  statNodes: document.querySelector('[data-stat-nodes]'),
  modulesList: document.getElementById('modulesList'),
  moduleTemplate: document.getElementById('moduleTemplate'),
  moduleForm: document.getElementById('moduleForm'),
  clearModuleForm: document.getElementById('clearModuleForm'),
  moduleSearch: document.getElementById('moduleSearch'),
  moduleDomainFilter: document.getElementById('moduleDomainFilter'),
  moduleStatusFilter: document.getElementById('moduleStatusFilter'),
  reloadModules: document.getElementById('reloadModules'),
  dashboardRefresh: document.getElementById('refreshDashboard'),
  taskForm: document.getElementById('taskForm'),
  taskStageSelect: document.getElementById('taskStageSelect'),
  roadmapStages: document.getElementById('roadmapStages'),
  nodeList: document.getElementById('nodeList'),
  nodeForm: document.getElementById('nodeForm'),
  riskList: document.getElementById('riskList'),
  controlList: document.getElementById('controlList'),
  riskForm: document.getElementById('riskForm'),
  riskTotal: document.querySelector('[data-risk-total]'),
  riskHigh: document.querySelector('[data-risk-high]'),
  riskOpen: document.querySelector('[data-risk-open]'),
  riskTop: document.querySelector('[data-risk-top]'),
  refreshSecurity: document.getElementById('refreshSecurity'),
  simulationLog: document.getElementById('simulationLog'),
  startSimulation: document.getElementById('startSimulation'),
  authForms: document.querySelectorAll('form'),
};

function saveAuth() {
  localStorage.setItem('hyperion-auth', JSON.stringify(state.auth));
}

function loadAuth() {
  const raw = localStorage.getItem('hyperion-auth');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.auth = parsed;
  } catch (error) {
    console.warn('Unable to parse auth cache');
  }
}

function clearAuth() {
  state.auth = { user: null, accessToken: null, refreshToken: null };
  localStorage.removeItem('hyperion-auth');
  updateAuthUI();
}

function updateAuthUI() {
  if (state.auth.user) {
    selectors.currentUser.textContent = `${state.auth.user.email} (${state.auth.user.role})`;
    selectors.logoutButton.disabled = false;
    selectors.authStatus.textContent = `Authenticated as ${state.auth.user.role}`;
    document.body.classList.add('is-authenticated');
  } else {
    selectors.currentUser.textContent = 'Not authenticated';
    selectors.logoutButton.disabled = true;
    selectors.authStatus.textContent = 'Not authenticated.';
    document.body.classList.remove('is-authenticated');
  }
  lockRoleBasedForms();
}

function lockRoleBasedForms() {
  document.querySelectorAll('[data-requires-role]').forEach((element) => {
    const allowed = element.dataset.requiresRole.split(',').map((role) => role.trim());
    const enabled = state.auth.user && allowed.includes(state.auth.user.role);
    element.dataset.disabled = enabled ? 'false' : 'true';
    element.querySelectorAll('input,select,textarea,button').forEach((node) => {
      node.disabled = !enabled;
    });
  });
  if (selectors.startSimulation) {
    const allowed = selectors.startSimulation.dataset.requiresRole?.split(',').map((role) => role.trim()) || [];
    const enabled = state.auth.user && allowed.includes(state.auth.user.role);
    selectors.startSimulation.disabled = !enabled;
  }
}

async function apiFetch(path, options = {}, retry = true) {
  const headers = options.headers ? { ...options.headers } : {};
  if (!(options.body instanceof FormData) && options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (state.auth.accessToken) {
    headers.Authorization = `Bearer ${state.auth.accessToken}`;
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && retry && state.auth.refreshToken) {
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.auth.refreshToken }),
    });
    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      state.auth.accessToken = data.accessToken;
      saveAuth();
      return apiFetch(path, options, false);
    }
    clearAuth();
    throw new Error('Session expired. Log in again.');
  }
  if (!response.ok) {
    let message = 'Request failed';
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch (error) {
      // ignore
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function wireAuth() {
  selectors.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const payload = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      }, false);
      state.auth = {
        user: payload.user,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      };
      saveAuth();
      updateAuthUI();
      connectWebSocket();
      await loadAllData();
    } catch (error) {
      selectors.authStatus.textContent = error.message;
    }
  });

  selectors.registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      }, false);
      selectors.authStatus.textContent = 'Viewer registered. Proceed to log in.';
      event.currentTarget.reset();
    } catch (error) {
      selectors.authStatus.textContent = error.message;
    }
  });

  selectors.logoutButton?.addEventListener('click', async () => {
    if (!state.auth.refreshToken) return clearAuth();
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: state.auth.refreshToken }),
    }, false).catch(() => {});
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    clearAuth();
    selectors.simulationLog.textContent = 'Logged out. Authenticate to stream events.';
  });
}

async function loadDashboard() {
  if (!state.auth.user) return;
  try {
    const stats = await apiFetch('/api/dashboard');
    selectors.statModules.textContent = stats.modules;
    selectors.statStages.textContent = stats.stages;
    selectors.statRisks.textContent = stats.risks;
    selectors.statNodes.textContent = stats.nodes;
  } catch (error) {
    selectors.statModules.textContent = '—';
    console.error(error);
  }
}

async function loadModules() {
  if (!state.auth.user) return;
  const params = new URLSearchParams();
  if (state.filters.query) params.append('query', state.filters.query);
  if (state.filters.domain) params.append('domain', state.filters.domain);
  if (state.filters.status) params.append('status', state.filters.status);
  const queryString = params.toString() ? `?${params.toString()}` : '';
  try {
    state.modules = await apiFetch(`/api/modules${queryString}`);
    renderModules();
  } catch (error) {
    selectors.modulesList.textContent = error.message;
  }
}

function renderModules() {
  selectors.modulesList.replaceChildren();
  const fragment = document.createDocumentFragment();
  const domains = new Set();
  state.modules.forEach((module) => domains.add(module.domain));
  state.modules.forEach((module) => {
    const node = selectors.moduleTemplate.content.cloneNode(true);
    node.querySelector('[data-module-name]').textContent = module.name;
    node.querySelector('[data-module-domain]').textContent = module.domain;
    node.querySelector('[data-module-status]').textContent = `Status: ${module.status}`;
    node.querySelector('[data-module-purpose]').textContent = module.purpose;
    node.querySelector('[data-module-security]').textContent = module.security_notes || '—';
    const tagContainer = node.querySelector('[data-module-tags]');
    tagContainer.replaceChildren();
    (module.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.textContent = tag;
      tagContainer.appendChild(span);
    });
    const kpiList = node.querySelector('[data-module-kpis]');
    kpiList.replaceChildren();
    (module.kpis || []).forEach((kpi) => {
      const li = document.createElement('li');
      li.textContent = kpi;
      kpiList.appendChild(li);
    });
    const interfaceList = node.querySelector('[data-module-interfaces]');
    interfaceList.replaceChildren();
    (module.interfaces || []).forEach((iface) => {
      const li = document.createElement('li');
      li.textContent = `${iface.name}: ${iface.description}`;
      interfaceList.appendChild(li);
    });
    node.querySelector('[data-edit-module]').addEventListener('click', () => populateModuleForm(module));
    fragment.appendChild(node);
  });
  if (!fragment.children.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No modules match your filter. Adjust the search criteria.';
    selectors.modulesList.appendChild(empty);
  } else {
    selectors.modulesList.appendChild(fragment);
  }
  rebuildDomainFilter(domains);
}

function rebuildDomainFilter(domains) {
  const current = selectors.moduleDomainFilter.value;
  selectors.moduleDomainFilter.replaceChildren(new Option('All domains', ''));
  Array.from(domains)
    .sort()
    .forEach((domain) => {
      const option = new Option(domain, domain);
      selectors.moduleDomainFilter.appendChild(option);
    });
  if ([...selectors.moduleDomainFilter.options].some((opt) => opt.value === current)) {
    selectors.moduleDomainFilter.value = current;
  }
}

function populateModuleForm(module) {
  if (!state.auth.user || !['ADMIN', 'OPS'].includes(state.auth.user.role)) return;
  const form = selectors.moduleForm;
  form.elements.id.value = module.id;
  form.elements.name.value = module.name;
  form.elements.domain.value = module.domain;
  form.elements.status.value = module.status;
  form.elements.purpose.value = module.purpose;
  form.elements.security_notes.value = module.security_notes || '';
  form.elements.tags.value = (module.tags || []).join(', ');
  form.elements.kpis.value = (module.kpis || []).join(', ');
  form.elements.interfaces.value = (module.interfaces || [])
    .map((iface) => `${iface.name}|${iface.description}`)
    .join('\n');
}

function parseCommaList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInterfaces(value) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, description] = line.split('|').map((token) => token.trim());
      return { name, description: description || '' };
    });
}

function wireModules() {
  const debouncedLoadModules = debounce(loadModules, 250);
  selectors.moduleForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get('name'),
      domain: formData.get('domain'),
      status: formData.get('status'),
      purpose: formData.get('purpose'),
      security_notes: formData.get('security_notes'),
      tags: parseCommaList(formData.get('tags') || ''),
      kpis: parseCommaList(formData.get('kpis') || ''),
      interfaces: parseInterfaces(formData.get('interfaces') || ''),
    };
    const id = formData.get('id');
    try {
      if (id) {
        await apiFetch(`/api/modules/${id}`, { method: 'PUT', body: JSON.stringify({ ...payload }) });
      } else {
        await apiFetch('/api/modules', { method: 'POST', body: JSON.stringify(payload) });
      }
      event.currentTarget.reset();
      await Promise.all([loadModules(), loadDashboard()]);
    } catch (error) {
      alert(error.message);
    }
  });

  selectors.clearModuleForm?.addEventListener('click', () => selectors.moduleForm.reset());

  selectors.moduleSearch?.addEventListener('input', (event) => {
    state.filters.query = event.target.value;
    debouncedLoadModules();
  });
  selectors.moduleDomainFilter?.addEventListener('change', (event) => {
    state.filters.domain = event.target.value;
    loadModules();
  });
  selectors.moduleStatusFilter?.addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    loadModules();
  });
  selectors.reloadModules?.addEventListener('click', loadModules);
}

function renderRoadmap() {
  selectors.roadmapStages.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.stages.forEach((stage) => {
    const card = document.createElement('article');
    card.className = 'stage-card';
    card.innerHTML = `
      <header>
        <div>
          <p class="eyebrow">Stage</p>
          <h3>${stage.name}</h3>
        </div>
        <span>${stage.progress || 0}%</span>
      </header>
      <p>${stage.description || 'No description provided.'}</p>
      <div class="progress-bar"><span style="width:${stage.progress || 0}%"></span></div>
    `;
    const list = document.createElement('ul');
    list.className = 'task-list';
    stage.tasks.forEach((task) => {
      const item = document.createElement('li');
      item.className = 'task-item';
      item.innerHTML = `
        <span>${task.title} — <small>${task.owner || 'Unassigned'}</small></span>
      `;
      const select = document.createElement('select');
      ['todo', 'in-progress', 'done'].forEach((status) => {
        const option = new Option(status.replace('-', ' '), status);
        option.selected = status === task.status;
        select.appendChild(option);
      });
      select.disabled = !state.auth.user || !['ADMIN', 'OPS'].includes(state.auth.user.role);
      select.addEventListener('change', () => updateTaskStatus(task.id, select.value));
      item.appendChild(select);
      list.appendChild(item);
    });
    card.appendChild(list);
    if (stage.milestones?.length) {
      const milestones = document.createElement('p');
      milestones.textContent = `Milestones: ${stage.milestones.map((m) => `${m.name} (${m.target_date || 'TBD'})`).join(', ')}`;
      card.appendChild(milestones);
    }
    fragment.appendChild(card);
  });
  selectors.roadmapStages.appendChild(fragment);
  rebuildStageSelect();
}

async function updateTaskStatus(id, status) {
  try {
    const task = state.stages.flatMap((stage) => stage.tasks).find((task) => task.id === id);
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: task.title, owner: task.owner, status }),
    });
    await loadRoadmap();
  } catch (error) {
    alert(error.message);
  }
}

function rebuildStageSelect() {
  selectors.taskStageSelect.replaceChildren();
  state.stages.forEach((stage) => {
    const option = new Option(stage.name, stage.id);
    selectors.taskStageSelect.appendChild(option);
  });
}

function wireRoadmap() {
  selectors.taskForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      event.currentTarget.reset();
      await loadRoadmap();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function loadRoadmap() {
  if (!state.auth.user) return;
  try {
    state.stages = await apiFetch('/api/roadmap');
    renderRoadmap();
  } catch (error) {
    selectors.roadmapStages.textContent = error.message;
  }
}

function renderArchitecture() {
  selectors.nodeList.replaceChildren();
  state.architecture.nodes.forEach((node) => {
    const card = document.createElement('article');
    card.className = 'node-card';
    card.innerHTML = `
      <h3>${node.name}</h3>
      <p>${node.type}</p>
      <span>Status: ${node.status}</span>
      <p>Owner: ${(node.metadata?.owner) || 'Unassigned'}</p>
    `;
    selectors.nodeList.appendChild(card);
  });
}

function wireArchitecture() {
  selectors.nodeForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get('name'),
      type: formData.get('type'),
      status: formData.get('status'),
      metadata: { owner: formData.get('owner') },
    };
    try {
      await apiFetch('/api/architecture/nodes', { method: 'POST', body: JSON.stringify(payload) });
      event.currentTarget.reset();
      await Promise.all([loadArchitecture(), loadDashboard()]);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function loadArchitecture() {
  if (!state.auth.user) return;
  try {
    state.architecture = await apiFetch('/api/architecture');
    renderArchitecture();
  } catch (error) {
    selectors.nodeList.textContent = error.message;
  }
}

function renderSecurity() {
  selectors.riskList.replaceChildren();
  state.security.risks.forEach((risk) => {
    const li = document.createElement('li');
    li.textContent = `${risk.title} — ${risk.severity.toUpperCase()} — ${risk.status}`;
    selectors.riskList.appendChild(li);
  });
  selectors.controlList.replaceChildren();
  state.security.controls.forEach((control) => {
    const li = document.createElement('li');
    li.textContent = `${control.framework} ${control.control_id} · ${control.status}`;
    selectors.controlList.appendChild(li);
  });
  if (state.security.summary) {
    selectors.riskTotal.textContent = state.security.summary.totalRisks;
    selectors.riskHigh.textContent = state.security.summary.highSeverity;
    selectors.riskOpen.textContent = state.security.summary.openRisks;
    selectors.riskTop.textContent = state.security.summary.topRisk?.title || '—';
  }
}

function wireSecurity() {
  selectors.riskForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    try {
      await apiFetch('/api/security/risks', { method: 'POST', body: JSON.stringify(payload) });
      event.currentTarget.reset();
      await Promise.all([loadSecurity(), loadDashboard()]);
    } catch (error) {
      alert(error.message);
    }
  });
  selectors.refreshSecurity?.addEventListener('click', loadSecurity);
}

async function loadSecurity() {
  if (!state.auth.user) return;
  try {
    const [risks, controls, summary] = await Promise.all([
      apiFetch('/api/security/risks'),
      apiFetch('/api/security/controls'),
      apiFetch('/api/security/summary'),
    ]);
    state.security = { risks, controls, summary };
    renderSecurity();
  } catch (error) {
    selectors.riskList.textContent = error.message;
  }
}

function wireSimulation() {
  selectors.startSimulation?.addEventListener('click', async () => {
    try {
      const simulation = await apiFetch('/api/simulations', { method: 'POST', body: JSON.stringify({}) });
      selectors.simulationLog.textContent = `Simulation #${simulation.id} started...\n`;
    } catch (error) {
      alert(error.message);
    }
  });
}

function connectWebSocket() {
  if (state.ws) return;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${window.location.host}/ws/simulations`);
  state.ws.addEventListener('message', (event) => {
    const { payload } = JSON.parse(event.data);
    const line = `[${payload.timestamp}] (${payload.severity}) ${payload.message}`;
    selectors.simulationLog.textContent += `\n${line}`;
    selectors.simulationLog.scrollTop = selectors.simulationLog.scrollHeight;
  });
  state.ws.addEventListener('close', () => {
    state.ws = null;
  });
}

function debounce(fn, delay = 250) {
  let timeout;
  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

async function loadAllData() {
  await Promise.all([loadDashboard(), loadModules(), loadRoadmap(), loadArchitecture(), loadSecurity()]);
}

function wireNavigation() {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach((link) => link.classList.remove('active'));
      button.classList.add('active');
      const target = document.getElementById(button.dataset.target);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function bootstrap() {
  loadAuth();
  updateAuthUI();
  wireAuth();
  wireNavigation();
  wireModules();
  wireRoadmap();
  wireArchitecture();
  wireSecurity();
  wireSimulation();
  selectors.dashboardRefresh?.addEventListener('click', loadDashboard);
  if (state.auth.user) {
    connectWebSocket();
    loadAllData();
  }
}

bootstrap();
