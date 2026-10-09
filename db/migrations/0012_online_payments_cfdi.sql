-- 0012 · Cobro en línea (Stripe: tarjeta y OXXO) y facturación CFDI 4.0 (Facturapi)

-- ---------- pagos: métodos en línea y forma de pago SAT ----------
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('cash','transfer','card','online_card','oxxo'));
-- Forma de pago del catálogo SAT (01 efectivo, 03 transferencia, 04 tarjeta de crédito, 28 tarjeta de débito).
alter table payments add column sat_payment_form text check (sat_payment_form ~ '^\d{2}$');
-- El trigger de inmutabilidad permite fijar la forma de pago una sola vez (al facturar se puede precisar débito/crédito).
create or replace function payments_guard_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['voided_at','voided_by','void_reason','sat_payment_form'])
     is distinct from (to_jsonb(old) - array['voided_at','voided_by','void_reason','sat_payment_form']) then
    raise exception 'Un pago registrado no puede modificarse; anúlalo y regístralo de nuevo.' using errcode = 'P0001';
  end if;
  if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
    raise exception 'El pago ya está anulado.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- links de pago en línea ----------
create table payment_links (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients(id) on delete cascade,
  membership_id   uuid not null references memberships(id),
  plan_name       text not null,
  concept         text not null,
  amount_cents    int not null check (amount_cents >= 1000),       -- Stripe exige un mínimo; $10.00 MXN
  methods         text[] not null default '{card}',
  customer_email  text,
  provider        text not null default 'stripe',
  provider_session_id text unique,
  url             text,
  status          text not null default 'open'
                  check (status in ('open','pending_oxxo','paid','needs_review','expired','failed','cancelled','refunded')),
  payment_intent_id text,
  refund_id       text,
  paid_method     text check (paid_method in ('online_card','oxxo')),
  payment_id      uuid references payments(id),
  review_reason   text,
  expires_at      timestamptz not null,
  paid_at         timestamptz,
  created_by      uuid references users(id),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payment_links_patient_idx on payment_links (patient_id, created_at desc);
create index payment_links_status_idx on payment_links (status) where status in ('open','pending_oxxo','needs_review');
create trigger payment_links_touch before update on payment_links for each row execute function touch_updated_at();

-- Eventos recibidos de proveedores externos: idempotencia de webhooks.
create table provider_events (
  provider    text not null,
  event_id    text not null,
  type        text not null,
  received_at timestamptz not null default now(),
  outcome     text not null default '',
  primary key (provider, event_id)
);

-- ---------- facturación ----------
-- Datos fiscales del paciente (o de quien paga por él).
create table patient_tax_profiles (
  patient_id  uuid primary key references patients(id) on delete cascade,
  legal_name  text not null check (length(trim(legal_name)) > 1),          -- razón social / nombre, como en la constancia
  tax_id      text not null check (tax_id ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  tax_system  text not null check (tax_system ~ '^\d{3}$'),                 -- régimen fiscal SAT
  zip         text not null check (zip ~ '^\d{5}$'),                        -- CP del domicilio fiscal
  cfdi_use    text not null default 'D01' check (cfdi_use ~ '^[A-Z]\d{2}$'),
  email       text not null default '',
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);
create trigger patient_tax_profiles_touch before update on patient_tax_profiles for each row execute function touch_updated_at();

create table invoices (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('individual','global')),
  patient_id       uuid references patients(id),
  provider         text not null default 'facturapi',
  provider_id      text unique,
  uuid             text,                                   -- folio fiscal SAT
  series           text not null default '',
  folio_number     int,
  status           text not null default 'pending' check (status in ('pending','valid','canceled','error')),
  cancellation_status text,
  livemode         boolean not null default false,
  total_cents      int not null,
  payment_form     text not null,
  cfdi_use         text not null,
  customer         jsonb not null,                         -- copia de los datos fiscales al timbrar
  global_period    jsonb,                                  -- { periodicity, months, year }
  verification_url text,
  error            text,
  cancel_motive    text,
  canceled_at      timestamptz,
  created_by       uuid references users(id),
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((kind = 'individual') = (patient_id is not null))
);
create index invoices_patient_idx on invoices (patient_id, created_at desc);
create index invoices_created_idx on invoices (created_at desc);
create trigger invoices_touch before update on invoices for each row execute function touch_updated_at();

create table invoice_payments (
  invoice_id uuid not null references invoices(id) on delete cascade,
  payment_id uuid not null references payments(id),
  active     boolean not null default true,                -- false cuando la factura se cancela
  primary key (invoice_id, payment_id)
);
-- Un pago solo puede estar en una factura vigente a la vez.
create unique index invoice_payments_one_active on invoice_payments (payment_id) where active;

-- ---------- parámetros de cobro y facturación (Configuración → Cobros y facturación) ----------
update clinic set settings = settings || jsonb_build_object(
  'online_payments_enabled', true,
  'oxxo_enabled', true,
  'payment_link_hours', 24,                 -- Stripe permite de 1 a 24 horas para abrir el link
  'oxxo_days', 3,                           -- días para pagar la ficha OXXO una vez generada
  'invoice_product_key', '85122101',        -- SAT: Servicios de fisioterapia
  'invoice_unit_key', 'E48',                -- SAT: Unidad de servicio
  'invoice_tax', 'iva16',                   -- 'iva16' (IVA 16% incluido en el precio) o 'exento'
  'invoice_series', 'NCE',
  'invoice_zip', '',                        -- CP del lugar de expedición (debe coincidir con el de Facturapi)
  'invoice_default_use', 'D01'
) - array[]::text[]
where not (settings ? 'invoice_product_key');

-- ---------- RLS: todo es exclusivo del dueño ----------
alter table payment_links enable row level security;
alter table provider_events enable row level security;
alter table patient_tax_profiles enable row level security;
alter table invoices enable row level security;
alter table invoice_payments enable row level security;
revoke all on payment_links, provider_events, patient_tax_profiles, invoices, invoice_payments from public;
grant select, insert, update on payment_links, patient_tax_profiles, invoices, invoice_payments to nce_app;
create policy payment_links_owner on payment_links for all to nce_app using (is_owner()) with check (is_owner());
create policy patient_tax_profiles_owner on patient_tax_profiles for all to nce_app using (is_owner()) with check (is_owner());
create policy invoices_owner on invoices for all to nce_app using (is_owner()) with check (is_owner());
create policy invoice_payments_owner on invoice_payments for all to nce_app using (is_owner()) with check (is_owner());
-- provider_events: solo el sistema (webhooks).

do $$
declare t text;
begin
  foreach t in array array['payment_links','patient_tax_profiles','invoices'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop;
end $$;
