const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { WebSocketServer } = require('ws');
const { initializeDatabase, run, get, all } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'hyperion-access-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'hyperion-refresh-secret';
const TOKEN_EXPIRATION = '20m';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/simulations' });
const wsClients = new Set();

wss.on('connection', (socket) => {
  wsClients.add(socket);
  socket.on('close', () => wsClients.delete(socket));
});

function broadcastSimulationEvent(payload) {
  const serialized = JSON.stringify({ type: 'simulation-event', payload });
  wsClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(serialized);
    }
  });
}

function generateAccessToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}

function generateRefreshToken(user) {
  return jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

async function persistRefreshToken(userId, token) {
  await run('INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)', [userId, token]);
}

async function deleteRefreshToken(token) {
  await run('DELETE FROM refresh_tokens WHERE token = ?', [token]);
}

async function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'Missing authorization header' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token missing' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  try {
    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ message: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const { id } = await run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', [email, hash, 'VIEWER']);
    res.status(201).json({ id, email, role: 'VIEWER' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  try {
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    await persistRefreshToken(user.id, refreshToken);
    res.json({
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token required' });
  try {
    const stored = await get('SELECT * FROM refresh_tokens WHERE token = ?', [refreshToken]);
    if (!stored) return res.status(401).json({ message: 'Invalid token' });
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = await get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ message: 'User not found' });
    const accessToken = generateAccessToken(user);
    res.json({ accessToken });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await deleteRefreshToken(refreshToken);
  }
  res.json({ success: true });
});

// Dashboard aggregate endpoint
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const [moduleCount, stageCount, riskCount, nodeCount] = await Promise.all([
      get('SELECT COUNT(*) as total FROM modules'),
      get('SELECT COUNT(*) as total FROM stages'),
      get('SELECT COUNT(*) as total FROM risks'),
      get('SELECT COUNT(*) as total FROM nodes'),
    ]);
    res.json({
      modules: moduleCount.total,
      stages: stageCount.total,
      risks: riskCount.total,
      nodes: nodeCount.total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Module endpoints
app.get('/api/modules', authenticateToken, async (req, res) => {
  const { domain, status, query } = req.query;
  let sql = 'SELECT * FROM modules';
  const clauses = [];
  const params = [];
  if (domain) {
    clauses.push('domain = ?');
    params.push(domain);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (query) {
    clauses.push('(name LIKE ? OR purpose LIKE ? OR security_notes LIKE ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (clauses.length) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  try {
    const modules = await all(sql, params);
    for (const mod of modules) {
      const interfaces = await all('SELECT id, name, description FROM module_interfaces WHERE module_id = ?', [mod.id]);
      mod.tags = mod.tags ? JSON.parse(mod.tags) : [];
      mod.kpis = mod.kpis ? JSON.parse(mod.kpis) : [];
      mod.interfaces = interfaces;
    }
    res.json(modules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/modules', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name, domain, status, purpose, security_notes, tags = [], kpis = [], interfaces = [] } = req.body;
  if (!name || !domain || !status || !purpose) {
    return res.status(400).json({ message: 'Missing required module fields' });
  }
  try {
    const { id } = await run(
      'INSERT INTO modules (name, domain, status, purpose, security_notes, tags, kpis) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, domain, status, purpose, security_notes || '', JSON.stringify(tags), JSON.stringify(kpis)]
    );
    for (const iface of interfaces) {
      await run('INSERT INTO module_interfaces (module_id, name, description) VALUES (?, ?, ?)', [id, iface.name, iface.description || '']);
    }
    const module = await get('SELECT * FROM modules WHERE id = ?', [id]);
    module.tags = module.tags ? JSON.parse(module.tags) : [];
    module.kpis = module.kpis ? JSON.parse(module.kpis) : [];
    module.interfaces = await all('SELECT id, name, description FROM module_interfaces WHERE module_id = ?', [id]);
    res.status(201).json(module);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/modules/:id', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name, domain, status, purpose, security_notes, tags = [], kpis = [], interfaces = [] } = req.body;
  const { id } = req.params;
  try {
    await run(
      'UPDATE modules SET name = ?, domain = ?, status = ?, purpose = ?, security_notes = ?, tags = ?, kpis = ? WHERE id = ?',
      [name, domain, status, purpose, security_notes || '', JSON.stringify(tags), JSON.stringify(kpis), id]
    );
    await run('DELETE FROM module_interfaces WHERE module_id = ?', [id]);
    for (const iface of interfaces) {
      await run('INSERT INTO module_interfaces (module_id, name, description) VALUES (?, ?, ?)', [id, iface.name, iface.description || '']);
    }
    const module = await get('SELECT * FROM modules WHERE id = ?', [id]);
    module.tags = module.tags ? JSON.parse(module.tags) : [];
    module.kpis = module.kpis ? JSON.parse(module.kpis) : [];
    module.interfaces = await all('SELECT id, name, description FROM module_interfaces WHERE module_id = ?', [id]);
    res.json(module);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/modules/:id', authenticateToken, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    await run('DELETE FROM modules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Roadmap endpoints
app.get('/api/roadmap', authenticateToken, async (req, res) => {
  try {
    const stages = await all('SELECT * FROM stages');
    for (const stage of stages) {
      stage.tasks = await all('SELECT * FROM tasks WHERE stage_id = ?', [stage.id]);
      stage.milestones = await all('SELECT * FROM milestones WHERE stage_id = ?', [stage.id]);
    }
    res.json(stages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/tasks', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { stage_id, title, status = 'todo', owner = '' } = req.body;
  if (!stage_id || !title) return res.status(400).json({ message: 'Stage and title are required' });
  try {
    const { id } = await run('INSERT INTO tasks (stage_id, title, status, owner) VALUES (?, ?, ?, ?)', [stage_id, title, status, owner]);
    const task = await get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/tasks/:id', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { title, status, owner } = req.body;
  try {
    await run('UPDATE tasks SET title = ?, status = ?, owner = ? WHERE id = ?', [title, status, owner, req.params.id]);
    const task = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/milestones', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { stage_id, name, target_date } = req.body;
  if (!stage_id || !name) return res.status(400).json({ message: 'Stage and name required' });
  try {
    const { id } = await run('INSERT INTO milestones (stage_id, name, target_date) VALUES (?, ?, ?)', [stage_id, name, target_date || null]);
    const milestone = await get('SELECT * FROM milestones WHERE id = ?', [id]);
    res.status(201).json(milestone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/stages/:id', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name, description, progress } = req.body;
  try {
    await run('UPDATE stages SET name = ?, description = ?, progress = ? WHERE id = ?', [name, description, progress, req.params.id]);
    const stage = await get('SELECT * FROM stages WHERE id = ?', [req.params.id]);
    res.json(stage);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Architecture endpoints
app.get('/api/architecture', authenticateToken, async (req, res) => {
  try {
    const nodes = await all('SELECT * FROM nodes');
    const edges = await all('SELECT * FROM edges');
    nodes.forEach((node) => {
      node.metadata = node.metadata ? JSON.parse(node.metadata) : {};
    });
    res.json({ nodes, edges });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/architecture/nodes', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name, type, status, metadata = {} } = req.body;
  if (!name || !type || !status) return res.status(400).json({ message: 'Missing node fields' });
  try {
    const { id } = await run('INSERT INTO nodes (name, type, status, metadata) VALUES (?, ?, ?, ?)', [name, type, status, JSON.stringify(metadata)]);
    const node = await get('SELECT * FROM nodes WHERE id = ?', [id]);
    node.metadata = node.metadata ? JSON.parse(node.metadata) : {};
    res.status(201).json(node);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/architecture/nodes/:id', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name, type, status, metadata = {} } = req.body;
  try {
    await run('UPDATE nodes SET name = ?, type = ?, status = ?, metadata = ? WHERE id = ?', [name, type, status, JSON.stringify(metadata), req.params.id]);
    const node = await get('SELECT * FROM nodes WHERE id = ?', [req.params.id]);
    node.metadata = node.metadata ? JSON.parse(node.metadata) : {};
    res.json(node);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/architecture/edges', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { source_id, target_id, description } = req.body;
  if (!source_id || !target_id) return res.status(400).json({ message: 'Source and target required' });
  try {
    const { id } = await run('INSERT INTO edges (source_id, target_id, description) VALUES (?, ?, ?)', [source_id, target_id, description || '']);
    const edge = await get('SELECT * FROM edges WHERE id = ?', [id]);
    res.status(201).json(edge);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Security endpoints
app.get('/api/security/risks', authenticateToken, async (req, res) => {
  try {
    const risks = await all('SELECT * FROM risks');
    res.json(risks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/security/risks', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { title, severity, owner, status, mitigation } = req.body;
  if (!title || !severity) return res.status(400).json({ message: 'Title and severity required' });
  try {
    const { id } = await run('INSERT INTO risks (title, severity, owner, status, mitigation) VALUES (?, ?, ?, ?, ?)', [title, severity, owner || '', status || 'open', mitigation || '']);
    const risk = await get('SELECT * FROM risks WHERE id = ?', [id]);
    res.status(201).json(risk);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/security/risks/:id', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { title, severity, owner, status, mitigation } = req.body;
  try {
    await run('UPDATE risks SET title = ?, severity = ?, owner = ?, status = ?, mitigation = ? WHERE id = ?', [title, severity, owner, status, mitigation, req.params.id]);
    const risk = await get('SELECT * FROM risks WHERE id = ?', [req.params.id]);
    res.json(risk);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/security/controls', authenticateToken, async (req, res) => {
  try {
    const controls = await all('SELECT * FROM controls');
    res.json(controls);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/security/controls', authenticateToken, authorizeRoles('ADMIN'), async (req, res) => {
  const { framework, control_id, description, status } = req.body;
  if (!framework || !control_id) return res.status(400).json({ message: 'Framework and control id required' });
  try {
    const { id } = await run('INSERT INTO controls (framework, control_id, description, status) VALUES (?, ?, ?, ?)', [framework, control_id, description || '', status || 'planned']);
    const control = await get('SELECT * FROM controls WHERE id = ?', [id]);
    res.status(201).json(control);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/security/summary', authenticateToken, async (req, res) => {
  try {
    const totals = await get('SELECT COUNT(*) as total FROM risks');
    const high = await get("SELECT COUNT(*) as total FROM risks WHERE severity = 'high'");
    const open = await get("SELECT COUNT(*) as total FROM risks WHERE status = 'open'");
    const topRisk = await get('SELECT * FROM risks ORDER BY severity = "high" DESC, id DESC LIMIT 1');
    res.json({
      totalRisks: totals.total,
      highSeverity: high.total,
      openRisks: open.total,
      topRisk,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Simulation endpoints
app.get('/api/simulations/:id/events', authenticateToken, async (req, res) => {
  try {
    const events = await all('SELECT * FROM simulation_events WHERE simulation_id = ? ORDER BY timestamp ASC', [req.params.id]);
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function generateSimulationEvents(simulationId) {
  const steps = [
    'Initiating guardian sweep',
    'Telemetry mesh handshake',
    'Quantum forge sync',
    'Threat scenario playback',
    'Mission closeout',
  ];
  for (const [index, step] of steps.entries()) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const timestamp = new Date().toISOString();
    await run('INSERT INTO simulation_events (simulation_id, timestamp, message, severity) VALUES (?, ?, ?, ?)', [
      simulationId,
      timestamp,
      step,
      index === steps.length - 1 ? 'info' : 'warning',
    ]);
    broadcastSimulationEvent({ simulationId, timestamp, message: step, severity: index === steps.length - 1 ? 'info' : 'warning' });
  }
  await run('UPDATE simulations SET status = ? WHERE id = ?', ['completed', simulationId]);
}

app.post('/api/simulations', authenticateToken, authorizeRoles('ADMIN', 'OPS'), async (req, res) => {
  const { name = 'Mission rehearsal' } = req.body;
  try {
    const { id } = await run('INSERT INTO simulations (name, status) VALUES (?, ?)', [name, 'running']);
    res.status(201).json({ id, name, status: 'running' });
    generateSimulationEvents(id);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 4173;
initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Hyperion-Flux Mission-Control API listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
