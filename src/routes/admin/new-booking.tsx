import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout, PAYMENT_LABELS } from './ui';
import { todayJst } from './util';

export const newBooking = new Hono<{ Bindings: Bindings }>();

newBooking.get('/', async (c) => {
  const [slotTypesResult, plansResult] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>(),
    c.env.DB.prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>()
  ]);
  const slotTypes = slotTypesResult.results;
  const plans = plansResult.results;

  return c.html(
    <Layout title="新規予約" active="/admin/new">
      <div class="page-head">
        <span class="eyebrow">New Booking</span>
        <h1>新規予約</h1>
      </div>
      <form class="card card-pad" method="post" action="/admin/bookings">
        <div class="form-grid">
          <div class="field">
            <label>日付</label>
            <input type="date" name="date" value={todayJst()} required />
          </div>
          <div class="field">
            <label>プラン</label>
            <select name="plan_id">
              {plans.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>時間帯</label>
            <select name="slot_type_id">
              {slotTypes.map((st) => (
                <option value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>顧客名</label>
            <input type="text" name="customer_name" required />
          </div>
          <div class="field">
            <label>電話</label>
            <input type="text" name="customer_phone" />
          </div>
          <div class="field">
            <label>大人人数</label>
            <input type="number" name="num_adults" min="0" value="1" />
          </div>
          <div class="field">
            <label>小人人数</label>
            <input type="number" name="num_children" min="0" value="0" />
          </div>
          <div class="field">
            <label>
              金額 <span class="hint">空欄でプラン単価から自動計算</span>
            </label>
            <input type="number" name="total_amount" min="0" />
          </div>
          <div class="field">
            <label>支払方法</label>
            <select name="payment_method">
              {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                <option value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div class="field" style="flex:1">
            <label>備考</label>
            <textarea name="notes"></textarea>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <label class="check">
            <input type="checkbox" name="as_request" value="1" /> 仮予約（リクエスト）として登録
          </label>
          <button class="btn btn-primary btn-lg" type="submit">
            登録
          </button>
        </div>
      </form>
    </Layout>
  );
});
