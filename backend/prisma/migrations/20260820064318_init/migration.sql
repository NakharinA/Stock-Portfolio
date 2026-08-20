-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('CONFIRMATION_NOTE', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('SYNC', 'PRICES');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('RUNNING', 'DONE', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "googleSub" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3),

    CONSTRAINT "google_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pdfPasswordEnc" TEXT,
    "gmailQuery" TEXT NOT NULL DEFAULT 'subject:(Dime "Confirmation Note") has:attachment filename:pdf',

    CONSTRAINT "broker_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "ticker" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "source" "TransactionSource" NOT NULL DEFAULT 'CONFIRMATION_NOTE',
    "qty" DECIMAL(20,7),
    "price" DECIMAL(20,6),
    "amount" DECIMAL(20,4),
    "fee" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "sourceFile" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "ticker" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE "price_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_prices" (
    "ticker" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "year_end_prices_pkey" PRIMARY KEY ("ticker","year")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'RUNNING',
    "log" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "google_grants_userId_key" ON "google_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "broker_settings_userId_key" ON "broker_settings"("userId");

-- CreateIndex
CREATE INDEX "transactions_userId_tradeDate_idx" ON "transactions"("userId", "tradeDate");

-- CreateIndex
CREATE INDEX "transactions_userId_ticker_idx" ON "transactions"("userId", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_userId_externalId_key" ON "transactions"("userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "price_overrides_userId_ticker_key" ON "price_overrides"("userId", "ticker");

-- CreateIndex
CREATE INDEX "import_jobs_userId_startedAt_idx" ON "import_jobs"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "source_documents_userId_gmailMessageId_filename_key" ON "source_documents"("userId", "gmailMessageId", "filename");

-- AddForeignKey
ALTER TABLE "google_grants" ADD CONSTRAINT "google_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_settings" ADD CONSTRAINT "broker_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
