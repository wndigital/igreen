const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================================
// CONEXÃO POSTGRESQL
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:cXUMoxBKGFNQFMUKXdasRjGEXTtWsriT@postgres.railway.internal:5432/railway',
  ssl: false
});

// Criar tabelas automaticamente
async function initDB() {
  await pool.query(`
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
      id SERIAL PRIMARY KEY,
      campanha TEXT, hora TEXT,
      disponivel BOOLEAN DEFAULT TRUE,
      bloqueado_em TEXT
    );
  `);
  console.log('Banco PostgreSQL pronto!');
}

initDB().catch(console.error);

// ============================================================
// HELPERS
// ============================================================
const sn = v => v === true || v === 'true' || v === 'Sim' ? 'Sim' : (v === false || v === 'false' || v === 'Nao' ? 'Nao' : '-');
const now = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const ok   = data => ({ ok: true, ...data });
const fail = msg  => ({ ok: false, msg });

// ============================================================
// AGENDAMENTOS
// ============================================================
app.get('/agendamentos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM agendamentos ORDER BY data ASC, hora ASC');
    res.json(ok({ data: r.rows }));
  } catch(e) { res.json(fail(e.message)); }
});

app.post('/agendamentos', async (req, res) => {
  try {
    const d = req.body;
    const id = d.id || String(Date.now());
    await pool.query(`
      INSERT INTO agendamentos
        (id,nome,sobrenome,wa,rua,num,bairro,cidade,estado,conta,
         conta_nome,titular_presente,bolsa_familia,energia_solar,
         data,hora,campanha,equipe,status,rota_status,criado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Aguardando','aguardando-visita',$19)
      ON CONFLICT (id) DO UPDATE SET
        nome=EXCLUDED.nome, sobrenome=EXCLUDED.sobrenome, wa=EXCLUDED.wa,
        rua=EXCLUDED.rua, num=EXCLUDED.num, bairro=EXCLUDED.bairro,
        cidade=EXCLUDED.cidade, estado=EXCLUDED.estado, conta=EXCLUDED.conta,
        conta_nome=EXCLUDED.conta_nome, titular_presente=EXCLUDED.titular_presente,
        bolsa_familia=EXCLUDED.bolsa_familia, energia_solar=EXCLUDED.energia_solar,
        data=EXCLUDED.data, hora=EXCLUDED.hora, campanha=EXCLUDED.campanha, equipe=EXCLUDED.equipe
    `, [
      id, d.nome||'', d.sobrenome||'', d.wa||'',
      d.rua||'', d.num||'', d.bairro||'', d.cidade||'', d.estado||'',
      d.conta||'', sn(d.contaNome), sn(d.titularPresente),
      sn(d.bolsaFamilia), sn(d.energiaSolar),
      d.data||'', d.hora||'', d.campanha||'', d.equipe||'', now()
    ]);
    res.json(ok({ id }));
  } catch(e) { res.json(fail(e.message)); }
});

app.patch('/agendamentos/:id/status', async (req, res) => {
  try {
    const col = req.body.campo === 'rotaStatus' ? 'rota_status' : 'status';
    await pool.query(`UPDATE agendamentos SET ${col} = $1 WHERE id = $2`, [req.body.valor, req.params.id]);
    res.json(ok({}));
  } catch(e) { res.json(fail(e.message)); }
});

app.delete('/agendamentos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM agendamentos WHERE id = $1', [req.params.id]);
    res.json(ok({}));
  } catch(e) { res.json(fail(e.message)); }
});

app.delete('/agendamentos', async (req, res) => {
  try {
    const { de, ate } = req.query;
    let sql = 'DELETE FROM agendamentos WHERE 1=1';
    const params = [];
    if (de)  { params.push(de);  sql += ` AND data >= $${params.length}`; }
    if (ate) { params.push(ate); sql += ` AND data <= $${params.length}`; }
    const r = await pool.query(sql, params);
    res.json(ok({ deletados: r.rowCount }));
  } catch(e) { res.json(fail(e.message)); }
});

// ============================================================
// CAMPANHAS
// ============================================================
app.get('/campanhas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM campanhas ORDER BY data ASC');
    res.json(ok({ data: r.rows }));
  } catch(e) { res.json(fail(e.message)); }
});

app.post('/campanhas', async (req, res) => {
  try {
    const d = req.body;
    const slots = typeof d.slots === 'object' ? JSON.stringify(d.slots) : (d.slots || '{}');
    await pool.query(`
      INSERT INTO campanhas (id, nome, data, equipe, slots, criado_em)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        nome=EXCLUDED.nome, data=EXCLUDED.data,
        equipe=EXCLUDED.equipe, slots=EXCLUDED.slots
    `, [d.id, d.nome||'', d.data||'', d.equipe||'', slots, now()]);
    res.json(ok({ id: d.id }));
  } catch(e) { res.json(fail(e.message)); }
});

app.delete('/campanhas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM campanhas WHERE id = $1', [req.params.id]);
    res.json(ok({}));
  } catch(e) { res.json(fail(e.message)); }
});

// ============================================================
// SLOTS / HORÁRIOS
// ============================================================
app.get('/slots', async (req, res) => {
  try {
    const r = await pool.query('SELECT hora, disponivel FROM horarios WHERE campanha = $1', [req.query.campanha || '']);
    const data = {};
    r.rows.forEach(row => { data[row.hora] = row.disponivel; });
    res.json(ok({ data }));
  } catch(e) { res.json(fail(e.message)); }
});

app.post('/slots/bloquear', async (req, res) => {
  try {
    const { campanha, hora } = req.body;
    await pool.query(`
      INSERT INTO horarios (campanha, hora, disponivel, bloqueado_em)
      VALUES ($1, $2, FALSE, $3)
      ON CONFLICT DO NOTHING
    `, [campanha, hora, now()]);
    await pool.query(
      'UPDATE horarios SET disponivel = FALSE, bloqueado_em = $1 WHERE campanha = $2 AND hora = $3',
      [now(), campanha, hora]
    );
    res.json(ok({}));
  } catch(e) { res.json(fail(e.message)); }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) as n FROM agendamentos');
    res.json({ ok: true, msg: 'iGreen API v3 - PostgreSQL', agendamentos: parseInt(r.rows[0].n) });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  }
});

app.listen(PORT, () => console.log('iGreen API v3 rodando na porta', PORT));
