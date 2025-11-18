const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(path.join(__dirname, 'hyperion.db'));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

async function seedUsers() {
  const count = await get('SELECT COUNT(*) as total FROM users');
  if (count.total > 0) return;
  const users = [
    { email: 'admin@hyperion.local', password: 'adminpass', role: 'ADMIN' },
    { email: 'ops@hyperion.local', password: 'opspass', role: 'OPS' },
    { email: 'viewer@hyperion.local', password: 'viewerpass', role: 'VIEWER' },
  ];
  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    await run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', [user.email, hash, user.role]);
  }
}

async function seedModules() {
  const count = await get('SELECT COUNT(*) as total FROM modules');
  if (count.total > 0) return;
  const modules = [
    {
      name: 'Nebula Sentinel',
      domain: 'Security',
      status: 'green',
      purpose: 'Detects anomalous mesh activity and isolates rogue nodes.',
      security_notes: 'Correlates lattice telemetry with zero-trust policies.',
      tags: ['detection', 'automation'],
      kpis: ['MTTD < 90s', 'Isolation < 60s'],
      interfaces: [
        { name: 'Guardian Sweep API', description: 'Ingests mission beacons for anomaly analysis.' },
        { name: 'Containment Hook', description: 'Quarantines compromised clusters automatically.' },
      ],
    },
    {
      name: 'Aurora Weaver',
      domain: 'Operations',
      status: 'amber',
      purpose: 'Coordinates deployment blueprints across environments.',
      security_notes: 'Locks manifests with PQ signatures.',
      tags: ['automation', 'deployment'],
      kpis: ['Drift < 2%', 'Rollout < 5m'],
      interfaces: [
        { name: 'Pipeline Orchestrator', description: 'Pushes configs to clusters.' },
      ],
    },
  ];
  for (const module of modules) {
    const { id } = await run(
      'INSERT INTO modules (name, domain, status, purpose, security_notes, tags, kpis) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        module.name,
        module.domain,
        module.status,
        module.purpose,
        module.security_notes,
        JSON.stringify(module.tags),
        JSON.stringify(module.kpis),
      ]
    );
    for (const iface of module.interfaces) {
      await run('INSERT INTO module_interfaces (module_id, name, description) VALUES (?, ?, ?)', [id, iface.name, iface.description]);
    }
  }
}

async function seedRoadmap() {
  const count = await get('SELECT COUNT(*) as total FROM stages');
  if (count.total > 0) return;
  const stages = [
    {
      name: 'Stage Alpha',
      description: 'Harden lattice ingestion path.',
      progress: 55,
      milestones: [
        { name: 'Telemetry Hardening', target_date: '2024-08-01' },
      ],
      tasks: [
        { title: 'Implement lattice guardrails', status: 'in-progress', owner: 'Ops' },
        { title: 'Ship telemetry fuzzing harness', status: 'todo', owner: 'Engineering' },
      ],
    },
    {
      name: 'Stage Beta',
      description: 'Automate mission service rollouts.',
      progress: 35,
      milestones: [
        { name: 'Ops-as-code foundation', target_date: '2024-09-15' },
      ],
      tasks: [
        { title: 'Model service dependencies', status: 'in-progress', owner: 'Ops' },
      ],
    },
  ];
  for (const stage of stages) {
    const { id } = await run('INSERT INTO stages (name, description, progress) VALUES (?, ?, ?)', [stage.name, stage.description, stage.progress]);
    for (const task of stage.tasks) {
      await run('INSERT INTO tasks (stage_id, title, status, owner) VALUES (?, ?, ?, ?)', [id, task.title, task.status, task.owner]);
    }
    for (const milestone of stage.milestones) {
      await run('INSERT INTO milestones (stage_id, name, target_date) VALUES (?, ?, ?)', [id, milestone.name, milestone.target_date]);
    }
  }
}

async function seedArchitecture() {
  const count = await get('SELECT COUNT(*) as total FROM nodes');
  if (count.total > 0) return;
  const nodes = [
    { name: 'Mission Ingress', type: 'gateway', status: 'healthy', metadata: { owner: 'Ops' } },
    { name: 'Telemetry Mesh', type: 'service', status: 'degraded', metadata: { owner: 'Security' } },
    { name: 'Forge Compute', type: 'service', status: 'healthy', metadata: { owner: 'Engineering' } },
  ];
  const edges = [
    { source: 1, target: 2, description: 'Streams events to mesh' },
    { source: 2, target: 3, description: 'Feeds enriched signals' },
  ];
  for (const node of nodes) {
    await run('INSERT INTO nodes (name, type, status, metadata) VALUES (?, ?, ?, ?)', [node.name, node.type, node.status, JSON.stringify(node.metadata)]);
  }
  for (const edge of edges) {
    await run('INSERT INTO edges (source_id, target_id, description) VALUES (?, ?, ?)', [edge.source, edge.target, edge.description]);
  }
}

async function seedSecurity() {
  const riskCount = await get('SELECT COUNT(*) as total FROM risks');
  if (riskCount.total === 0) {
    await run('INSERT INTO risks (title, severity, owner, status, mitigation) VALUES (?, ?, ?, ?, ?)', [
      'Mesh beacon tampering',
      'high',
      'Security',
      'open',
      'Attest all beacons with PQ signatures',
    ]);
    await run('INSERT INTO risks (title, severity, owner, status, mitigation) VALUES (?, ?, ?, ?, ?)', [
      'Ops drift during surge deploys',
      'medium',
      'Ops',
      'mitigated',
      'Rolling stage gates with automated policy checks',
    ]);
  }
  const controlCount = await get('SELECT COUNT(*) as total FROM controls');
  if (controlCount.total === 0) {
    await run('INSERT INTO controls (framework, control_id, description, status) VALUES (?, ?, ?, ?)', [
      'NIST 800-53',
      'SC-7',
      'Boundary protections around lattice services',
      'implemented',
    ]);
    await run('INSERT INTO controls (framework, control_id, description, status) VALUES (?, ?, ?, ?)', [
      'FedRAMP',
      'CM-3',
      'Configuration change control with PQ approvals',
      'in-progress',
    ]);
  }
}

async function initializeDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT NOT NULL,
    purpose TEXT NOT NULL,
    security_notes TEXT,
    tags TEXT,
    kpis TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS module_interfaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    progress INTEGER DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    owner TEXT,
    FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target_date TEXT,
    FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    description TEXT,
    FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS risks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    owner TEXT,
    status TEXT,
    mitigation TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS controls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    framework TEXT NOT NULL,
    control_id TEXT NOT NULL,
    description TEXT,
    status TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS simulation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL,
    FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
  )`);

  await seedUsers();
  await seedModules();
  await seedRoadmap();
  await seedArchitecture();
  await seedSecurity();
}

module.exports = {
  db,
  run,
  get,
  all,
  initializeDatabase,
};
