


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "hast_chamcong";


ALTER SCHEMA "hast_chamcong" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "hast_crm";


ALTER SCHEMA "hast_crm" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."calculate_session_grade"("p_time" time without time zone, "p_shift_type" "text", "p_session" "text") RETURNS character
    LANGUAGE "plpgsql"
    AS $$DECLARE
    v_conf RECORD;
BEGIN
    IF p_time IS NULL THEN
        RETURN 'D';
    END IF;

    -- SỬA: Thay public.chamcong.shift_config thành public.chamcong_shift_config
    SELECT * INTO v_conf 
    FROM public.chamcong_shift_config 
    WHERE shift_type = p_shift_type AND session = p_session;

    IF NOT FOUND THEN
        RETURN 'D'; -- Fallback
    END IF;

    -- IN SÁNG & IN CHIỀU
    IF p_session IN ('morning_in', 'afternoon_in') THEN
        IF p_time <= v_conf.a_end THEN
            RETURN 'A';
        ELSIF v_conf.b_end IS NOT NULL AND p_time <= v_conf.b_end THEN
            RETURN 'B';
        ELSE
            RETURN 'D';
        END IF;
    END IF;

    -- OUT SÁNG
    IF p_session = 'morning_out' THEN
        IF p_time >= v_conf.a_start AND p_time <= v_conf.a_end2 THEN
            RETURN 'A';
        ELSIF p_time < v_conf.a_start THEN
            RETURN 'B';
        ELSE
            RETURN 'D';
        END IF;
    END IF;

    -- OUT CHIỀU
    IF p_session = 'afternoon_out' THEN
        IF p_time >= v_conf.a_end THEN
            RETURN 'A';
        ELSIF p_time < v_conf.a_end THEN
            RETURN 'B';
        ELSE
            RETURN 'D';
        END IF;
    END IF;

    RETURN 'D';
END;$$;


ALTER FUNCTION "public"."calculate_session_grade"("p_time" time without time zone, "p_shift_type" "text", "p_session" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_user_privilege"("allowed_role" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  req_user TEXT;
  req_pin TEXT;
  db_pin TEXT;
  db_note TEXT;
BEGIN
  req_user := COALESCE(current_setting('request.headers', true)::json->>'x-ktv-user', '');
  req_pin  := COALESCE(current_setting('request.headers', true)::json->>'x-ktv-pin', '');
  IF req_user = '' OR req_pin = '' THEN RETURN FALSE; END IF;

  BEGIN
    req_user := convert_from(decode(req_user, 'base64'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;

  -- TRUY VẤN VÀO BẢNG MỚI ĐÃ ĐỔI TÊN
  SELECT pin_hash, ghi_chu INTO db_pin, db_note
  FROM public.bcn_danh_sach_ktv
  WHERE ho_ten = req_user;

  IF db_pin IS NULL OR db_pin <> req_pin THEN RETURN FALSE; END IF;
  IF db_note = 'Quản trị viên' OR db_note = 'Tổng Giám Đốc' THEN RETURN TRUE; END IF;
  IF allowed_role = 'ktv' THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."check_user_privilege"("allowed_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_attendance_log"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$DECLARE
    v_local_dt TIMESTAMP;
    v_date DATE;
    v_time TIME;
    v_hhmm INT;
    v_session TEXT;
    v_shift_type TEXT;
    
    v_morning_in TIME;
    v_morning_out TIME;
    v_afternoon_in TIME;
    v_afternoon_out TIME;
    
    v_g1 CHAR(1);
    v_g2 CHAR(1);
    v_g3 CHAR(1);
    v_g4 CHAR(1);
BEGIN
    -- Chuyển đổi UTC sang múi giờ Việt Nam
    v_local_dt := NEW.checked_at AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_date := v_local_dt::DATE;
    v_time := v_local_dt::TIME;
    v_hhmm := (EXTRACT(HOUR FROM v_time) * 100 + EXTRACT(MINUTE FROM v_time))::INT;

    -- 1. Phân loại Ca dựa theo khung giờ
    IF v_hhmm <= 900 THEN
        v_session := 'morning_in';
    ELSIF v_hhmm <= 1245 THEN
        v_session := 'morning_out';
    ELSIF v_hhmm <= 1500 THEN
        v_session := 'afternoon_in';
    ELSE
        v_session := 'afternoon_out';
    END IF;

    -- 2. Đọc loại ca (loai_ca) của Nhân viên
    SELECT COALESCE(loai_ca, 'tieu_chuan') INTO v_shift_type 
    FROM public.chamcong_employees 
    WHERE name = NEW.employee_name;

    IF v_shift_type IS NULL THEN
        v_shift_type := 'tieu_chuan';
    END IF;

    -- 3. Khởi tạo dòng tổng hợp ngày (nếu chưa có)
    INSERT INTO public.chamcong_attendance_records (employee_name, date)
    VALUES (NEW.employee_name, v_date)
    ON CONFLICT (employee_name, date) DO NOTHING;

    -- Lấy dữ liệu hiện hành
    SELECT morning_in, morning_out, afternoon_in, afternoon_out
    INTO v_morning_in, v_morning_out, v_afternoon_in, v_afternoon_out
    FROM public.chamcong_attendance_records
    WHERE employee_name = NEW.employee_name AND date = v_date;

    -- 4. Áp dụng Rule 4 Smart Pick (Chọn Sớm nhất cho IN, Muộn nhất cho OUT)
    IF v_session = 'morning_in' THEN
        IF v_morning_in IS NULL OR v_time < v_morning_in THEN
            v_morning_in := v_time;
        END IF;
    ELSIF v_session = 'morning_out' THEN
        IF v_morning_out IS NULL OR v_time > v_morning_out THEN
            v_morning_out := v_time;
        END IF;
    ELSIF v_session = 'afternoon_in' THEN
        IF v_afternoon_in IS NULL OR v_time < v_afternoon_in THEN
            v_afternoon_in := v_time;
        END IF;
    ELSIF v_session = 'afternoon_out' THEN
        IF v_afternoon_out IS NULL OR v_time > v_afternoon_out THEN
            v_afternoon_out := v_time;
        END IF;
    END IF;

    -- 5. Tính toán điểm công A/B/D tự động
    -- SỬA: Bỏ "hast_chamcong." thay bằng "public."
    v_g1 := public.calculate_session_grade(v_morning_in, v_shift_type, 'morning_in');
    v_g2 := public.calculate_session_grade(v_morning_out, v_shift_type, 'morning_out');
    v_g3 := public.calculate_session_grade(v_afternoon_in, v_shift_type, 'afternoon_in');
    v_g4 := public.calculate_session_grade(v_afternoon_out, v_shift_type, 'afternoon_out');

    -- 6. Lưu vào bảng attendance_records
    -- SỬA: Update vào bảng mới public.chamcong_attendance_records
    UPDATE public.chamcong_attendance_records
    SET
        morning_in = v_morning_in,
        morning_out = v_morning_out,
        afternoon_in = v_afternoon_in,
        afternoon_out = v_afternoon_out,
        grades = concat(v_g1, ',', v_g2, ',', v_g3, ',', v_g4),
        note = CASE WHEN NEW.note IS NOT NULL AND NEW.note != '' THEN NEW.note ELSE note END,
        updated_at = NOW()
    WHERE employee_name = NEW.employee_name AND date = v_date;

    RETURN NEW;
END;$$;


ALTER FUNCTION "public"."process_attendance_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_danh_muc"("p_data" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.bcn_danh_muc (loai_danh_muc, gia_tri)
  SELECT 
    (x->>'loai_danh_muc')::text,
    (x->>'gia_tri')::text
  FROM jsonb_array_elements(p_data) AS x
  ON CONFLICT (loai_danh_muc, gia_tri) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."sync_danh_muc"("p_data" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bcn_bao_cao_ngay" (
    "id" "text" NOT NULL,
    "so_bcn" "text" NOT NULL,
    "ngay" "date" NOT NULL,
    "ktv" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."bcn_bao_cao_ngay" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcn_cau_hinh_he_thong" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."bcn_cau_hinh_he_thong" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcn_chi_tiet_cong_viec" (
    "id" bigint NOT NULL,
    "bcn_id" "text" NOT NULL,
    "khach_hang" "text" NOT NULL,
    "loai_viec" "text" NOT NULL,
    "model" "text",
    "thoi_gian" "text" NOT NULL,
    "so_luong" integer DEFAULT 1,
    "counter" integer DEFAULT 0,
    "ket_qua" "text" NOT NULL,
    "ghi_chu" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."bcn_chi_tiet_cong_viec" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcn_danh_muc" (
    "id" bigint NOT NULL,
    "loai_danh_muc" "text" NOT NULL,
    "gia_tri" "text" NOT NULL,
    "ghi_chu" "text",
    "thu_tu" integer DEFAULT 0
);


ALTER TABLE "public"."bcn_danh_muc" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcn_danh_sach_ktv" (
    "id" bigint NOT NULL,
    "ho_ten" "text" NOT NULL,
    "pin_hash" "text" NOT NULL,
    "ghi_chu" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."bcn_danh_sach_ktv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_admin_settings" (
    "key" "text" NOT NULL,
    "password" "text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chamcong_admin_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_attendance_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_name" "text",
    "checked_at" timestamp with time zone DEFAULT "now"(),
    "latitude" numeric,
    "longitude" numeric,
    "accuracy" numeric,
    "address" "text",
    "nearest_office" "text",
    "distance" numeric,
    "status" "text",
    "note" "text"
);


ALTER TABLE "public"."chamcong_attendance_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_attendance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_name" "text",
    "date" "date" NOT NULL,
    "morning_in" time without time zone,
    "morning_out" time without time zone,
    "afternoon_in" time without time zone,
    "afternoon_out" time without time zone,
    "grades" "text" DEFAULT 'D,D,D,D'::"text",
    "note" "text",
    "justification" "text",
    "approve_status" "text" DEFAULT 'Chờ'::"text",
    "approve_note" "text",
    "approve_time" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "nscl_score" "text",
    "nscl_adjust" numeric
);


ALTER TABLE "public"."chamcong_attendance_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_employees" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "telegram_chat_id" bigint,
    "department" "text" NOT NULL,
    "role" "text" DEFAULT 'CBNV'::"text",
    "loai_ca" "text" DEFAULT 'tieu_chuan'::"text",
    "status" "text" DEFAULT 'Đang làm việc'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chamcong_employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_guide_content" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chamcong_guide_content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_holidays" (
    "date" "date" NOT NULL,
    "description" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chamcong_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chamcong_shift_config" (
    "id" integer NOT NULL,
    "shift_type" "text" NOT NULL,
    "session" "text" NOT NULL,
    "a_start" time without time zone,
    "a_end" time without time zone,
    "a_end2" time without time zone,
    "b_end" time without time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chamcong_shift_config" OWNER TO "postgres";


ALTER TABLE "public"."bcn_chi_tiet_cong_viec" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chi_tiet_cong_viec_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."crm_activities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "customer_id" "uuid",
    "contact_id" "uuid",
    "type" "text",
    "description" "text",
    "due_date" timestamp with time zone,
    "status" "text",
    "related_type" "text",
    "related_id" "uuid",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "priority" "text",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "duration" integer,
    "result" "text",
    "title" "text" NOT NULL,
    CONSTRAINT "crm_activities_related_type_check" CHECK (("related_type" = ANY (ARRAY['opportunity'::"text", 'quote'::"text", 'order'::"text", 'ticket'::"text", 'campaign'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."crm_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_audit_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "changes" "jsonb",
    "ip_address" "text"
);


ALTER TABLE "public"."crm_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_campaigns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "status" "text",
    "start_date" "date",
    "end_date" "date",
    "budget" numeric DEFAULT 0,
    "revenue" numeric DEFAULT 0,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "actual_cost" numeric DEFAULT 0,
    "target_audience" "text",
    "goal" "text",
    "message_template" "text",
    "customer_ids" "text"
);


ALTER TABLE "public"."crm_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_contacts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "customer_id" "uuid",
    "code" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "position" "text",
    "department" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "full_name" "text" NOT NULL,
    "gender" "text",
    "birthday" "date",
    "mobile" "text",
    "address" "text",
    "social_zalo" "text",
    "social_facebook" "text",
    "is_primary" boolean DEFAULT false
);


ALTER TABLE "public"."crm_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_customers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text",
    "approval_status" "text" DEFAULT 'pending'::"text",
    "approval_reason" "text",
    "classification" "text",
    "tags" "text",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "phone" "text",
    "email" "text",
    "address" "text",
    "tax_code" "text",
    "external_code" "text",
    "notes" "text",
    "customer_type" "text",
    "website" "text",
    "province" "text",
    "district" "text",
    "industry" "text",
    "source" "text",
    "rating_stars" integer,
    "credit_limit" numeric DEFAULT 0,
    "purchase_cycle" "text",
    "rating_points" integer DEFAULT 0,
    "total_orders" integer DEFAULT 0,
    "total_revenue" numeric DEFAULT 0,
    "current_debt" numeric DEFAULT 0,
    "approved_by" "text",
    "approved_at" "text",
    CONSTRAINT "crm_customers_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "crm_customers_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'department'::"text", 'public'::"text"])))
);


ALTER TABLE "public"."crm_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_departments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "description" "text"
);


ALTER TABLE "public"."crm_departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "channel" "text",
    "direction" "text",
    "content" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "status" "text",
    "sender_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "customer_id" "uuid",
    "subject" "text"
);


ALTER TABLE "public"."crm_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_notes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text",
    "content" "text",
    "tags" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "related_type" "text",
    "related_id" "uuid",
    "attachment_url" "text",
    "attachment_name" "text",
    "is_pinned" boolean DEFAULT false
);


ALTER TABLE "public"."crm_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text",
    "user_id" "uuid",
    "type" "text",
    "title" "text" NOT NULL,
    "message" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "priority" "text" DEFAULT 'normal'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "crm_notifications_priority_check" CHECK (("priority" = ANY (ARRAY['normal'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."crm_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_opportunities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "customer_id" "uuid",
    "value" numeric DEFAULT 0,
    "stage" "text",
    "probability" integer DEFAULT 0,
    "close_date" "date",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "name" "text" NOT NULL,
    "estimated_value" numeric DEFAULT 0,
    "expected_close_date" "date",
    "source" "text",
    "competitor" "text",
    "notes" "text"
);


ALTER TABLE "public"."crm_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "parent_type" "text" NOT NULL,
    "parent_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "quantity" integer DEFAULT 1,
    "unit_price" numeric DEFAULT 0,
    "amount" numeric DEFAULT 0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "product_name" "text",
    "unit" "text",
    "discount_percent" numeric DEFAULT 0,
    "discount_amount" numeric DEFAULT 0,
    "vat_rate" numeric DEFAULT 10,
    "line_total" numeric DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    CONSTRAINT "crm_order_items_parent_type_check" CHECK (("parent_type" = ANY (ARRAY['quote'::"text", 'order'::"text"])))
);


ALTER TABLE "public"."crm_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "quote_id" "uuid",
    "opportunity_id" "uuid",
    "customer_id" "uuid",
    "title" "text",
    "total_amount" numeric DEFAULT 0,
    "paid_amount" numeric DEFAULT 0,
    "status" "text",
    "payment_status" "text",
    "due_date" "date",
    "delivery_address" "text",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "issue_date" "date",
    "valid_until" "date",
    "order_date" "date",
    "delivery_date" "date",
    "payment_terms" "text",
    "delivery_terms" "text",
    "shipping_address" "text",
    "shipping_fee" numeric DEFAULT 0,
    "notes" "text",
    "subtotal" numeric DEFAULT 0,
    "discount_amount" numeric DEFAULT 0,
    "vat_amount" numeric DEFAULT 0,
    "remaining_amount" numeric DEFAULT 0
);


ALTER TABLE "public"."crm_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_products" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "price" numeric DEFAULT 0,
    "external_code" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "brand" "text",
    "sub_category" "text",
    "model" "text",
    "unit" "text",
    "list_price" numeric DEFAULT 0,
    "cost_price" numeric DEFAULT 0,
    "vat_rate" numeric DEFAULT 0,
    "stock_qty" integer DEFAULT 0,
    "image_url" "text",
    "is_active" boolean DEFAULT true,
    "is_for_rent" boolean DEFAULT false,
    "is_for_cpc" boolean DEFAULT false,
    "rent_price_per_month" numeric DEFAULT 0,
    "cpc_black_white" numeric DEFAULT 0,
    "cpc_color" numeric DEFAULT 0
);


ALTER TABLE "public"."crm_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_quotes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "opportunity_id" "uuid",
    "customer_id" "uuid",
    "title" "text",
    "value" numeric DEFAULT 0,
    "status" "text",
    "validity_date" "date",
    "payment_terms" "text",
    "delivery_terms" "text",
    "quote_type" "text" DEFAULT 'sale'::"text",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "issue_date" "date",
    "valid_until" "date",
    "order_date" "date",
    "delivery_date" "date",
    "shipping_address" "text",
    "shipping_fee" numeric DEFAULT 0,
    "notes" "text",
    "subtotal" numeric DEFAULT 0,
    "discount_amount" numeric DEFAULT 0,
    "vat_amount" numeric DEFAULT 0,
    "total_amount" numeric DEFAULT 0,
    CONSTRAINT "crm_quotes_quote_type_check" CHECK (("quote_type" = ANY (ARRAY['sale'::"text", 'rental'::"text"])))
);


ALTER TABLE "public"."crm_quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "token" "text" NOT NULL,
    "expired_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."crm_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."crm_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_support_tickets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "customer_id" "uuid",
    "description" "text",
    "category" "text",
    "priority" "text",
    "status" "text",
    "resolution" "text",
    "satisfaction_rating" integer,
    "serial_number" "text",
    "product_id" "uuid",
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "subject" "text" NOT NULL,
    CONSTRAINT "crm_support_tickets_satisfaction_rating_check" CHECK ((("satisfaction_rating" >= 1) AND ("satisfaction_rating" <= 5)))
);


ALTER TABLE "public"."crm_support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_tags" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "category" "text",
    "description" "text"
);


ALTER TABLE "public"."crm_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_users" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "salt" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "avatar" "text",
    "role" "text" NOT NULL,
    "department_id" "uuid",
    "position" "text",
    "status" "text" DEFAULT 'active'::"text",
    "failed_login_count" integer DEFAULT 0,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "crm_users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'boss'::"text", 'manager'::"text", 'staff'::"text"]))),
    CONSTRAINT "crm_users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."crm_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_workflows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "workflow_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "current_stage" "text",
    "current_dept" "text",
    "assigned_to" "uuid",
    "priority" "text",
    "due_date" "date",
    "history" "jsonb",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "crm_workflows_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['order'::"text", 'ticket'::"text"]))),
    CONSTRAINT "crm_workflows_workflow_type_check" CHECK (("workflow_type" = ANY (ARRAY['sales'::"text", 'installation'::"text", 'maintenance'::"text"])))
);


ALTER TABLE "public"."crm_workflows" OWNER TO "postgres";


ALTER TABLE "public"."bcn_danh_muc" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."danh_muc_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."bcn_danh_sach_ktv" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."danh_sach_ktv_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."employees_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."employees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."employees_id_seq" OWNED BY "public"."chamcong_employees"."id";



CREATE TABLE IF NOT EXISTS "public"."reports_staging" (
    "so_bcn" "text",
    "ngay" "date",
    "ktv" "text",
    "created_at" timestamp with time zone,
    "id" "text"
);


ALTER TABLE "public"."reports_staging" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."shift_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."shift_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."shift_config_id_seq" OWNED BY "public"."chamcong_shift_config"."id";



ALTER TABLE ONLY "public"."chamcong_employees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."employees_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."chamcong_shift_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."shift_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."chamcong_admin_settings"
    ADD CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."chamcong_attendance_logs"
    ADD CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chamcong_attendance_records"
    ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcn_bao_cao_ngay"
    ADD CONSTRAINT "bao_cao_ngay_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcn_bao_cao_ngay"
    ADD CONSTRAINT "bao_cao_ngay_so_bcn_key" UNIQUE ("so_bcn");



ALTER TABLE ONLY "public"."bcn_cau_hinh_he_thong"
    ADD CONSTRAINT "cau_hinh_he_thong_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."bcn_chi_tiet_cong_viec"
    ADD CONSTRAINT "chi_tiet_cong_viec_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_audit_log"
    ADD CONSTRAINT "crm_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_campaigns"
    ADD CONSTRAINT "crm_campaigns_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_campaigns"
    ADD CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_departments"
    ADD CONSTRAINT "crm_departments_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_departments"
    ADD CONSTRAINT "crm_departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_messages"
    ADD CONSTRAINT "crm_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_order_items"
    ADD CONSTRAINT "crm_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_products"
    ADD CONSTRAINT "crm_products_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_products"
    ADD CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_sessions"
    ADD CONSTRAINT "crm_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_sessions"
    ADD CONSTRAINT "crm_sessions_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."crm_settings"
    ADD CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_users"
    ADD CONSTRAINT "crm_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_users"
    ADD CONSTRAINT "crm_users_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."crm_workflows"
    ADD CONSTRAINT "crm_workflows_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."crm_workflows"
    ADD CONSTRAINT "crm_workflows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcn_danh_muc"
    ADD CONSTRAINT "danh_muc_loai_danh_muc_gia_tri_key" UNIQUE ("loai_danh_muc", "gia_tri");



ALTER TABLE ONLY "public"."bcn_danh_muc"
    ADD CONSTRAINT "danh_muc_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcn_danh_sach_ktv"
    ADD CONSTRAINT "danh_sach_ktv_ho_ten_key" UNIQUE ("ho_ten");



ALTER TABLE ONLY "public"."bcn_danh_sach_ktv"
    ADD CONSTRAINT "danh_sach_ktv_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chamcong_employees"
    ADD CONSTRAINT "employees_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."chamcong_employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chamcong_guide_content"
    ADD CONSTRAINT "guide_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chamcong_holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("date");



ALTER TABLE ONLY "public"."chamcong_shift_config"
    ADD CONSTRAINT "shift_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chamcong_attendance_records"
    ADD CONSTRAINT "unique_employee_date" UNIQUE ("employee_name", "date");



ALTER TABLE ONLY "public"."chamcong_shift_config"
    ADD CONSTRAINT "unique_shift_session" UNIQUE ("shift_type", "session");



CREATE INDEX "idx_customers_code" ON "public"."crm_customers" USING "btree" ("code");



CREATE INDEX "idx_notifications_user_id" ON "public"."crm_notifications" USING "btree" ("user_id");



CREATE INDEX "idx_orders_customer_id" ON "public"."crm_orders" USING "btree" ("customer_id");



CREATE INDEX "idx_support_tickets_customer_id" ON "public"."crm_support_tickets" USING "btree" ("customer_id");



CREATE INDEX "idx_users_username" ON "public"."crm_users" USING "btree" ("username");



CREATE INDEX "idx_workflows_entity_id" ON "public"."crm_workflows" USING "btree" ("entity_id");



CREATE OR REPLACE TRIGGER "trg_on_attendance_log_inserted" AFTER INSERT ON "public"."chamcong_attendance_logs" FOR EACH ROW EXECUTE FUNCTION "public"."process_attendance_log"();



ALTER TABLE ONLY "public"."chamcong_attendance_logs"
    ADD CONSTRAINT "attendance_logs_employee_name_fkey" FOREIGN KEY ("employee_name") REFERENCES "public"."chamcong_employees"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."chamcong_attendance_records"
    ADD CONSTRAINT "attendance_records_employee_name_fkey" FOREIGN KEY ("employee_name") REFERENCES "public"."chamcong_employees"("name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."bcn_bao_cao_ngay"
    ADD CONSTRAINT "bao_cao_ngay_ktv_fkey" FOREIGN KEY ("ktv") REFERENCES "public"."bcn_danh_sach_ktv"("ho_ten") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bcn_chi_tiet_cong_viec"
    ADD CONSTRAINT "chi_tiet_cong_viec_bcn_id_fkey" FOREIGN KEY ("bcn_id") REFERENCES "public"."bcn_bao_cao_ngay"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_audit_log"
    ADD CONSTRAINT "crm_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_campaigns"
    ADD CONSTRAINT "crm_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_campaigns"
    ADD CONSTRAINT "crm_campaigns_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_messages"
    ADD CONSTRAINT "crm_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_messages"
    ADD CONSTRAINT "crm_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_messages"
    ADD CONSTRAINT "crm_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_messages"
    ADD CONSTRAINT "crm_messages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notifications"
    ADD CONSTRAINT "crm_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_order_items"
    ADD CONSTRAINT "crm_order_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_order_items"
    ADD CONSTRAINT "crm_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."crm_products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_order_items"
    ADD CONSTRAINT "crm_order_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."crm_quotes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_orders"
    ADD CONSTRAINT "crm_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_products"
    ADD CONSTRAINT "crm_products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_products"
    ADD CONSTRAINT "crm_products_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_quotes"
    ADD CONSTRAINT "crm_quotes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_sessions"
    ADD CONSTRAINT "crm_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."crm_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."crm_products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_support_tickets"
    ADD CONSTRAINT "crm_support_tickets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_users"
    ADD CONSTRAINT "crm_users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."crm_departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_workflows"
    ADD CONSTRAINT "crm_workflows_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_workflows"
    ADD CONSTRAINT "crm_workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_workflows"
    ADD CONSTRAINT "crm_workflows_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."crm_users"("id") ON DELETE SET NULL;



CREATE POLICY "Admin write KTV" ON "public"."bcn_danh_sach_ktv" USING ("public"."check_user_privilege"('admin'::"text")) WITH CHECK ("public"."check_user_privilege"('admin'::"text"));



CREATE POLICY "Admin write danh_muc" ON "public"."bcn_danh_muc" USING (("public"."check_user_privilege"('admin'::"text") OR (COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text") = 'SystemSync'::"text"))) WITH CHECK (("public"."check_user_privilege"('admin'::"text") OR (COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text") = 'SystemSync'::"text")));



CREATE POLICY "Allow public delete employees" ON "public"."chamcong_employees" FOR DELETE USING (true);



CREATE POLICY "Allow public delete holidays" ON "public"."chamcong_holidays" FOR DELETE USING (true);



CREATE POLICY "Allow public insert employees" ON "public"."chamcong_employees" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert holidays" ON "public"."chamcong_holidays" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read KTV names" ON "public"."bcn_danh_sach_ktv" FOR SELECT USING (true);



CREATE POLICY "Allow public read danh_muc" ON "public"."bcn_danh_muc" FOR SELECT USING (true);



CREATE POLICY "Allow public update employees" ON "public"."chamcong_employees" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow public update shifts" ON "public"."chamcong_shift_config" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Insert/Update bao_cao_ngay" ON "public"."bcn_bao_cao_ngay" USING (("public"."check_user_privilege"('admin'::"text") OR ("public"."check_user_privilege"('ktv'::"text") AND ("ktv" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name"))))) WITH CHECK (("public"."check_user_privilege"('admin'::"text") OR ("public"."check_user_privilege"('ktv'::"text") AND ("ktv" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name")))));



CREATE POLICY "KTV self update PIN" ON "public"."bcn_danh_sach_ktv" FOR UPDATE USING (("public"."check_user_privilege"('admin'::"text") OR ("public"."check_user_privilege"('ktv'::"text") AND ("ho_ten" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name"))))) WITH CHECK (("public"."check_user_privilege"('admin'::"text") OR ("public"."check_user_privilege"('ktv'::"text") AND ("ho_ten" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name")))));



CREATE POLICY "Public insert logs" ON "public"."chamcong_attendance_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public read admin settings" ON "public"."chamcong_admin_settings" FOR SELECT USING (true);



CREATE POLICY "Public read employees" ON "public"."chamcong_employees" FOR SELECT USING (true);



CREATE POLICY "Public read guide" ON "public"."chamcong_guide_content" FOR SELECT USING (true);



CREATE POLICY "Public read holidays" ON "public"."chamcong_holidays" FOR SELECT USING (true);



CREATE POLICY "Public read logs" ON "public"."chamcong_attendance_logs" FOR SELECT USING (true);



CREATE POLICY "Public read records" ON "public"."chamcong_attendance_records" FOR SELECT USING (true);



CREATE POLICY "Public read shifts" ON "public"."chamcong_shift_config" FOR SELECT USING (true);



CREATE POLICY "Public update admin settings" ON "public"."chamcong_admin_settings" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Public update guide" ON "public"."chamcong_guide_content" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Public update shifts" ON "public"."chamcong_shift_config" FOR UPDATE USING (true);



CREATE POLICY "Public write records" ON "public"."chamcong_attendance_records" USING (true);



CREATE POLICY "Select bao_cao_ngay" ON "public"."bcn_bao_cao_ngay" FOR SELECT USING ("public"."check_user_privilege"('ktv'::"text"));



CREATE POLICY "Select chi_tiet_cong_viec" ON "public"."bcn_chi_tiet_cong_viec" FOR SELECT USING (("public"."check_user_privilege"('admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."bcn_bao_cao_ngay"
  WHERE (("bcn_bao_cao_ngay"."id" = "bcn_chi_tiet_cong_viec"."bcn_id") AND ("bcn_bao_cao_ngay"."ktv" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name")))))));



CREATE POLICY "Write chi_tiet_cong_viec" ON "public"."bcn_chi_tiet_cong_viec" USING (("public"."check_user_privilege"('admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."bcn_bao_cao_ngay"
  WHERE (("bcn_bao_cao_ngay"."id" = "bcn_chi_tiet_cong_viec"."bcn_id") AND ("bcn_bao_cao_ngay"."ktv" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name"))))))) WITH CHECK (("public"."check_user_privilege"('admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."bcn_bao_cao_ngay"
  WHERE (("bcn_bao_cao_ngay"."id" = "bcn_chi_tiet_cong_viec"."bcn_id") AND ("bcn_bao_cao_ngay"."ktv" = "convert_from"("decode"(COALESCE((("current_setting"('request.headers'::"text", true))::json ->> 'x-ktv-user'::"text"), ''::"text"), 'base64'::"text"), 'UTF8'::"name")))))));



CREATE POLICY "allow insert admin_settings" ON "public"."chamcong_admin_settings" FOR INSERT TO "anon" WITH CHECK (true);



ALTER TABLE "public"."bcn_bao_cao_ngay" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bcn_cau_hinh_he_thong" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bcn_chi_tiet_cong_viec" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bcn_danh_muc" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bcn_danh_sach_ktv" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_admin_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_attendance_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_attendance_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_guide_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chamcong_shift_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_workflows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports_staging" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "hast_chamcong" TO "anon";
GRANT USAGE ON SCHEMA "hast_chamcong" TO "authenticated";
GRANT USAGE ON SCHEMA "hast_chamcong" TO "service_role";



GRANT USAGE ON SCHEMA "hast_crm" TO "anon";
GRANT USAGE ON SCHEMA "hast_crm" TO "authenticated";
GRANT USAGE ON SCHEMA "hast_crm" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."check_user_privilege"("allowed_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_user_privilege"("allowed_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_user_privilege"("allowed_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_danh_muc"("p_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_danh_muc"("p_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_danh_muc"("p_data" "jsonb") TO "service_role";
























GRANT ALL ON TABLE "public"."bcn_bao_cao_ngay" TO "anon";
GRANT ALL ON TABLE "public"."bcn_bao_cao_ngay" TO "authenticated";
GRANT ALL ON TABLE "public"."bcn_bao_cao_ngay" TO "service_role";



GRANT ALL ON TABLE "public"."bcn_cau_hinh_he_thong" TO "anon";
GRANT ALL ON TABLE "public"."bcn_cau_hinh_he_thong" TO "authenticated";
GRANT ALL ON TABLE "public"."bcn_cau_hinh_he_thong" TO "service_role";



GRANT ALL ON TABLE "public"."bcn_chi_tiet_cong_viec" TO "anon";
GRANT ALL ON TABLE "public"."bcn_chi_tiet_cong_viec" TO "authenticated";
GRANT ALL ON TABLE "public"."bcn_chi_tiet_cong_viec" TO "service_role";



GRANT ALL ON TABLE "public"."bcn_danh_muc" TO "anon";
GRANT ALL ON TABLE "public"."bcn_danh_muc" TO "authenticated";
GRANT ALL ON TABLE "public"."bcn_danh_muc" TO "service_role";



GRANT ALL ON TABLE "public"."bcn_danh_sach_ktv" TO "anon";
GRANT ALL ON TABLE "public"."bcn_danh_sach_ktv" TO "authenticated";
GRANT ALL ON TABLE "public"."bcn_danh_sach_ktv" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_admin_settings" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_admin_settings" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."chamcong_admin_settings" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_attendance_logs" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_attendance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."chamcong_attendance_logs" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_attendance_records" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_attendance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."chamcong_attendance_records" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_employees" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_employees" TO "authenticated";
GRANT ALL ON TABLE "public"."chamcong_employees" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_guide_content" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_guide_content" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."chamcong_guide_content" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_holidays" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."chamcong_holidays" TO "service_role";



GRANT ALL ON TABLE "public"."chamcong_shift_config" TO "anon";
GRANT ALL ON TABLE "public"."chamcong_shift_config" TO "authenticated";
GRANT ALL ON TABLE "public"."chamcong_shift_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chi_tiet_cong_viec_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chi_tiet_cong_viec_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chi_tiet_cong_viec_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."crm_activities" TO "anon";
GRANT ALL ON TABLE "public"."crm_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_activities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."crm_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."crm_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."crm_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."crm_contacts" TO "anon";
GRANT ALL ON TABLE "public"."crm_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."crm_customers" TO "anon";
GRANT ALL ON TABLE "public"."crm_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_customers" TO "service_role";



GRANT ALL ON TABLE "public"."crm_departments" TO "anon";
GRANT ALL ON TABLE "public"."crm_departments" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_departments" TO "service_role";



GRANT ALL ON TABLE "public"."crm_messages" TO "anon";
GRANT ALL ON TABLE "public"."crm_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_messages" TO "service_role";



GRANT ALL ON TABLE "public"."crm_notes" TO "anon";
GRANT ALL ON TABLE "public"."crm_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_notes" TO "service_role";



GRANT ALL ON TABLE "public"."crm_notifications" TO "anon";
GRANT ALL ON TABLE "public"."crm_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."crm_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_order_items" TO "anon";
GRANT ALL ON TABLE "public"."crm_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."crm_orders" TO "anon";
GRANT ALL ON TABLE "public"."crm_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_orders" TO "service_role";



GRANT ALL ON TABLE "public"."crm_products" TO "anon";
GRANT ALL ON TABLE "public"."crm_products" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_products" TO "service_role";



GRANT ALL ON TABLE "public"."crm_quotes" TO "anon";
GRANT ALL ON TABLE "public"."crm_quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_quotes" TO "service_role";



GRANT ALL ON TABLE "public"."crm_sessions" TO "anon";
GRANT ALL ON TABLE "public"."crm_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."crm_settings" TO "anon";
GRANT ALL ON TABLE "public"."crm_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_settings" TO "service_role";



GRANT ALL ON TABLE "public"."crm_support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."crm_support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."crm_tags" TO "anon";
GRANT ALL ON TABLE "public"."crm_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_tags" TO "service_role";



GRANT ALL ON TABLE "public"."crm_users" TO "anon";
GRANT ALL ON TABLE "public"."crm_users" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_users" TO "service_role";



GRANT ALL ON TABLE "public"."crm_workflows" TO "anon";
GRANT ALL ON TABLE "public"."crm_workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_workflows" TO "service_role";



GRANT ALL ON SEQUENCE "public"."danh_muc_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."danh_muc_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."danh_muc_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."danh_sach_ktv_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."danh_sach_ktv_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."danh_sach_ktv_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."reports_staging" TO "anon";
GRANT ALL ON TABLE "public"."reports_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."reports_staging" TO "service_role";



GRANT ALL ON SEQUENCE "public"."shift_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."shift_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."shift_config_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "hast_crm" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































