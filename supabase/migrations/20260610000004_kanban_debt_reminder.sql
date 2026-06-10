-- ============================================================================
-- Migration 004: Debt-overdue reminder (pg_cron + fn_debt_reminder_scan)
-- Tham chiếu: plans/kanban_rebuild_spec.md §6.8
-- ============================================================================
-- Quy tắc nghiệp vụ:
--   - Thẻ active ở cột KTHC_DEBT có due_date < CURRENT_DATE và
--     payment_status != 'paid' → quá hạn.
--   - Cứ 15 ngày một lần, sinh 1 notification 'debt_overdue' tới:
--       (1) tất cả user thuộc phòng KTHC (is_deleted=false, status='active')
--       (2) người khởi tạo thẻ (created_by) — nếu khác phòng KTHC
--   - last_reminded_at để chống gửi trùng.
--
-- pg_cron:
--   - Migration TRY bật extension. Nếu project không cho phép → migration
--     sẽ FAIL với thông báo rõ. Khi đó: chuyển sang GitHub Actions gọi endpoint
--     `kanban.debt.scan` (hỏi DK trước).
-- ============================================================================

-- ====== HÀM QUÉT NỢ QUÁ HẠN ======
create or replace function public.fn_debt_reminder_scan()
returns table (
  cards_scanned    int,
  cards_overdue    int,
  notifications_in int
) language plpgsql as $$
declare
  v_card           record;
  v_kthc_dept_id   uuid;
  v_recipient      uuid;
  v_recipients     uuid[];
  v_days_overdue   int;
  v_notif_count    int := 0;
  v_overdue_count  int := 0;
  v_scan_count     int := 0;
  v_title          text;
  v_body           text;
  v_existing_count int;
begin
  -- Resolve phòng KTHC (lookup động qua bảng crm_departments)
  select id into v_kthc_dept_id
    from public.crm_departments
    where upper(code) = 'KTHC' and coalesce(is_deleted, false) = false
    limit 1;

  for v_card in
    select c.*, f.due_date, f.payment_status, f.last_reminded_at, f.debt_amount
      from public.crm_kanban_cards c
      join public.crm_kanban_financials f on f.card_id = c.id
     where c.status = 'active'
       and c.current_stage = 'KTHC_DEBT'
       and f.due_date is not null
       and f.due_date < current_date
       and coalesce(f.payment_status, 'unpaid') <> 'paid'
       and (f.last_reminded_at is null
            or current_date - f.last_reminded_at >= 15)
  loop
    v_scan_count := v_scan_count + 1;
    v_overdue_count := v_overdue_count + 1;
    v_days_overdue := (current_date - v_card.due_date)::int;

    -- Tập người nhận: tất cả KTHC + creator (dedupe)
    v_recipients := array[]::uuid[];
    if v_kthc_dept_id is not null then
      select coalesce(array_agg(distinct u.id), array[]::uuid[])
        into v_recipients
        from public.crm_users u
        where u.department_id = v_kthc_dept_id
          and coalesce(u.is_deleted, false) = false
          and coalesce(u.status, 'active') = 'active';
    end if;
    if v_card.created_by is not null
       and not (v_card.created_by = any(v_recipients)) then
      v_recipients := array_append(v_recipients, v_card.created_by);
    end if;

    -- Build title/body
    v_title := 'Công nợ quá hạn ' || v_days_overdue || ' ngày';
    v_body  := 'Thẻ "' || v_card.title || '"'
            || coalesce(' của KH ' || v_card.customer_name, '')
            || ' đã quá hạn ' || v_days_overdue || ' ngày.'
            || coalesce(' Số tiền còn nợ: ' || v_card.debt_amount, '');

    -- Insert notification cho từng người (dedupe-safe trong vòng 15 ngày)
    foreach v_recipient in array v_recipients loop
      -- Bỏ qua nếu user này đã có 1 thông báo cho thẻ này trong 15 ngày qua
      select count(*) into v_existing_count
        from public.crm_notifications
        where user_id = v_recipient
          and card_id = v_card.id
          and type    = 'debt_overdue'
          and created_at >= now() - interval '15 days';
      if v_existing_count = 0 then
        insert into public.crm_notifications
          (user_id, type, title, message, entity_type, entity_id, card_id, is_read, priority, created_at, updated_at)
        values
          (v_recipient, 'debt_overdue', v_title, v_body, 'kanban_card', v_card.id, v_card.id, false, 'high', now(), now());
        v_notif_count := v_notif_count + 1;
      end if;
    end loop;

    -- Cập nhật last_reminded_at + log
    update public.crm_kanban_financials
       set last_reminded_at = current_date
     where card_id = v_card.id;

    insert into public.crm_kanban_logs (card_id, actor_id, action, from_stage, to_stage, meta)
    values (
      v_card.id,
      null,
      'debt_reminder',
      v_card.current_stage,
      v_card.current_stage,
      jsonb_build_object(
        'days_overdue', v_days_overdue,
        'recipient_count', array_length(v_recipients, 1),
        'due_date', v_card.due_date
      )
    );
  end loop;

  cards_scanned := v_scan_count;
  cards_overdue := v_overdue_count;
  notifications_in := v_notif_count;
  return next;
end $$;

comment on function public.fn_debt_reminder_scan() is
  'Quét thẻ KTHC_DEBT quá hạn, sinh notification debt_overdue cho KTHC + người khởi tạo. Chống trùng bằng last_reminded_at + check 15 ngày. Idempotent — gọi nhiều lần trong ngày KHÔNG sinh thêm notification trùng.';

-- ====== pg_cron — bật extension + lên lịch hằng ngày ======
-- 01:00 UTC = 08:00 ICT.
-- Nếu project Supabase KHÔNG cho phép pg_cron (Free tier hoặc bị disable),
-- migration sẽ FAIL ở dòng CREATE EXTENSION. Khi đó DK đọc thông báo lỗi và
-- quyết định: enable pg_cron trên Dashboard → chạy lại, HOẶC chuyển sang
-- GitHub Actions cron gọi endpoint 'kanban.debt.scan'.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron không bật được: %. Sẽ chuyển sang trigger ngoài.', sqlerrm;
    return;
  end;

  -- Hủy lịch cũ (nếu có) trước khi đặt mới để idempotent
  begin
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'kanban-debt-reminder-daily';
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kanban-debt-reminder-daily',
    '0 1 * * *',
    $cron$ select public.fn_debt_reminder_scan(); $cron$
  );
end $$;
