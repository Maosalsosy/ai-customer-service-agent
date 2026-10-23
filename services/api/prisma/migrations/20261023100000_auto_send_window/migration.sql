-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "auto_send_window_start" VARCHAR(5),
ADD COLUMN "auto_send_window_end" VARCHAR(5),
ADD COLUMN "auto_send_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai';
