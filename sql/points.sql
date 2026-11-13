-- r6t5-docs 文档积分 · Supabase 建库脚本
-- 在 Supabase 控制台 SQL Editor 整段执行即可（可重复执行）

-- 1. 积分账户（余额）
create table if not exists public.r6t5_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 已解锁文档
create table if not exists public.r6t5_unlocks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc_path    text not null,
  cost        integer not null default 0,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, doc_path)
);

create index if not exists r6t5_unlocks_user_idx on public.r6t5_unlocks (user_id);

-- 3. 解锁函数：校验余额 → 扣分 → 记录解锁（同一事务，防并发多扣）
create or replace function public.r6t5_unlock_doc(p_doc text, p_cost integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_bal   integer;
  v_found boolean;
begin
  if v_uid is null then
    raise exception '未登录';
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception '积分价格无效';
  end if;

  insert into public.r6t5_accounts (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select exists(
    select 1 from public.r6t5_unlocks where user_id = v_uid and doc_path = p_doc
  ) into v_found;

  if v_found then
    select balance into v_bal from public.r6t5_accounts where user_id = v_uid;
    return v_bal;
  end if;

  update public.r6t5_accounts
     set balance = balance - p_cost, updated_at = now()
   where user_id = v_uid and balance >= p_cost
   returning balance into v_bal;

  if v_bal is null then
    raise exception '积分不足';
  end if;

  insert into public.r6t5_unlocks (user_id, doc_path, cost)
  values (v_uid, p_doc, p_cost)
  on conflict (user_id, doc_path) do nothing;

  return v_bal;
end;
$$;

-- 4. 余额查询（供页面展示）
create or replace function public.r6t5_balance()
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce((select balance from public.r6t5_accounts where user_id = auth.uid()), 0);
$$;

-- 5. 管理员充值（把 ADMIN_UUID 换成你自己的 Supabase 用户 id）
create or replace function public.r6t5_grant(p_user uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_bal integer;
begin
  if auth.uid() is distinct from 'ADMIN_UUID'::uuid then
    raise exception '仅管理员可充值';
  end if;
  insert into public.r6t5_accounts (user_id, balance) values (p_user, greatest(p_amount, 0))
  on conflict (user_id) do update
    set balance = public.r6t5_accounts.balance + greatest(p_amount, 0),
        updated_at = now()
  returning balance into v_bal;
  return v_bal;
end;
$$;

-- 6. RLS：账户与解锁记录只允许本人读取
alter table public.r6t5_accounts enable row level security;
alter table public.r6t5_unlocks  enable row level security;

drop policy if exists r6t5_accounts_self on public.r6t5_accounts;
create policy r6t5_accounts_self on public.r6t5_accounts
  for select using (auth.uid() = user_id);

drop policy if exists r6t5_unlocks_self on public.r6t5_unlocks;
create policy r6t5_unlocks_self on public.r6t5_unlocks
  for select using (auth.uid() = user_id);

-- 说明：
-- 1) 解锁由 r6t5_unlock_doc 以 security definer 执行，绕过 RLS 写入；
-- 2) 前端只用 anon key + 用户 JWT，拿不到 service_role；
-- 3) 充值用 r6t5_grant，只有 ADMIN_UUID 对应账号能调。
