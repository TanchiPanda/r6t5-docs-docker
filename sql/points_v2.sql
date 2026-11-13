-- r6t5-docs 账户体系 + 文档积分 v2（在 points.sql 之后执行，可重复执行）
-- Supabase 控制台 SQL Editor 整段执行

-- 1. 账户扩展：邮箱、VIP 到期、封禁
alter table public.r6t5_accounts
  add column if not exists email     text,
  add column if not exists vip_until timestamptz,
  add column if not exists banned    boolean not null default false;

-- 2. 注册即开积分账户（余额 0，无 VIP）
create or replace function public.r6t5_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.r6t5_accounts (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists r6t5_signup_trigger on auth.users;
create trigger r6t5_signup_trigger
  after insert on auth.users
  for each row execute function public.r6t5_on_signup();

-- 3. 把已有的 auth 用户补进账户表
insert into public.r6t5_accounts (user_id, email)
select u.id, u.email from auth.users u
on conflict (user_id) do update set email = excluded.email;

-- 4. 查询本人余额与 VIP 状态
create or replace function public.r6t5_me()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'balance', coalesce((select balance from public.r6t5_accounts where user_id = auth.uid()), 0),
    'vip_until', (select vip_until from public.r6t5_accounts where user_id = auth.uid()),
    'banned', coalesce((select banned from public.r6t5_accounts where user_id = auth.uid()), false)
  );
$$;

-- 5. VIP 状态（供服务端判断是否直接放行全文）
create or replace function public.r6t5_vip_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active', coalesce((select vip_until > now() from public.r6t5_accounts where user_id = auth.uid()), false),
    'vip_until', (select vip_until from public.r6t5_accounts where user_id = auth.uid())
  );
$$;

-- 6. 积分购买 VIP（原子：校验余额 → 扣分 → 叠加天数）
create or replace function public.r6t5_buy_vip(p_days integer, p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bal integer;
  v_until timestamptz;
begin
  if v_uid is null then raise exception '未登录'; end if;
  if p_days is null or p_days <= 0 then raise exception 'VIP 天数无效'; end if;
  if p_points is null or p_points < 0 then raise exception '积分价格无效'; end if;

  insert into public.r6t5_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;

  if coalesce((select banned from public.r6t5_accounts where user_id = v_uid), false) then
    raise exception '账号已被封禁';
  end if;

  update public.r6t5_accounts
     set balance = balance - p_points, updated_at = now()
   where user_id = v_uid and balance >= p_points
   returning balance into v_bal;

  if v_bal is null then raise exception '积分不足'; end if;

  update public.r6t5_accounts
     set vip_until = greatest(coalesce(vip_until, now()), now()) + (p_days || ' days')::interval,
         updated_at = now()
   where user_id = v_uid
   returning vip_until into v_until;

  insert into public.r6t5_vip_orders (user_id, days, points)
  values (v_uid, p_days, p_points)
  on conflict do nothing;

  return jsonb_build_object('balance', v_bal, 'vip_until', v_until);
end;
$$;

-- 7. 兑换码：积分 / VIP 天数
create or replace function public.r6t5_redeem_points(p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_bal integer;
begin
  if v_uid is null then raise exception '未登录'; end if;
  if p_amount is null or p_amount <= 0 then raise exception '数量无效'; end if;
  insert into public.r6t5_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.r6t5_accounts set balance = balance + p_amount, updated_at = now()
   where user_id = v_uid returning balance into v_bal;
  return v_bal;
end;
$$;

create or replace function public.r6t5_redeem_vip(p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_until timestamptz;
begin
  if v_uid is null then raise exception '未登录'; end if;
  if p_days is null or p_days <= 0 then raise exception '天数无效'; end if;
  insert into public.r6t5_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.r6t5_accounts
     set vip_until = greatest(coalesce(vip_until, now()), now()) + (p_days || ' days')::interval,
         updated_at = now()
   where user_id = v_uid returning vip_until into v_until;
  return v_until;
end;
$$;

-- 8. 解锁文档：VIP 直接放行（不扣分、不写记录）
create or replace function public.r6t5_unlock_doc(p_doc text, p_cost integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bal integer;
  v_found boolean;
  v_vip timestamptz;
begin
  if v_uid is null then raise exception '未登录'; end if;
  if p_cost is null or p_cost < 0 then raise exception '积分价格无效'; end if;

  insert into public.r6t5_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select vip_until into v_vip from public.r6t5_accounts where user_id = v_uid;
  select balance into v_bal from public.r6t5_accounts where user_id = v_uid;

  if v_vip is not null and v_vip > now() then
    return v_bal;  -- VIP：直接放行，不扣分
  end if;

  select exists(select 1 from public.r6t5_unlocks where user_id = v_uid and doc_path = p_doc) into v_found;
  if v_found then
    return v_bal;
  end if;

  update public.r6t5_accounts
     set balance = balance - p_cost, updated_at = now()
   where user_id = v_uid and balance >= p_cost
   returning balance into v_bal;

  if v_bal is null then raise exception '积分不足'; end if;

  insert into public.r6t5_unlocks (user_id, doc_path, cost)
  values (v_uid, p_doc, p_cost)
  on conflict (user_id, doc_path) do nothing;

  return v_bal;
end;
$$;

-- 9. 管理员充值 / 授予 VIP（把 ADMIN_UUID 换成你 Supabase 账号 id）
create or replace function public.r6t5_grant(p_user uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_bal integer;
begin
  if auth.uid() is distinct from 'ADMIN_UUID'::uuid then raise exception '仅管理员可充值'; end if;
  insert into public.r6t5_accounts (user_id, balance) values (p_user, greatest(p_amount, 0))
  on conflict (user_id) do update
    set balance = public.r6t5_accounts.balance + greatest(p_amount, 0), updated_at = now()
  returning balance into v_bal;
  return v_bal;
end;
$$;

create or replace function public.r6t5_activate_vip(p_user uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_until timestamptz;
begin
  if auth.uid() is distinct from 'ADMIN_UUID'::uuid then raise exception '仅管理员可授予 VIP'; end if;
  insert into public.r6t5_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.r6t5_accounts
     set vip_until = greatest(coalesce(vip_until, now()), now()) + (p_days || ' days')::interval,
         updated_at = now()
   where user_id = p_user returning vip_until into v_until;
  return v_until;
end;
$$;

-- 10. VIP 订单表（积分支付，直接记 paid）
create table if not exists public.r6t5_vip_orders (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  days integer not null,
  points integer not null,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

alter table public.r6t5_vip_orders enable row level security;
drop policy if exists r6t5_vip_orders_self on public.r6t5_vip_orders;
create policy r6t5_vip_orders_self on public.r6t5_vip_orders
  for select using (auth.uid() = user_id);

-- 11. RLS 扩展：账户表也把 email 暴露给本人
--     （原策略 r6t5_accounts_self 已允许本人 select 整行）
