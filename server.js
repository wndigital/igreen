const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());

// ============================================================
// BANCO DE DADOS (SQLite — arquivo local no Railway)
// ============================================================
const db = new Database(path.join(__dirname, 'igreen.db'));

// Criar tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS agendamentos (
    id TEXT PRIMARY KEY,
    nome TEXT, sobrenome TEXT, wa TEXT,
    rua TEXT, num TEXT, bairro TEXT, cidade TEXT, estado TEXT,
    conta TEXT, conta_nome TEXT, titular_presente TEXT,
    bolsa_familia TEXT, energia_solar TEXT,
    data TEXT, hora TEXT, campanha TEXT, equipe TEXT,
    status TEXT DEFAULT 'Aguardando',
    rota_status TEXT DEFAULT 'aguardando-visita',
    criado_em TEXT
  );

  CREATE TABLE IF NOT EXISTS campanhas (
    id TEXT PRIMARY KEY,
    nome TEXT, data TEXT, equipe TEXT,
    slots TEXT DEFAULT '{}',
    criado_em TEXT
  );

  CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campanha TEXT, hora TEXT,
    disponivel INTEGER DEFAULT 1,
    bloqueado_em TEXT
  );
`);

// ============================================================
// HELPERS
// ============================================================
const sn = v => v === true || v === 'true' || v === 'Sim' ? 'Sim' : (v === false || v === 'false' || v === 'Nao' ? 'Nao' : '-');
const ok = (data) => ({ ok: true, ...data });
const fail = (msg) => ({ ok: false, msg });

// ============================================================
// AGENDAMENTOS
// ============================================================

// GET todos os agendamentos
app.get('/agendamentos', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM agendamentos ORDER BY data ASC, hora ASC').all();
    res.json(ok({ data: rows }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// POST salvar agendamento
app.post('/agendamentos', (req, res) => {
  try {
    const d = req.body;
    const id = d.id || String(Date.now());
    db.prepare(`
      INSERT OR REPLACE INTO agendamentos
      (id, nome, sobrenome, wa, rua, num, bairro, cidade, estado,
       conta, conta_nome, titular_presente, bolsa_familia, energia_solar,
       data, hora, campanha, equipe, status, rota_status, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Aguardando','aguardando-visita',?)
    `).run(
      id, d.nome||'', d.sobrenome||'', d.wa||'',
      d.rua||'', d.num||'', d.bairro||'', d.cidade||'', d.estado||'',
      d.conta||'', sn(d.contaNome), sn(d.titularPresente),
      sn(d.bolsaFamilia), sn(d.energiaSolar),
      d.data||'', d.hora||'', d.campanha||'', d.equipe||'',
      new Date().toLocaleString('pt-BR')
    );
    res.json(ok({ id }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// PATCH atualizar status
app.patch('/agendamentos/:id/status', (req, res) => {
  try {
    const { campo, valor } = req.body;
    const col = campo === 'rotaStatus' ? 'rota_status' : 'status';
    db.prepare(`UPDATE agendamentos SET ${col} = ? WHERE id = ?`).run(valor, req.params.id);
    res.json(ok({}));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// DELETE excluir agendamento
app.delete('/agendamentos/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM agendamentos WHERE id = ?').run(req.params.id);
    res.json(ok({}));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// DELETE em lote por período
app.delete('/agendamentos', (req, res) => {
  try {
    const { de, ate } = req.query;
    let sql = 'DELETE FROM agendamentos WHERE 1=1';
    const params = [];
    if (de)  { sql += ' AND data >= ?'; params.push(de); }
    if (ate) { sql += ' AND data <= ?'; params.push(ate); }
    const result = db.prepare(sql).run(...params);
    res.json(ok({ deletados: result.changes }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// ============================================================
// CAMPANHAS
// ============================================================

app.get('/campanhas', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM campanhas ORDER BY data ASC').all();
    res.json(ok({ data: rows }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

app.post('/campanhas', (req, res) => {
  try {
    const d = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO campanhas (id, nome, data, equipe, slots, criado_em)
      VALUES (?,?,?,?,?,?)
    `).run(
      d.id, d.nome||'', d.data||'', d.equipe||'',
      typeof d.slots === 'object' ? JSON.stringify(d.slots) : (d.slots || '{}'),
      new Date().toLocaleString('pt-BR')
    );
    res.json(ok({ id: d.id }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

app.delete('/campanhas/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM campanhas WHERE id = ?').run(req.params.id);
    res.json(ok({}));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// ============================================================
// HORÁRIOS / SLOTS
// ============================================================

app.get('/slots', (req, res) => {
  try {
    const { campanha } = req.query;
    const rows = db.prepare('SELECT hora, disponivel FROM horarios WHERE campanha = ?').all(campanha || '');
    const data = {};
    rows.forEach(r => { data[r.hora] = r.disponivel === 1; });
    res.json(ok({ data }));
  } catch(e) {
    res.json(fail(e.message));
  }
});

app.post('/slots/bloquear', (req, res) => {
  try {
    const { campanha, hora } = req.body;
    const existing = db.prepare('SELECT id FROM horarios WHERE campanha = ? AND hora = ?').get(campanha, hora);
    if (existing) {
      db.prepare('UPDATE horarios SET disponivel = 0, bloqueado_em = ? WHERE campanha = ? AND hora = ?')
        .run(new Date().toLocaleString('pt-BR'), campanha, hora);
    } else {
      db.prepare('INSERT INTO horarios (campanha, hora, disponivel, bloqueado_em) VALUES (?,?,0,?)')
        .run(campanha, hora, new Date().toLocaleString('pt-BR'));
    }
    res.json(ok({}));
  } catch(e) {
    res.json(fail(e.message));
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'iGreen API rodando!', version: '2.0' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`iGreen API rodando na porta ${PORT}`);
});
