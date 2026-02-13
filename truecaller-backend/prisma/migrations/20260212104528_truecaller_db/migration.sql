-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('USER_UPLOAD', 'MANUAL', 'VERIFIED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_identities" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "name_signals" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "name_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_scores" (
    "phone_number" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "number_identities_phone_number_idx" ON "number_identities"("phone_number");

-- CreateIndex
CREATE INDEX "spam_reports_phone_number_idx" ON "spam_reports"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "spam_scores_phone_number_key" ON "spam_scores"("phone_number");

-- AddForeignKey
ALTER TABLE "name_signals" ADD CONSTRAINT "name_signals_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "number_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_reports" ADD CONSTRAINT "spam_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
