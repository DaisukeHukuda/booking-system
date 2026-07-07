import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout } from './ui';

export const agencies = new Hono<{ Bindings: Bindings }>();

const OK_MESSAGES: Record<string, string> = {
  created: '代理店を作成しました',
  updated: '更新しました',
  reissued: '専用リンクを再発行しました。旧リンクは無効です'
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: '入力内容に誤りがあります'
};

const MODE_LABELS: Record<string, string> = {
  realtime: '即時確定',
  request: 'リクエスト'
};

function newToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isValidMode(v: unknown): v is 'realtime' | 'request' {
  return v === 'realtime' || v === 'request';
}

interface AgencyRow {
  id: number;
  name: string;
  token: string;
  email: string | null;
  booking_mode: 'realtime' | 'request';
  active: number;
  notes: string;
}

agencies.get('/', async (c) => {
  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');
  const origin = new URL(c.req.url).origin;

  const result = await c.env.DB.prepare('SELECT * FROM agencies ORDER BY id').all<AgencyRow>();
  const rows = result.results;

  return c.html(
    <Layout title="代理店管理">
      <h1>代理店管理</h1>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>モード</th>
            <th>メール</th>
            <th>有効</th>
            <th>専用リンク</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr>
              <td>{a.name}</td>
              <td>{MODE_LABELS[a.booking_mode]}</td>
              <td>{a.email}</td>
              <td>{a.active ? '有効' : '無効'}</td>
              <td>
                <code>{`${origin}/a/${a.token}`}</code>
              </td>
              <td>
                <form method="post" action={`/admin/agencies/${a.id}/reissue`}>
                  <button type="submit">再発行</button>
                </form>
              </td>
              <td>
                <a href={`/admin/agencies/${a.id}/edit`}>編集</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>新規作成</h2>
      <form method="post" action="/admin/agencies">
        <label>
          名前: <input type="text" name="name" required />
        </label>{' '}
        <label>
          メール: <input type="email" name="email" />
        </label>{' '}
        <label>
          予約モード:{' '}
          <select name="booking_mode">
            <option value="request">リクエスト（承認制）</option>
            <option value="realtime">即時確定</option>
          </select>
        </label>{' '}
        <button type="submit">作成</button>
      </form>
    </Layout>
  );
});

agencies.post('/', async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const emailRaw = typeof form.email === 'string' ? form.email.trim() : '';
  const bookingMode = form.booking_mode;

  if (name === '' || !isValidMode(bookingMode)) {
    return c.redirect('/admin/agencies?error=invalid');
  }

  await c.env.DB.prepare(
    `INSERT INTO agencies (name, token, email, booking_mode, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(name, newToken(), emailRaw === '' ? null : emailRaw, bookingMode, new Date().toISOString())
    .run();

  return c.redirect('/admin/agencies?ok=created');
});

agencies.get('/:id/edit', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/agencies');

  const agency = await c.env.DB.prepare('SELECT * FROM agencies WHERE id = ?').bind(id).first<AgencyRow>();
  if (!agency) return c.redirect('/admin/agencies');

  const errorParam = c.req.query('error');

  return c.html(
    <Layout title="代理店編集">
      <h1>代理店編集</h1>
      <p>
        <a href="/admin/agencies">&laquo; 代理店一覧に戻る</a>
      </p>
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <form method="post" action={`/admin/agencies/${agency.id}`}>
        <label>
          名前: <input type="text" name="name" value={agency.name} required />
        </label>{' '}
        <label>
          メール: <input type="email" name="email" value={agency.email ?? ''} />
        </label>{' '}
        <label>
          予約モード:{' '}
          <select name="booking_mode">
            <option value="request" selected={agency.booking_mode === 'request'}>
              リクエスト（承認制）
            </option>
            <option value="realtime" selected={agency.booking_mode === 'realtime'}>
              即時確定
            </option>
          </select>
        </label>{' '}
        <label>
          <input type="checkbox" name="active" value="1" checked={agency.active === 1} /> 有効
        </label>{' '}
        <label>
          備考: <textarea name="notes">{agency.notes}</textarea>
        </label>{' '}
        <button type="submit">更新</button>
      </form>
    </Layout>
  );
});

agencies.post('/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/agencies');

  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const emailRaw = typeof form.email === 'string' ? form.email.trim() : '';
  const bookingMode = form.booking_mode;
  const active = form.active !== undefined ? 1 : 0;
  const notes = typeof form.notes === 'string' ? form.notes : '';

  if (name === '' || !isValidMode(bookingMode)) {
    return c.redirect(`/admin/agencies/${id}/edit?error=invalid`);
  }

  await c.env.DB.prepare(
    `UPDATE agencies SET name = ?, email = ?, booking_mode = ?, active = ?, notes = ? WHERE id = ?`
  )
    .bind(name, emailRaw === '' ? null : emailRaw, bookingMode, active, notes, id)
    .run();

  return c.redirect('/admin/agencies?ok=updated');
});

agencies.post('/:id/reissue', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/agencies');

  await c.env.DB.prepare(`UPDATE agencies SET token = ? WHERE id = ?`).bind(newToken(), id).run();

  return c.redirect('/admin/agencies?ok=reissued');
});
